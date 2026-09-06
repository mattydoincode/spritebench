import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { getAsset } from "@/db/repo/assets";
import { currentUserId, readSettings } from "@/db/repo/users";
import {
  FanOutExceededError,
  QuotaExceededError,
  assertCapacity,
  enqueueGeneration
} from "@/server/generation";
import { parseBody, rerunBodySchema, withValidation } from "@/server/validation";
import type { JobRecord } from "@/shared/model";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return withValidation(async () => {
    const body = await parseBody(request, rerunBodySchema);
    const userId = await currentUserId();
    const settings = await readSettings(userId);

    const targets = (
      await Promise.all(body.assetIds.map((id) => getAsset(userId, id)))
    ).filter((asset): asset is NonNullable<typeof asset> => asset !== null);

    if (targets.length === 0) {
      return NextResponse.json({ error: "none of those assets exist" }, { status: 404 });
    }

    // Each rerun is its own single-image job, but they share a batch id so the
    // jobs bar groups them the way a multi-batch generate does.
    const batchId = targets.length > 1 ? crypto.randomUUID() : null;
    const jobs: JobRecord[] = [];

    try {
      // Checked for the whole set up front, so a rerun of 80 assets is refused
      // before any of them reach the provider.
      await assertCapacity(
        userId,
        targets.reduce((total, asset) => total + Math.max(1, asset.generation.imageCount), 0)
      );

      for (const [index, asset] of targets.entries()) {
        const created = await enqueueGeneration({
          userId,
          prompt: {
            prefix: body.promptPrefix ?? settings.promptPrefix,
            body: asset.prompt.body,
            suffix: body.promptSuffix ?? settings.promptSuffix
          },
          generation:
            body.useStoredGeneration === false ? settings.generation : asset.generation,
          processing:
            body.useStoredProcessing === false ? settings.processing : asset.processing,
          folder: asset.folder,
          template: asset.template,
          label: `rerun ${asset.name}`,
          rerunOf: asset.id,
          batches: 1,
          batch: batchId ? { id: batchId, index: index + 1, size: targets.length } : null
        });

        jobs.push(...created);
      }
    } catch (error) {
      if (error instanceof QuotaExceededError) {
        return NextResponse.json({ error: error.message, jobs }, { status: 402 });
      }
      if (error instanceof FanOutExceededError) {
        return NextResponse.json({ error: error.message, jobs }, { status: 400 });
      }
      throw error;
    }

    return NextResponse.json({ jobs });
  });
}
