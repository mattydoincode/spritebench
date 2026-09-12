import { NextResponse } from "next/server";
import { describeSettings } from "@/core/describe";
import { applyPipeline } from "@/core/pipeline";
import { getAssetRow, setAssetExport, toAssetRecord } from "@/db/repo/assets";
import { getProject } from "@/db/repo/projects";
import { readDoc } from "@/db/repo/projectDoc";
import { projectContext } from "@/server/access";
import { loadPalette } from "@/server/palettes";
import { decodePng, encodePng } from "@/server/png";
import { approveBodySchema, parseBody, withValidation } from "@/server/validation";
import { docFromState, readAssetEdits } from "@/shared/doc";
import { exportStem, sanitizeName } from "@/shared/naming";
import { exportKey } from "@/storage/keys";
import { ObjectNotFoundError, storage } from "@/storage";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ projectId: string }> };

/**
 * Renders an asset at its current settings and files the PNG under an export
 * key, with a sidecar recording how it was made.
 *
 * The settings come out of the project's Yjs document rather than the asset
 * row, because the row only remembers what the image was generated with --
 * every adjustment since then lives in the document. Yjs runs in Node, so
 * reading it here is the same code the browser uses.
 */
export async function POST(request: Request, { params }: Params) {
  return withValidation(async () => {
    const { projectId } = await projectContext(params, "edit");
    const body = await parseBody(request, approveBodySchema);

    const row = await getAssetRow(projectId, body.assetId);
    if (!row) return NextResponse.json({ error: "asset not found" }, { status: 404 });

    if (!row.sourceKey) {
      return NextResponse.json(
        { error: "this image's full-resolution source has been rolled off and cannot be exported" },
        { status: 410 }
      );
    }

    let sourceBytes;
    try {
      sourceBytes = await storage().get(row.sourceKey);
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        return NextResponse.json({ error: "source bytes are missing" }, { status: 404 });
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

    const folder = sanitizeName(body.subfolder ?? edits?.folder ?? "props", "props");
    const stem = body.name
      ? sanitizeName(body.name, `asset_${asset.seq}`)
      : exportStem(project?.name ?? "project", asset.seq, edits?.name);

    // Re-approving overwrites rather than piling up copies: the key is derived
    // from the name, so the same asset under the same name is the same object.
    const target = exportKey(projectId, folder, stem);

    await storage().put(target, encodePng(image), {
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

    return NextResponse.json({
      asset: updated,
      exported: { path: target, width: image.width, height: image.height }
    });
  });
}
