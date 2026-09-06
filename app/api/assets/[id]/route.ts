import { NextResponse } from "next/server";
import { softDeleteAsset, updateAsset } from "@/db/repo/assets";
import { currentUserId } from "@/db/repo/users";
import { assetPatchSchema, parseBody, withValidation } from "@/server/validation";
import { storage } from "@/storage";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withValidation(async () => {
    const { id } = await params;
    const body = await parseBody(request, assetPatchSchema);
    const userId = await currentUserId();

    const updated = await updateAsset(userId, id, {
      name: body.name,
      folder: body.folder,
      tags: body.tags,
      processing: body.processing,
      ...(body.approvedName !== undefined ? { exportName: body.approvedName } : {})
    });

    if (!updated) return NextResponse.json({ error: "asset not found" }, { status: 404 });
    return NextResponse.json({ asset: updated });
  });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const removeFiles = new URL(request.url).searchParams.get("files") === "true";
  const userId = await currentUserId();

  const row = await softDeleteAsset(userId, id);
  if (!row) return NextResponse.json({ error: "asset not found" }, { status: 404 });

  // The row is soft-deleted either way; `files=true` also drops the bytes.
  if (removeFiles) {
    if (row.sourceKey) await storage().delete(row.sourceKey);
    if (row.thumbKey) await storage().delete(row.thumbKey);
  }

  return NextResponse.json({ ok: true });
}
