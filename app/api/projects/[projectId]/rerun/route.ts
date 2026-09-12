import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { getAsset } from "@/db/repo/assets";
import { readDoc } from "@/db/repo/projectDoc";
import { KeyNotUsableError, resolveKeySelection } from "@/db/repo/providerKeys";
import { readSettings } from "@/db/repo/users";
import { providerForModel } from "@/providers";
import { clampGeneration } from "@/providers/models";
import { projectContext } from "@/server/access";
import {
  FanOutExceededError,
  QuotaExceededError,
  assertCapacity,
  enqueueGeneration
} from "@/server/generation";
import { parseBody, rerunBodySchema, withValidation } from "@/server/validation";
import { docFromState, readProjectSettings } from "@/shared/doc";
import { formatSeq } from "@/shared/naming";
import type { JobRecord } from "@/shared/model";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ projectId: string }> };

export async function POST(request: Request, { params }: Params) {
  return withValidation(async () => {
    const { projectId, userId } = await projectContext(params, "generate");

    const body = await parseBody(request, rerunBodySchema);
    const [settings, snapshot] = await Promise.all([
      readSettings(userId),
      readDoc(projectId)
    ]);

    const project = readProjectSettings(docFromState(snapshot.state));

    const targets = (
      await Promise.all(body.assetIds.map((id) => getAsset(projectId, id)))
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
        projectId,
        targets.reduce((total, asset) => total + Math.max(1, asset.generation.imageCount), 0)
      );

      for (const [index, asset] of targets.entries()) {
        const generation = clampGeneration(
          body.useStoredGeneration === false ? settings.generation : asset.generation
        );

        // Resolved per asset: a rerun set can span models, and two models can
        // belong to two providers that need two different keys.
        const providerKeyId = await resolveKeySelection(
          projectId,
          providerForModel(generation.model).id,
          body.providerKeyId
        );

        const created = await enqueueGeneration({
          projectId,
          userId,
          providerKeyId,
          prompt: {
            guide: asset.prompt.guide ?? "",
            prefix: body.promptPrefix ?? project.promptPrefix,
            body: asset.prompt.body,
            extra: asset.prompt.extra ?? "",
            suffix: body.promptSuffix ?? project.promptSuffix
          },
          generation,
          processing:
            body.useStoredProcessing === false ? settings.processing : asset.generatedWith,
          // Folder and pretty name live in the Yjs document, so the label uses
          // the number, which is the one name the server can see.
          folder: body.folder ?? "",
          inputs: asset.inputs,
          sequencePlan: asset.sequencePlan,
          label: `rerun ${formatSeq(asset.seq)}`,
          rerunOf: asset.id,
          batches: 1,
          batch: batchId ? { id: batchId, index: index + 1, size: targets.length } : null
        });

        jobs.push(...created);
      }
    } catch (error) {
      if (error instanceof KeyNotUsableError) {
        return NextResponse.json({ error: error.message, jobs }, { status: 400 });
      }
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
