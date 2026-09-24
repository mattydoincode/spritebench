import crypto from "node:crypto";
import { attachSheetFramePlate, isSheetFramesTemplate } from "@/core/frameMask";
import {
  attachSheetPixelPlate,
  isPixelConstraintTemplate,
  pixelConstraintWindow,
  processingForJob
} from "@/core/pixelMask";
import { withDefaults, type ProcessingSettings } from "@/core/settings";
import { snapRequestSize } from "@/providers/models";
import type { Size } from "@/core/types";
import { db, type Transaction } from "@/db";
import { getAssetRow } from "@/db/repo/assets";
import { insertJob, setQueueJobId, toJobRecord } from "@/db/repo/jobs";
import { lockProject } from "@/db/repo/projects";
import { getTemplate } from "@/db/repo/templates";
import { dispatchJob } from "@/queue/dispatch";
import {
  composePrompt,
  type BaseSpec,
  type GenerationParams,
  type JobInputs,
  type JobRecord,
  type PromptSpec,
  type SequencePlan
} from "@/shared/model";
import {
  InvalidInputsError,
  attachFanoutAnimation,
  isExpandingChunk,
  isExpandingMultistep,
  planFanout,
  resolveBases,
  startingAssetId,
  validateGenerateInputs,
  type PlannedGroup
} from "@/shared/multistep";
import { promptWithEachGuide } from "@/shared/featurePrompt";
import {
  expandCreate,
  loopReservedSlots,
  promptForJob,
  type PromptVariable
} from "@/shared/promptVars";
import { maxImagesPerRequest } from "./config";

export { InvalidInputsError };

export interface EnqueueRequest {
  projectId: string;
  /** Who pressed Generate. One of the owner's keys pays for it. */
  userId: string;
  /**
   * Which of the owner's keys to bill, already validated by
   * `resolveKeySelection`. Null means the environment-key dev path.
   */
  providerKeyId: string | null;
  prompt: PromptSpec;
  generation: GenerationParams;
  processing: ProcessingSettings;
  folder: string;
  label?: string;
  inputs?: JobInputs | null;
  sequencePlan?: SequencePlan | null;
  rerunOf?: string | null;
  batches: number;
  /** `{color}` rows. Empty or omitted means one prompt, as before. */
  variables?: PromptVariable[];
  /**
   * Example / starting images. Each one is its own job (cartesian with
   * variables). Empty falls back to `inputs.base`.
   */
  bases?: BaseSpec[];
  /** Collect variable / template expansions into one library animation. */
  animate?: boolean;
  /** Set when this job belongs to a batch created by the caller, as reruns do. */
  batch?: { id: string; index: number; size: number } | null;
}

export class EmptyExpansionError extends Error {
  constructor() {
    super("give every {slot} in the prompt at least one value");
    this.name = "EmptyExpansionError";
  }
}

export class FanOutExceededError extends Error {
  constructor(
    readonly requested: number,
    readonly limit: number
  ) {
    super(`that would generate ${requested} images; the limit is ${limit} per request`);
    this.name = "FanOutExceededError";
  }
}

/**
 * Rejects a request that fans out further than one generate is allowed to.
 *
 * Checked before anything is dispatched, since refusing after the provider
 * call would spend real money on images we then throw away.
 */
export async function assertCapacity(
  _projectId: string,
  images: number,
  _connection?: Transaction
): Promise<void> {
  if (images > maxImagesPerRequest()) {
    throw new FanOutExceededError(images, maxImagesPerRequest());
  }
}

async function originSizeFor(
  projectId: string,
  inputs: JobInputs | null | undefined
): Promise<Size | null> {
  const assetId = startingAssetId(inputs);
  if (!assetId) return null;

  const row = await getAssetRow(projectId, assetId);
  if (!row) throw new InvalidInputsError("starting image not found");
  if (!row.sourceKey) throw new InvalidInputsError("starting image source has been rolled off");

  if (!isExpandingChunk(inputs)) return null;
  return { width: row.sourceWidth, height: row.sourceHeight };
}

async function describeBase(projectId: string, base: BaseSpec | null): Promise<string> {
  if (!base) return "";
  if (base.source.kind === "template") {
    const row = await getTemplate(projectId, base.source.templateId);
    return row?.filename ?? base.source.templateId.slice(0, 8);
  }

  const row = await getAssetRow(projectId, base.source.assetId);
  return row ? String(row.seq).padStart(3, "0") : base.source.assetId.slice(0, 8);
}

