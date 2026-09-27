import { NextResponse } from "next/server";
import { CollectionError, deleteWebTable, setWebTableFields } from "@/db/repo/engineCollections";
import { deleteWebAsset, GameAssetError } from "@/db/repo/engineSlots";
import { projectContext } from "@/server/access";
import { gameTableFieldsSchema, parseBody, withValidation } from "@/server/validation";
import { gameAssetKey } from "@/shared/engineCollection";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ projectId: string; id: string }> };

function refused(error: unknown): NextResponse | null {
  if (error instanceof GameAssetError || error instanceof CollectionError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  return null;
}

/** A web table's fields. `?table=1`: `id` is a table, otherwise an asset or list. */
export async function PATCH(request: Request, { params }: Params) {
  return withValidation(async () => {
    const { projectId } = await projectContext(params, "edit");
    const { id } = await params;
    const body = await parseBody(request, gameTableFieldsSchema);
    const fields = body.fields
      .map((field) => ({ key: gameAssetKey(field.key), intent: field.intent }))
      .filter((field, index, all) => field.key && all.findIndex((other) => other.key === field.key) === index);

    try {
      await setWebTableFields(projectId, id, fields);
      return NextResponse.json({ ok: true });
    } catch (error) {
      const response = refused(error);
      if (response) return response;
      throw error;
    }
  });
}

/** Removes something made in SpriteBench. Godot's own are removed in Godot. */
export async function DELETE(request: Request, { params }: Params) {
  return withValidation(async () => {
    const { projectId } = await projectContext(params, "edit");
    const { id } = await params;
    const table = new URL(request.url).searchParams.get("table") === "1";

    try {
      if (table) await deleteWebTable(projectId, id);
      else await deleteWebAsset(projectId, id);
      return NextResponse.json({ ok: true });
    } catch (error) {
      const response = refused(error);
      if (response) return response;
      throw error;
    }
  });
}
