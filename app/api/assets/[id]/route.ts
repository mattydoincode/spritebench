import { NextResponse } from "next/server";
import { withDefaults } from "@/core/settings";
import { deleteAsset, getAsset, serialize, upsertAsset } from "@/server/library";
import type { AssetRecord } from "@/shared/model";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await request.json()) as Partial<AssetRecord>;

  const updated = await serialize(() => {
    const current = getAsset(id);
    if (!current) return null;

    return upsertAsset({
      ...current,
      ...body,
      id: current.id,
      processing: body.processing ? withDefaults(body.processing) : current.processing
    });
  });

  if (!updated) return NextResponse.json({ error: "asset not found" }, { status: 404 });
  return NextResponse.json({ asset: updated });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const removeFiles = new URL(request.url).searchParams.get("files") === "true";

  await serialize(() => deleteAsset(id, removeFiles));
  return NextResponse.json({ ok: true });
}