function sheetPixelPlan(request: EnqueueRequest): SequencePlan | null {
  const plan = request.sequencePlan ?? null;
  if (!plan?.actions?.length) return plan;
  const mask = request.inputs?.mask;
  if (mask?.source.kind !== "template") return plan;
  const canvas = snapRequestSize(request.generation.size, request.generation.model);

  if (isPixelConstraintTemplate(mask.source.templateId)) {
    return attachSheetPixelPlate(
      plan,
      canvas,
      pixelConstraintWindow(mask.window ?? request.processing.targetSize)
    );
  }

  if (isSheetFramesTemplate(mask.source.templateId)) {
    return attachSheetFramePlate(plan, canvas);
  }

  return plan;
}

/**
 * Creates job rows and hands them to the queue.
 *
 * The whole fan-out is one transaction: the request cap, every row insert, and
 * every queue send. Concurrent requests serialize on the project's row lock,
 * and the request is all-or-nothing instead of leaving half a batch behind
 * when a later insert fails.
 */
export async function enqueueGeneration(request: EnqueueRequest): Promise<JobRecord[]> {
  validateGenerateInputs(request);

  const prompt = promptWithEachGuide(
    request.prompt,
    Boolean(request.inputs?.each),
    request.generation.model
  );
  const reserved = loopReservedSlots(Boolean(request.inputs?.loop));
  const bases = resolveBases(request);
  const expansions = expandCreate(prompt, request.variables ?? [], bases, reserved);
  if (expansions.length === 0) throw new EmptyExpansionError();

  const sequencePlan = sheetPixelPlan(request);
  const planned: PlannedGroup[][] = [];

  for (const expansion of expansions) {
    const inputs = {
      ...(request.inputs ?? {}),
      base: expansion.base
    };
    const originSize = await originSizeFor(request.projectId, inputs);
    planned.push(
      planFanout({
        generation: request.generation,
        inputs,
        batches: request.batches,
        originSize
      })
    );
  }

  const groupsByExpansion = attachFanoutAnimation(
    planned,
    Boolean(request.animate) &&
      !sequencePlan?.actions?.length &&
      !isExpandingMultistep(request.inputs)
  );

  const images = groupsByExpansion.reduce(
    (total, groups) =>
      total +
      groups.reduce(
        (groupTotal, group) =>
          groupTotal + group.rows.reduce((sum, row) => sum + Math.max(1, row.generation.imageCount), 0),
        0
      ),
    0
  );

  const labels = new Map<string, string>();
  if (bases.length > 1) {
    for (const base of bases) {
      labels.set(JSON.stringify(base.source), await describeBase(request.projectId, base));
    }
  }

  const rows = await db().transaction(async (transaction) => {
    await lockProject(request.projectId, transaction);
    await assertCapacity(request.projectId, images, transaction);

    const inserted = [];

    for (const [expansionIndex, expansion] of expansions.entries()) {
      const groups = groupsByExpansion[expansionIndex];
      const baseTag = expansion.base ? labels.get(JSON.stringify(expansion.base.source)) : "";
      const label =
        request.label?.trim() ||
        [baseTag, expansion.label].filter((part) => part && part.length > 0).join(" · ") ||
        expansion.prompt.body.trim().slice(0, 60) ||
        "untitled";

      for (const group of groups) {
        const batchId =
          request.batch?.id ??
          (expansions.length > 1 || groups.length > 1 || group.rows.length > 1
            ? crypto.randomUUID()
            : null);

        for (const planned of group.rows) {
          const prompt = promptForJob(expansion.prompt, planned.inputs);
          const row = await insertJob(
            {
              projectId: request.projectId,
              userId: request.userId,
              providerKeyId: request.providerKeyId,
              status: planned.status,
              label,
              batchId,
              batchIndex: request.batch?.index ?? planned.batchIndex,
              batchSize: request.batch?.size ?? planned.batchSize,
              prompt,
              composedPrompt: composePrompt(prompt),
              generation: planned.generation,
              processing: processingForJob(
                withDefaults(request.processing),
                planned.inputs,
                snapRequestSize(planned.generation.size, planned.generation.model),
                sequencePlan
              ),
              folder: request.folder,
              inputs: planned.inputs,
              sequencePlan,
              rerunOf: request.rerunOf ?? null
            },
            transaction
          );

          if (planned.dispatch) {
            const queueJobId = await dispatchJob(row.id, transaction);
            if (queueJobId) await setQueueJobId(row.id, queueJobId, transaction);
          }

          inserted.push(row);
        }
      }
    }

    return inserted;
  });

  return rows.map(toJobRecord);
}
