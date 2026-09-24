import sharp from "sharp";
import { THUMB_MAX_EDGE } from "@/core/size";

export { THUMB_MAX_EDGE };

/**
 * A small WebP preview, generated once on ingest.
 *
 * The library grid draws 96-pixel squares. Without this it downloaded every
 * full-resolution source and ran the whole pipeline over it, so a 200-asset
 * library meant 200 multi-megabyte downloads to render a wall of thumbnails.
 */
export async function buildThumbnail(source: Uint8Array): Promise<Uint8Array> {
  return sharp(source)
    .resize(THUMB_MAX_EDGE, THUMB_MAX_EDGE, {
      fit: "inside",
      withoutEnlargement: true,
      // Nearest keeps pixel art crisp instead of smearing it.
      kernel: "nearest"
    })
    // Lossy WebP smears alpha. The library then flood-fills and snaps that
    // noise, so sprites go see-through or vanish while the inspector (PNG
    // source) stays solid.
    .webp({ lossless: true, effort: 4 })
    .toBuffer();
}
