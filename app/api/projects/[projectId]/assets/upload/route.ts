import crypto from "node:crypto";
import { NextResponse } from "next/server";
import sharp from "sharp";
import { UPLOAD_PROCESSING } from "@/core/settings";
import { insertAsset } from "@/db/repo/assets";
import { projectContext } from "@/server/access";
import { buildThumbnail } from "@/server/thumbnails";
import { withValidation } from "@/server/validation";
import { DEFAULT_GENERATION } from "@/shared/model";
import { storage } from "@/storage";
import { sourceKey, thumbKey } from "@/storage/keys";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: Promise<{ projectId: string }> };

const MAX_FILES = 20;
const MAX_BYTES = 25 * 1024 * 1024;

/**
 * A person's own images into the library -- an artist's finals, most often.
 * Anything sharp can read is stored as PNG (alpha kept), marked "uploaded",
 * and set to as-is processing so nothing is cut out or shrunk on the way in.
 */
export async function POST(request: Request, { params }: Params) {
  return withValidation(async () => {
    const { projectId, userId } = await projectContext(params, "edit");
    const form = await request.formData();
    const files = form.getAll("files").filter((entry): entry is File => entry instanceof File);

    if (files.length === 0) return NextResponse.json({ error: "no files" }, { status: 400 });
    if (files.length > MAX_FILES) {
      return NextResponse.json({ error: `at most ${MAX_FILES} files at once` }, { status: 400 });
    }

    const created: string[] = [];
    const skipped: string[] = [];

    for (const file of files) {
      if (file.size > MAX_BYTES) {
        skipped.push(`${file.name} is over 25 MB`);
        continue;
      }

      let png: Buffer;
      let width: number;
      let height: number;
      try {
        const { data, info } = await sharp(Buffer.from(await file.arrayBuffer()))
          .png()
          .toBuffer({ resolveWithObject: true });
        png = data;
        width = info.width;
        height = info.height;
      } catch {
        skipped.push(`${file.name} is not an image`);
        continue;
      }

      const assetId = crypto.randomUUID();
      const key = sourceKey(projectId, assetId);
      await storage().put(key, png, {
        contentType: "image/png",
        cacheControl: "public, max-age=31536000, immutable"
      });

      let thumb: string | null = null;
      try {
        thumb = thumbKey(projectId, assetId);
        await storage().put(thumb, await buildThumbnail(png), {
          contentType: "image/webp",
          cacheControl: "public, max-age=31536000, immutable"
        });
      } catch {
        thumb = null;
      }

      const name = file.name.replace(/\.[^.]+$/, "");
      await insertAsset({
        id: assetId,
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
      created.push(assetId);
    }

    return NextResponse.json({ assetIds: created, skipped });
  });
}
