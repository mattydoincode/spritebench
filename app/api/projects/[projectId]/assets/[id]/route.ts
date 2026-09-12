import { NextResponse } from "next/server";
import { softDeleteAsset } from "@/db/repo/assets";
import { projectContext } from "@/server/access";
import { withValidation } from "@/server/validation";
import { storage } from "@/storage";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ projectId: string; id: string }> };

/**
 * Delete is the only thing left to do to an asset row. Renaming, retagging,
 * refoldering and every processing change happen in the project's Yjs
 * document, which is why there is no PATCH here any more.
 */
export async function DELETE(request: Request, { params }: Params) {
  return withValidation(async () => {
    const { projectId } = await projectContext(params, "edit");
    const { id } = await params;
    const removeFiles = new URL(request.url).searchParams.get("files") === "true";

    const row = await softDeleteAsset(projectId, id);
    if (!row) return NextResponse.json({ error: "asset not found" }, { status: 404 });

    // The row is soft-deleted either way; `files=true` also drops the bytes.
    if (removeFiles) {
      if (row.sourceKey) await storage().delete(row.sourceKey);
      if (row.thumbKey) await storage().delete(row.thumbKey);
    }

    return NextResponse.json({ ok: true });
  });
}
