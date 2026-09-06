import crypto from "node:crypto";
import { withDefaults, type ProcessingSettings } from "@/core/settings";
import { db, type Transaction } from "@/db";
import { countAssets } from "@/db/repo/assets";
import { insertJob, pendingImages, setQueueJobId, toJobRecord } from "@/db/repo/jobs";
import { lockUser } from "@/db/repo/users";
import {
  composePrompt,
  type GenerationParams,
  type JobRecord,
  type PromptSpec,
  type TemplateSpec
} from "@/shared/model";
import { freeAssetLimit, maxImagesPerRequest } from "./config";
import { dispatchJob } from "@/queue/dispatch";

export interface EnqueueRequest {
  userId: string;
  prompt: PromptSpec;
  generation: GenerationParams;
  processing: ProcessingSettings;
  folder: string;
  label?: string;
  template?: TemplateSpec | null;
  rerunOf?: string | null;
  batches: number;
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

    super(`you are storing ${held}. Delete some before generating more.`);
    this.name = "QuotaExceededError";
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
 * Rejects a request that would take the user past their storage quota or fan
 * out further than one request is allowed to.
 *
 * Checked before anything is dispatched: users pay for their own generations,
 * so refusing after the provider call would spend their money on an image we
 * then throw away.
 *
 * Pass the enqueue transaction to make the check binding. Called without one
 * it is only an early, friendlier rejection -- see `enqueueGeneration`.
 */
export async function assertCapacity(
  userId: string,
  images: number,
  connection?: Transaction
): Promise<void> {
  if (images > maxImagesPerRequest()) {
    throw new FanOutExceededError(images, maxImagesPerRequest());
  }

  const limit = freeAssetLimit();
  const [stored, pending] = await Promise.all([
    countAssets(userId, connection),
    pendingImages(userId, connection)
  ]);

  if (stored + pending + images > limit) {
    throw new QuotaExceededError(limit, stored, pending);
  }
}

/**
 * Creates job rows and hands them to the queue.
 *
 * The whole fan-out is one transaction: the quota check, every row insert, and
 * every queue send. That makes the check binding rather than advisory -- two
 * concurrent requests serialize on the user's row lock, so the second one sees
 * what the first committed to -- and it makes the request all-or-nothing
 * instead of leaving half a batch behind when the limit is hit midway.
 */
export async function enqueueGeneration(request: EnqueueRequest): Promise<JobRecord[]> {
  const batches = Math.max(1, Math.min(20, Math.floor(request.batches)));
  const perBatch = Math.max(1, Math.floor(request.generation.imageCount));

  const composed = composePrompt(request.prompt);
  const batchId = request.batch?.id ?? (batches > 1 ? crypto.randomUUID() : null);
  const label =
    request.label?.trim() || request.prompt.body.trim().slice(0, 60) || "untitled";

  const rows = await db().transaction(async (transaction) => {
    await lockUser(request.userId, transaction);
    await assertCapacity(request.userId, batches * perBatch, transaction);

    const inserted = [];

    for (let index = 0; index < batches; index++) {
      const row = await insertJob(
        {
          userId: request.userId,
          label,
          batchId,
          batchIndex: request.batch?.index ?? index + 1,
          batchSize: request.batch?.size ?? batches,
          prompt: request.prompt,
          composedPrompt: composed,
          generation: request.generation,
          // Edits are per-asset and meaningless for a fresh generation.
          processing: { ...withDefaults(request.processing), edits: [] },
          folder: request.folder,
          template: request.template ?? null,
          rerunOf: request.rerunOf ?? null
        },
        transaction
      );

      // Enqueued in the same transaction, so there is no window where a job
      // row exists that nothing will ever pick up, and none where the queue
      // references a row that was rolled back.
      const queueJobId = await dispatchJob(row.id, transaction);
      if (queueJobId) await setQueueJobId(row.id, queueJobId, transaction);

      inserted.push(row);
    }

    return inserted;
  });

  return rows.map(toJobRecord);
}
