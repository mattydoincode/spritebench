import { NextResponse } from "next/server";
import { dispatchIngest } from "@/queue/dispatch";
import { projectContext } from "@/server/access";
import { parseBody, uploadCompleteBodySchema, withValidation } from "@/server/validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: Promise<{ projectId: string }> };

/**
 * Step two: the files are in storage, so hand them to the worker. An id that
 * was never uploaded just fails there; the project in the staging key is
 * this one, so nothing outside it can be named.
 */
export async function POST(request: Request, { params }: Params) {
  return withValidation(async () => {
    const { projectId, userId } = await projectContext(params, "edit");
    const { uploads } = await parseBody(request, uploadCompleteBodySchema);

    for (const upload of uploads) {
      await dispatchIngest({
        projectId,
        uploadId: upload.id,
        userId,
        name: upload.name.replace(/\.[^.]+$/, "")
      });
    }

    return NextResponse.json({ ok: true });
  });
}
