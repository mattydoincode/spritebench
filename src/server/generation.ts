import crypto from "node:crypto";
import { processingForJob } from "@/core/pixelMask";
import { withDefaults, type ProcessingSettings } from "@/core/settings";
import { snapRequestSize } from "@/providers/models";
import type { Size } from "@/core/types";
import { db, type Transaction } from "@/db";
import { countAssets, getAssetRow } from "@/db/repo/assets";
import { insertJob, pendingImages, setQueueJobId, toJobRecord } from "@/db/repo/jobs";
import { lockProject } from "@/db/repo/projects";
import { dispatchJob } from "@/queue/dispatch";
import {
  composePrompt,
  type GenerationParams,
  type JobInputs,
  type JobRecord,
  type PromptSpec,
  type SequencePlan
} from "@/shared/model";
import {
  InvalidInputsError,
  isExpandingChunk,
  planFanout,
  startingAssetId,
  validateGenerateInputs
} from "@/shared/multistep";
import { expandPrompt, loopReservedSlots, promptForJob, type PromptVariable } from "@/shared/promptVars";
import { freeAssetLimit, maxImagesPerRequest } from "./config";

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
  /** Set when this job belongs to a batch created by the caller, as reruns do. */
  batch?: { id: string; index: number; size: number } | null;
}

export class QuotaExceededError extends Error {
  constructor(
    readonly limit: number,
    readonly stored: number,
    readonly pending: number
  ) {
    const held =
      pending > 0
        ? `${stored} of ${limit} images, with ${pending} more already generating`
        : `${stored} of ${limit} images`;

    super(`this project is storing ${held}. Delete some before generating more.`);
    this.name = "QuotaExceededError";
  }
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
 * Rejects a request that would take the project past its storage quota or fan
 * out further than one request is allowed to.
 *
 * Counted per project rather than per user because the project owner's key
 * pays: a shared project with three collaborators is one bill, not three
 * allowances.
 *
 * Checked before anything is dispatched, since refusing after the provider
 * call would spend real money on an image we then throw away.
 *
 * Pass the enqueue transaction to make the check binding. Called without one
 * it is only an early, friendlier rejection -- see `enqueueGeneration`.
 */
export async function assertCapacity(
  projectId: string,
  images: number,
  connection?: Transaction
): Promise<void> {
  if (images > maxImagesPerRequest()) {
    throw new FanOutExceededError(images, maxImagesPerRequest());
  }

  const limit = freeAssetLimit();
  const [stored, pending] = await Promise.all([
    countAssets(projectId, connection),
    pendingImages(projectId, connection)
  ]);

  if (stored + pending + images > limit) {
    throw new QuotaExceededError(limit, stored, pending);
  }
}

async function originSizeFor(request: EnqueueRequest): Promise<Size | null> {
  const assetId = startingAssetId(request.inputs);
  if (!assetId) return null;

  const row = await getAssetRow(request.projectId, assetId);
  if (!row) throw new InvalidInputsError("starting image not found");
  if (!row.sourceKey) throw new InvalidInputsError("starting image source has been rolled off");

  if (!isExpandingChunk(request.inputs)) return null;
  return { width: row.sourceWidth, height: row.sourceHeight };
}

/**
 * Creates job rows and hands them to the queue.
 *
 * The whole fan-out is one transaction: the quota check, every row insert, and
 * every queue send. That makes the check binding rather than advisory -- two
 * concurrent requests serialize on the project's row lock, so the second one
 * sees what the first committed to -- and it makes the request all-or-nothing
 * instead of leaving half a batch behind when the limit is hit midway.
 */
export async function enqueueGeneration(request: EnqueueRequest): Promise<JobRecord[]> {
  validateGenerateInputs(request);

  const reserved = loopReservedSlots(Boolean(request.inputs?.loop));
  const expansions = expandPrompt(request.prompt, request.variables ?? [], reserved);
  if (expansions.length === 0) throw new EmptyExpansionError();

  const originSize = await originSizeFor(request);
  const groupsByExpansion = expansions.map(() =>
    planFanout({
      generation: request.generation,
      inputs: request.inputs ?? null,
      batches: request.batches,
      originSize
    })
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

  const rows = await db().transaction(async (transaction) => {
    await lockProject(request.projectId, transaction);
    await assertCapacity(request.projectId, images, transaction);

    const inserted = [];

    for (const [expansionIndex, expansion] of expansions.entries()) {
      const groups = groupsByExpansion[expansionIndex];
      const label =
        request.label?.trim() || expansion.label || expansion.prompt.body.trim().slice(0, 60) || "untitled";

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
                snapRequestSize(planned.generation.size, planned.generation.model)
              ),
              folder: request.folder,
              inputs: planned.inputs,
              sequencePlan: request.sequencePlan ?? null,
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
