import { NextResponse } from "next/server";
import { applyPipeline } from "@/core/pipeline";
import { getAssetRow, toAssetRecord, updateAsset } from "@/db/repo/assets";
import { currentUserId } from "@/db/repo/users";
import { loadPalette } from "@/server/palettes";
import { sanitizeName } from "@/server/naming";
import { decodePng, encodePng } from "@/server/png";
import { approveBodySchema, parseBody, withValidation } from "@/server/validation";
import { basename, exportKey, uniqueKey } from "@/storage/keys";
import { ObjectNotFoundError, storage } from "@/storage";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return withValidation(async () => {
    const body = await parseBody(request, approveBodySchema);
    const userId = await currentUserId();

    const row = await getAssetRow(userId, body.assetId);
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
    const palette = asset.processing.paletteFile
      ? await loadPalette(userId, asset.processing.paletteFile)
      : [];

    const { image, description } = applyPipeline(
      decodePng(Buffer.from(sourceBytes)),
      asset.processing,
      palette
    );

    const folder = sanitizeName(body.subfolder ?? "props", "props");
    const desired = `${sanitizeName(body.name ?? asset.approvedName ?? asset.name, "asset")}.png`;
    const wanted = exportKey(folder, desired);

    // Re-approving under the same name overwrites rather than piling up copies.
    const keepingName = row.exportKey !== null && basename(row.exportKey) === desired;
    const target = keepingName
      ? wanted
      : await uniqueKey(wanted, (candidate) => storage().exists(candidate));

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
            total_tokens: asset.usage?.totalTokens ?? 0,
            elapsed_seconds: asset.elapsedSeconds ?? 0
          },
          null,
          2
        )}\n`
      ),
      { contentType: "application/json" }
    );

    const updated = await updateAsset(userId, asset.id, {
      exportKey: target,
      exportName: basename(target).slice(0, -".png".length),
      processingDescription: description
    });

    return NextResponse.json({
      asset: updated,
      exported: { path: target, width: image.width, height: image.height }
    });
  });
}
