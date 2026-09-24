import { describeSettings } from "@/core/describe";
import { applyPipeline } from "@/core/pipeline";
import { getAssetRow, setAssetExport, toAssetRecord } from "@/db/repo/assets";
import { getProject } from "@/db/repo/projects";
import { readDoc } from "@/db/repo/projectDoc";
import { loadPalette } from "@/server/palettes";
import { decodePng, encodePng } from "@/server/png";
import { docFromState, readAssetEdits } from "@/shared/doc";
import { exportStem, sanitizeName } from "@/shared/naming";
import type { AssetRecord } from "@/shared/model";
import { exportKey } from "@/storage/keys";
import { ObjectNotFoundError, storage } from "@/storage";

export class ApproveError extends Error {
  constructor(
    readonly status: 404 | 410,
    message: string
  ) {
    super(message);
    this.name = "ApproveError";
  }
}

export interface ApprovedExport {
  asset: AssetRecord;
  path: string;
  bytes: Buffer;
  width: number;
  height: number;
}

/**
 * Renders an asset at its current Yjs settings and files the PNG. Shared by
 * the approve route and slot assign/pull so the plugin always gets processed
 * pixels, not the raw source.
 */
export async function approveAsset(
  projectId: string,
  assetId: string,
  options: { name?: string; subfolder?: string } = {}
): Promise<ApprovedExport> {
  const row = await getAssetRow(projectId, assetId);
  if (!row) throw new ApproveError(404, "asset not found");

  if (!row.sourceKey) {
    throw new ApproveError(
      410,
      "this image's full-resolution source has been rolled off and cannot be exported"
    );
  }

  let sourceBytes;
  try {
    sourceBytes = await storage().get(row.sourceKey);
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      throw new ApproveError(404, "source bytes are missing");
    }
    throw error;
  }

  const asset = toAssetRecord(row);
  const [project, snapshot] = await Promise.all([getProject(projectId), readDoc(projectId)]);

  const edits = readAssetEdits(docFromState(snapshot.state), asset.id);
  const processing = edits?.processing ?? asset.generatedWith;

  const palette = processing.paletteId
    ? await loadPalette(projectId, processing.paletteId)
    : [];

  const { image, description } = applyPipeline(
    decodePng(Buffer.from(sourceBytes)),
    processing,
    palette
  );

  const folder = sanitizeName(options.subfolder ?? edits?.folder ?? "props", "props");
  const stem = options.name
    ? sanitizeName(options.name, `asset_${asset.seq}`)
    : exportStem(project?.name ?? "project", asset.seq, edits?.name);

  const target = exportKey(projectId, folder, stem);
  const bytes = encodePng(image);

  await storage().put(target, bytes, {
    contentType: "image/png",
    cacheControl: "public, max-age=31536000, immutable"
  });

  await storage().put(
    `${target.slice(0, -".png".length)}.json`,
    Buffer.from(
      `${JSON.stringify(
        {
          created_at: new Date().toISOString(),
          asset_number: asset.seq,
          prompt: asset.composedPrompt,
          prompt_prefix: asset.prompt.prefix,
          prompt_body: asset.prompt.body,
          prompt_suffix: asset.prompt.suffix,
          model: asset.generation.model,
          quality: asset.generation.quality,
          background: asset.generation.background,
          source_key: row.sourceKey,
          source_size: `${asset.sourceWidth}x${asset.sourceHeight}`,
          exported_size: `${image.width}x${image.height}`,
          post_processing: description,
          settings_summary: describeSettings(
            processing,
            { width: asset.sourceWidth, height: asset.sourceHeight },
            palette
          ),
          total_tokens: asset.usage?.totalTokens ?? 0,
          elapsed_seconds: asset.elapsedSeconds ?? 0
        },
        null,
        2
      )}\n`
    ),
    { contentType: "application/json" }
  );

  const updated = await setAssetExport(projectId, asset.id, target);
  if (!updated) throw new ApproveError(404, "asset not found");

  return {
    asset: updated,
    path: target,
    bytes: Buffer.from(bytes),
    width: image.width,
    height: image.height
  };
}

export async function exportBytesForAsset(
  projectId: string,
  assetId: string
): Promise<{ bytes: Buffer; path: string } | null> {
  const row = await getAssetRow(projectId, assetId);
  if (!row?.exportKey) return null;

  try {
    const bytes = await storage().get(row.exportKey);
    return { bytes: Buffer.from(bytes), path: row.exportKey };
  } catch (error) {
    if (error instanceof ObjectNotFoundError) return null;
    throw error;
  }
}
