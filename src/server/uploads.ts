import sharp from "sharp";
import { UPLOAD_PROCESSING } from "@/core/settings";
import { getAssetRow, insertAsset } from "@/db/repo/assets";
import { buildThumbnail } from "@/server/thumbnails";
import { DEFAULT_GENERATION } from "@/shared/model";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_PIXELS } from "@/shared/uploadLimits";
import { ObjectNotFoundError, storage } from "@/storage";
import { sourceKey, thumbKey, uploadKey } from "@/storage/keys";

/**
 * A person's own images into the library -- an artist's finals, most often.
 *
 * The browser PUTs each file straight to a staging key with a signed URL, so
 * upload bytes never pass through the web service. The worker then does the
 * part that needs memory: decode, re-encode as PNG (alpha kept), thumbnail,
 * and the asset row, marked "uploaded" with as-is processing so nothing is cut
 * out or shrunk on the way in.
 */

/** Long enough for a big file on a slow connection. */
export const UPLOAD_URL_TTL_SECONDS = 15 * 60;

export interface IngestPayload {
  projectId: string;
  uploadId: string;
  userId: string;
  /** The file name without its extension; the library searches it. */
  name: string;
}

export type UploadState = "done" | "pending" | "failed";

/**
 * Turns one staged upload into an asset. Returns false when the file is not
 * an image this can take, which is final: the staging copy is removed, and
 * that absence is how the browser learns it was refused.
 *
 * Throws only on failures worth retrying (storage or database trouble).
 */
export async function ingestUpload(payload: IngestPayload): Promise<boolean> {
  const { projectId, uploadId, userId, name } = payload;
  const staged = uploadKey(projectId, uploadId);

  // A retry after the row landed but before cleanup.
  if (await getAssetRow(projectId, uploadId)) {
    await storage().delete(staged);
    return true;
  }

  let bytes: Uint8Array;
  try {
    bytes = await storage().get(staged);
  } catch (error) {
    if (error instanceof ObjectNotFoundError) return false;
    throw error;
  }

  if (bytes.byteLength > MAX_UPLOAD_BYTES) {
    await storage().delete(staged);
    return false;
  }

  let png: Buffer;
  let width: number;
  let height: number;
  try {
    const { data, info } = await sharp(bytes, { limitInputPixels: MAX_UPLOAD_PIXELS })
      .png()
      .toBuffer({ resolveWithObject: true });
    png = data;
    width = info.width;
    height = info.height;
  } catch {
    await storage().delete(staged);
    return false;
  }

  const key = sourceKey(projectId, uploadId);
  await storage().put(key, png, {
    contentType: "image/png",
    cacheControl: "public, max-age=31536000, immutable"
  });

  let thumb: string | null = thumbKey(projectId, uploadId);
  try {
    await storage().put(thumb, await buildThumbnail(png), {
      contentType: "image/webp",
      cacheControl: "public, max-age=31536000, immutable"
    });
  } catch {
    thumb = null;
  }

  await insertAsset({
    id: uploadId,
    projectId,
    createdByUserId: userId,
    origin: "uploaded",
    sourceKey: key,
    thumbKey: thumb,
    sourceWidth: width,
    sourceHeight: height,
    byteSize: png.length,
    // The prompt is where the library searches; the file name is the
    // closest thing an upload has to one.
    prompt: { prefix: "", body: name, suffix: "" },
    composedPrompt: "",
    generation: DEFAULT_GENERATION,
    processing: UPLOAD_PROCESSING,
    rerunOf: null,
    jobId: null,
    inputs: null,
    sequencePlan: null
  });

  // Last, so there is never a moment with neither the staging copy nor the
  // asset -- which the status check would read as "refused".
  await storage().delete(staged);
  return true;
}

/** An asset means done; a staging copy means the worker has not got to it. */
export async function uploadState(projectId: string, uploadId: string): Promise<UploadState> {
  if (await getAssetRow(projectId, uploadId)) return "done";
  if (await storage().exists(uploadKey(projectId, uploadId))) return "pending";
  return "failed";
}
