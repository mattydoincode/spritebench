import crypto from "node:crypto";
import { insertAsset } from "@/db/repo/assets";
import {
  appendAssetId,
  claimJob,
  finishJob,
  markProviderCallComplete,
  requeueJob
} from "@/db/repo/jobs";
import { applyLoopFollowUp } from "@/server/loop";
import { loopOutcome } from "@/shared/loop";
import { keyForJob } from "@/db/repo/providerKeys";
import { recordUsage } from "@/db/repo/usage";
import { providerForModel } from "@/providers";
import { isRetryable, type ProviderResult } from "@/providers/types";
import { assetRetentionDays } from "@/server/config";
import { readPngSize } from "@/server/png";
import { editInputsForJob, jobUsesEdit } from "@/server/template";
import { buildThumbnail } from "@/server/thumbnails";
import { sourceKey, thumbKey } from "@/storage/keys";
import { storage } from "@/storage";
import type { JobRow } from "@/db/schema";

/**
 * The key chosen at enqueue is gone by the time the job runs -- the owner
 * deleted it, or it failed to decrypt. Not retryable: waiting will not bring
 * it back.
 */
export class MissingProviderKeyError extends Error {
  constructor(provider: string) {
    super(`the ${provider} key this job was going to bill no longer exists`);
    this.name = "MissingProviderKeyError";
  }
}

async function callProvider(job: JobRow, apiKey: string): Promise<ProviderResult> {
  const provider = providerForModel(job.generation.model);
  const request = { apiKey, prompt: job.composedPrompt, generation: job.generation };

  const inputs = await editInputsForJob(job.projectId, job);
  if (inputs) {
    return provider.edit({
      ...request,
      base: inputs.base,
      mask: inputs.mask,
      plate: inputs.plate ?? null,
      size: inputs.size
    });
  }

  return provider.generate(request);
}

/**
 * Runs one generation job.
 *
 * Ordering matters for correctness: the provider call is the only step that
 * costs money, so everything that can fail cheaply happens before it, and the
 * source bytes plus the asset row are committed before the job is marked
 * done. A crash between the call and the commit used to mean a paid
 * generation with nothing to show for it.
 *
 * Claiming the row is what makes a duplicate delivery safe: only one caller
 * wins the transition out of `queued`, and a job whose provider call already
 * completed is never called again.
 *
 * Returns whether the queue should retry. Retrying a deterministic failure --
 * a content-policy refusal, a bad key, an unknown model -- just spends the
 * project's quota on the same answer, so only transient failures come back.
 */
export async function runJob(jobId: string, attemptsLeft = 0): Promise<{ retry: boolean }> {
  const job = await claimJob(jobId);

  if (!job) {
    console.log(`[worker] job ${jobId} is not claimable, skipping`);
    return { retry: false };
  }

  let follow: ReturnType<typeof loopOutcome> | null = null;

  if (job.providerCallCompletedAt) {
    // A retry of a job that already paid for its images. Never call again; the
    // only question is whether the assets made it to storage last time.
    const landed = (job.assetIds ?? []).length;
    console.warn(`[worker] job ${jobId} already called the provider, ${landed} asset(s) stored`);

    await finishJob(
      jobId,
      landed > 0
        ? { status: "done" }
        : {
            status: "error",
            error: "the provider call succeeded but the images could not be saved"
          }
    );

    follow = loopOutcome(job.assetIds?.[0] ?? null);
  } else {
    try {
      // The model decides the provider, which decides the key. Hardcoding one
      // provider here is what made adding a second model a code change.
      const provider = providerForModel(job.generation.model);
      const apiKey = await keyForJob(job.providerKeyId, provider.id);
      if (!apiKey) throw new MissingProviderKeyError(provider.id);

      const result = await callProvider(job, apiKey);
      await markProviderCallComplete(jobId);

      await recordUsage({
        projectId: job.projectId,
        userId: job.userId,
        jobId,
        provider: provider.id,
        model: job.generation.model,
        operation: jobUsesEdit(job) ? "edit" : "generate",
        images: result.images.length,
        totalTokens: result.usage?.totalTokens ?? 0,
        inputTokens: result.usage?.inputTokens ?? 0,
        outputTokens: result.usage?.outputTokens ?? 0,
        elapsedSeconds: result.elapsedSeconds
      });

      const expiresAt = new Date(Date.now() + assetRetentionDays() * 86_400_000);
      let firstAssetId: string | null = null;

      for (const bytes of result.images) {
        // The id names the storage key, so it is minted before the write. No
        // probing for a free key: an id nobody has used cannot collide, which
        // is one fewer HEAD request per image than the old name-derived keys.
        const assetId = crypto.randomUUID();
        const key = sourceKey(job.projectId, assetId);

        await storage().put(key, bytes, {
          contentType: "image/png",
          cacheControl: "public, max-age=31536000, immutable"
        });

        const size = readPngSize(bytes);

        // A failed thumbnail must not lose the image the project just paid for.
        let thumb: string | null = null;
        try {
          const key = thumbKey(job.projectId, assetId);
          await storage().put(key, await buildThumbnail(bytes), {
            contentType: "image/webp",
            cacheControl: "public, max-age=31536000, immutable"
          });
          thumb = key;
        } catch (error) {
          console.error(`[worker] could not build a thumbnail for ${key}`, error);
        }

        const asset = await insertAsset({
          id: assetId,
          projectId: job.projectId,
          createdByUserId: job.userId,
          sourceKey: key,
          thumbKey: thumb,
          sourceWidth: size.width,
          sourceHeight: size.height,
          byteSize: bytes.length,
          prompt: job.prompt,
          composedPrompt: job.composedPrompt,
          generation: job.generation,
          processing: job.processing,
          rerunOf: job.rerunOf,
          jobId,
          inputs: job.inputs,
          sequencePlan: job.sequencePlan,
          usage: result.usage,
          elapsedSeconds: result.elapsedSeconds,
          expiresAt
        });

        await appendAssetId(jobId, asset.id);
        firstAssetId ??= asset.id;
      }

      if (!firstAssetId) {
        await finishJob(jobId, {
          status: "error",
          error: "the provider returned no images",
          resolvedSize: result.resolvedSize
        });
        follow = loopOutcome(null);
      } else {
        await finishJob(jobId, { status: "done", resolvedSize: result.resolvedSize });
        follow = loopOutcome(firstAssetId);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const retry = isRetryable(error) && attemptsLeft > 0;

      if (retry) {
        console.warn(`[worker] job ${jobId} failed transiently, will retry: ${message}`);
        await requeueJob(jobId, message);
        return { retry: true };
      }

      await finishJob(jobId, { status: "error", error: message });
      follow = loopOutcome(null);
    }
  }

  if (follow) {
    try {
      await applyLoopFollowUp(job.projectId, job.batchId, job.inputs, follow);
    } catch (error) {
      console.error(`[worker] job ${jobId} settled but the next loop step could not start`, error);
    }
  }

  return { retry: false };
}
