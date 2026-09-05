import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { readAssets, readSettings, serialize } from "@/server/library";
import { enqueue } from "@/server/queue";

export const dynamic = "force-dynamic";

interface RerunBody {
  assetIds: string[];
  promptPrefix?: string;
  promptSuffix?: string;
  useStoredGeneration?: boolean;
  useStoredProcessing?: boolean;
}

export async function POST(request: Request) {
  const body = (await request.json()) as RerunBody;

  if (!Array.isArray(body.assetIds) || body.assetIds.length === 0) {
    return NextResponse.json({ error: "select at least one asset" }, { status: 400 });
  }

  const jobs = await serialize(() => {
    const settings = readSettings();
    const assets = readAssets();
    const wanted = new Set(body.assetIds);

    const targets = assets.filter((asset) => wanted.has(asset.id));
    const batchId = targets.length > 1 ? crypto.randomUUID() : null;

    return targets.map((asset, index) =>
      enqueue({
        prompt: {
          prefix: body.promptPrefix ?? settings.promptPrefix,
          body: asset.prompt.body,
          suffix: body.promptSuffix ?? settings.promptSuffix
        },
        generation: body.useStoredGeneration === false ? settings.generation : asset.generation,
        processing: body.useStoredProcessing === false ? settings.processing : asset.processing,
        folder: asset.folder,
        template: asset.template,
        label: `rerun ${asset.name}`,
        rerunOf: asset.id,
        batchId,
        batchIndex: index + 1,
        batchSize: targets.length
      })
    );
  });

  return NextResponse.json({ jobs });
}
