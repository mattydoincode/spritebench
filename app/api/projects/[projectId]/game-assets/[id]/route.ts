import { NextResponse } from "next/server";
import {
  CollectionError,
  removeGameTable,
  renameWebTable,
  setWebTableFields
} from "@/db/repo/engineCollections";
import { GameAssetError, removeGameAsset, renameWebAsset } from "@/db/repo/engineSlots";
import { projectContext } from "@/server/access";
import { gameAssetPatchSchema, parseBody, withValidation } from "@/server/validation";
import { gameAssetKey } from "@/shared/engineCollection";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ projectId: string; id: string }> };

function refused(error: unknown): NextResponse | null {
  if (error instanceof GameAssetError || error instanceof CollectionError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  return null;
}

function cleanFields(fields: Array<{ key: string; intent: "texture" | "textures" }>) {
  return fields
    .map((field) => ({ key: gameAssetKey(field.key), intent: field.intent }))
    .filter((field, index, all) => field.key && all.findIndex((other) => other.key === field.key) === index);
}

/**
 * Renames something made in SpriteBench, or replaces a web table's fields.
 * `?table=1`: `id` is a table, otherwise an asset or list.
 */
export async function PATCH(request: Request, { params }: Params) {
  return withValidation(async () => {
    const { projectId } = await projectContext(params, "edit");
    const { id } = await params;
    const table = new URL(request.url).searchParams.get("table") === "1";
    const body = await parseBody(request, gameAssetPatchSchema);

    try {
      if (body.name !== undefined) {
        const key = gameAssetKey(body.name);
        if (!key) return NextResponse.json({ error: "give it a name with letters or digits" }, { status: 400 });
        if (table) await renameWebTable(projectId, id, key);
        else await renameWebAsset(projectId, id, key);
      }
      if (body.fields !== undefined) {
        const renames = (body.renames ?? []).map((rename) => ({
          from: gameAssetKey(rename.from),
          to: gameAssetKey(rename.to)
        }));
        await setWebTableFields(projectId, id, cleanFields(body.fields), renames);
      }
      return NextResponse.json({ ok: true });
    } catch (error) {
      const response = refused(error);
      if (response) return response;
      throw error;
    }
  });
}

/**
 * Removes a game asset or table from SpriteBench. Anything Godot made stays
 * removed even while Godot still lists it; Godot keeps its last art.
 */
export async function DELETE(request: Request, { params }: Params) {
  return withValidation(async () => {
    const { projectId } = await projectContext(params, "edit");
    const { id } = await params;
    const table = new URL(request.url).searchParams.get("table") === "1";

    try {
      if (table) await removeGameTable(projectId, id);
      else await removeGameAsset(projectId, id);
      return NextResponse.json({ ok: true });
    } catch (error) {
      const response = refused(error);
      if (response) return response;
      throw error;
    }
  });
}
