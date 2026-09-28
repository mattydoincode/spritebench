import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { projectContext } from "@/server/access";
import { UPLOAD_URL_TTL_SECONDS, uploadState } from "@/server/uploads";
import { parseBody, uploadSignBodySchema, withValidation } from "@/server/validation";
import { MAX_UPLOAD_FILES } from "@/shared/uploadLimits";
import { storage } from "@/storage";
import { uploadKey } from "@/storage/keys";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: Promise<{ projectId: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Step one of an upload: a signed PUT URL per file, each good for exactly the
 * size and type declared. The browser sends the bytes straight to storage,
 * then calls `upload/complete`. See `src/server/uploads.ts`.
 */
export async function POST(request: Request, { params }: Params) {
  return withValidation(async () => {
    const { projectId } = await projectContext(params, "edit");
    const { files } = await parseBody(request, uploadSignBodySchema);

    const uploads = await Promise.all(
      files.map(async (file) => {
        const id = crypto.randomUUID();
        const url = await storage().signedUploadUrl(
          uploadKey(projectId, id),
          file.size,
          file.type,
          UPLOAD_URL_TTL_SECONDS
        );
        return { id, url };
      })
    );

    return NextResponse.json({ uploads });
  });
}

/** Where each upload stands, for the browser to poll after `complete`. */
export async function GET(request: Request, { params }: Params) {
  return withValidation(async () => {
    const { projectId } = await projectContext(params, "view");
    const ids = (new URL(request.url).searchParams.get("ids") ?? "")
      .split(",")
      .filter((id) => UUID.test(id))
      .slice(0, MAX_UPLOAD_FILES);

    const states = await Promise.all(ids.map((id) => uploadState(projectId, id)));
    return NextResponse.json({
      states: Object.fromEntries(ids.map((id, index) => [id, states[index]]))
    });
  });
}
