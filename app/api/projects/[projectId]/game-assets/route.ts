import { NextResponse } from "next/server";
import { CollectionError, createWebTable } from "@/db/repo/engineCollections";
import { createWebAsset, GameAssetError } from "@/db/repo/engineSlots";
import { projectContext } from "@/server/access";
import { gameAssetBodySchema, parseBody, withValidation } from "@/server/validation";
import { gameAssetKey } from "@/shared/engineCollection";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ projectId: string }> };

/**
 * A game asset made in SpriteBench rather than in Godot: one image, an
 * ordered list, or a table of rows with named fields. Names become keys the
 * game can look up (`Hero Idle` -> `hero_idle`).
 */
export async function POST(request: Request, { params }: Params) {
  return withValidation(async () => {
    const { projectId } = await projectContext(params, "edit");
    const body = await parseBody(request, gameAssetBodySchema);
    const key = gameAssetKey(body.name);
    if (!key) return NextResponse.json({ error: "give it a name with letters or digits" }, { status: 400 });

    try {
      if (body.type === "table") {
        const fields = body.fields
          .map((field) => ({ key: gameAssetKey(field.key), intent: field.intent }))
          .filter((field, index, all) => field.key && all.findIndex((other) => other.key === field.key) === index);
        if (fields.length === 0) {
          return NextResponse.json({ error: "a table needs at least one field" }, { status: 400 });
        }
        return NextResponse.json({ id: await createWebTable(projectId, key, fields) });
      }

      return NextResponse.json({ id: await createWebAsset(projectId, key, body.type === "list") });
    } catch (error) {
      if (error instanceof GameAssetError || error instanceof CollectionError) {
        return NextResponse.json({ error: error.message }, { status: error.status });
      }
      throw error;
    }
  });
}
