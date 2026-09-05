import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { applyPipeline } from "@/core/pipeline";
import { loadPalette } from "@/server/palettes";
import {
  getAsset,
  sanitizeName,
  serialize,
  uniqueFilePath,
  upsertAsset
} from "@/server/library";
import { ensureFolders, paths, toStoragePath } from "@/server/paths";
import { decodePng, encodePng } from "@/server/png";

export const dynamic = "force-dynamic";

interface ApproveBody {
  assetId: string;
  name?: string;
  subfolder?: string;
}

export async function POST(request: Request) {
  const body = (await request.json()) as ApproveBody;
  ensureFolders();

  const asset = await serialize(() => getAsset(body.assetId));
  if (!asset) return NextResponse.json({ error: "asset not found" }, { status: 404 });

  const sourceFile = path.join(paths.sources, asset.sourceFile);
  if (!fs.existsSync(sourceFile)) {
    return NextResponse.json({ error: `missing source ${asset.sourceFile}` }, { status: 404 });
  }

  const palette = asset.processing.paletteFile ? loadPalette(asset.processing.paletteFile) : [];
  const { image, description } = applyPipeline(
    decodePng(fs.readFileSync(sourceFile)),
    asset.processing,
    palette
  );

  const folder = body.subfolder
    ? path.join(paths.exports, "..", sanitizeName(body.subfolder, "props"))
    : paths.exports;
  fs.mkdirSync(folder, { recursive: true });

  const desired = `${sanitizeName(body.name ?? asset.approvedName ?? asset.name, "asset")}.png`;
  const keepingName =
    asset.approvedPath !== null && path.basename(asset.approvedPath) === desired;

  const target = keepingName
    ? path.join(folder, desired)
    : await serialize(() => uniqueFilePath(folder, desired));

  fs.writeFileSync(target, encodePng(image));

  const sidecar = `${target.slice(0, -path.extname(target).length)}.json`;
  fs.writeFileSync(
    sidecar,
    `${JSON.stringify(
      {
        created_at: new Date().toISOString(),
        prompt: asset.composedPrompt,
        prompt_prefix: asset.prompt.prefix,
        prompt_body: asset.prompt.body,
        prompt_suffix: asset.prompt.suffix,
        model: asset.generation.model,
        quality: asset.generation.quality,
        background: asset.generation.background,
        source_path: toStoragePath(sourceFile),
        source_size: `${asset.sourceWidth}x${asset.sourceHeight}`,
        exported_size: `${image.width}x${image.height}`,
        post_processing: description,
        total_tokens: asset.usage?.totalTokens ?? 0,
        elapsed_seconds: asset.elapsedSeconds ?? 0
      },
      null,
      2
    )}\n`
  );

  const updated = await serialize(() =>
    upsertAsset({
      ...asset,
      approvedPath: toStoragePath(target),
      approvedName: path.basename(target, ".png"),
      processingDescription: description
    })
  );

  return NextResponse.json({
    asset: updated,
    exported: { path: toStoragePath(target), width: image.width, height: image.height }
  });
}
