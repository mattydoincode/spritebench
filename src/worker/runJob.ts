import { describeSettings } from "@/core/describe";
import { insertAsset } from "@/db/repo/assets";
import {
  appendAssetId,
  claimJob,
  finishJob,
  markProviderCallComplete,
  requeueJob
} from "@/db/repo/jobs";
import { getPaletteColors } from "@/db/repo/palettes";
import { resolveProviderKey } from "@/db/repo/providerKeys";
import { readSettings } from "@/db/repo/users";
import { recordUsage } from "@/db/repo/usage";
import { providerForModel } from "@/providers";
import { isRetryable, type ProviderResult } from "@/providers/types";
import { assetRetentionDays } from "@/server/config";
import { sanitizeName, timestamp } from "@/server/naming";
import { readPngSize } from "@/server/png";
import { buildEditInputs } from "@/server/template";
import { buildThumbnail } from "@/server/thumbnails";
import { basename, sourceKey, thumbKey, uniqueKey } from "@/storage/keys";
import { storage } from "@/storage";
import type { JobRow } from "@/db/schema";

export class MissingProviderKeyError extends Error {
  constructor(provider: string) {
    super(`no ${provider} API key is configured. Add one in settings.`);
    this.name = "MissingProviderKeyError";
  }
}

async function callProvider(job: JobRow, apiKey: string): Promise<ProviderResult> {
  const provider = providerForModel(job.generation.model);
  const request = { apiKey, prompt: job.composedPrompt, generation: job.generation };

  if (job.template?.useAsMask) {
    const inputs = await buildEditInputs(job.userId, job.template, job.generation);

    return provider.edit({ ...request, base: inputs.base, mask: inputs.mask, size: inputs.size });
  }

  return provider.generate(request);
}

/**
 * Runs one generation job.
 *
 * Ordering matters for correctness: the provider call is the only step that
 * costs the user money, so everything that can fail cheaply happens before it,
 * and the source bytes plus the asset row are committed before the job is
 * marked done. A crash between the call and the commit used to mean a paid
 * generation with nothing to show for it.
 *
 * Claiming the row is what makes a duplicate delivery safe: only one caller
 * wins the transition out of `queued`, and a job whose provider call already
 * completed is never called again.
 *
 * Returns whether the queue should retry. Retrying a deterministic failure --
 * a content-policy refusal, a bad key, an unknown model -- just spends the
 * user's quota on the same answer, so only transient failures come back.
 */
export async function runJob(jobId: string, attemptsLeft = 0): Promise<{ retry: boolean }> {
  const job = await claimJob(jobId);

  if (!job) {
    console.log(`[worker] job ${jobId} is not claimable, skipping`);
    return { retry: false };
  }

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

    return { retry: false };
  }

  try {
    const apiKey = await resolveProviderKey(job.userId, "openai");
    if (!apiKey) throw new MissingProviderKeyError("openai");

    const settings = await readSettings(job.userId);
    const slug = sanitizeName(settings.assetSlug, "asset");
    const stamp = timestamp();

    const result = await callProvider(job, apiKey);
    await markProviderCallComplete(jobId);

    await recordUsage({
      userId: job.userId,
      jobId,
      provider: "openai",
      model: job.generation.model,
      operation: job.template?.useAsMask ? "edit" : "generate",
      images: result.images.length,
      totalTokens: result.usage?.totalTokens ?? 0,
      inputTokens: result.usage?.inputTokens ?? 0,
      outputTokens: result.usage?.outputTokens ?? 0,
      elapsedSeconds: result.elapsedSeconds
    });

    const palette = job.processing.paletteFile
      ? await getPaletteColors(job.userId, job.processing.paletteFile)
      : [];

    const expiresAt = new Date(Date.now() + assetRetentionDays() * 86_400_000);

    for (const [index, bytes] of result.images.entries()) {
      const key = await uniqueKey(sourceKey(`${slug}_${stamp}_${index + 1}.png`), (candidate) =>
        storage().exists(candidate)
      );

      await storage().put(key, bytes, {
        contentType: "image/png",
        cacheControl: "public, max-age=31536000, immutable"
      });

      const name = basename(key).slice(0, -".png".length);
      const size = readPngSize(bytes);

      // A failed thumbnail must not lose the image the user just paid for.
      let thumb: string | null = null;
      try {
        await storage().put(thumbKey(name), await buildThumbnail(bytes), {
          contentType: "image/webp",
          cacheControl: "public, max-age=31536000, immutable"
        });
        thumb = thumbKey(name);
      } catch (error) {
        console.error(`[worker] could not build a thumbnail for ${key}`, error);
      }

      const asset = await insertAsset({
        userId: job.userId,
        name,
        folder: job.folder,
        tags: [],
        sourceKey: key,
        thumbKey: thumb,
        sourceWidth: size.width,
        sourceHeight: size.height,
        byteSize: bytes.length,
        prompt: job.prompt,
        composedPrompt: job.composedPrompt,
        generation: job.generation,
        processing: job.processing,
        processingDescription: describeSettings(job.processing, size, palette),
        rerunOf: job.rerunOf,
        jobId,
        template: job.template,
        usage: result.usage,
        elapsedSeconds: result.elapsedSeconds,
        expiresAt
      });

      await appendAssetId(jobId, asset.id);
    }

    await finishJob(jobId, { status: "done", resolvedSize: result.resolvedSize });

    return { retry: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const retry = isRetryable(error) && attemptsLeft > 0;

    if (retry) {
      console.warn(`[worker] job ${jobId} failed transiently, will retry: ${message}`);
      await requeueJob(jobId, message);
    } else {
      await finishJob(jobId, { status: "error", error: message });
    }

    return { retry };
  }
}
