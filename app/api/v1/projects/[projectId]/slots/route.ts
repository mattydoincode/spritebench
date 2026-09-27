import { NextResponse } from "next/server";
import { listEngineCollections } from "@/db/repo/engineCollections";
import { gameLane, listEngineSlots, setGameLane, upsertCatalog } from "@/db/repo/engineSlots";
import { engineSyncedAt, markEngineSynced } from "@/db/repo/projects";
import { v1ProjectContext } from "@/server/v1";
import { catalogBodySchema, parseBody, withValidation } from "@/server/validation";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ projectId: string }> };

export async function GET(request: Request, { params }: Params) {
  return withValidation(async () => {
    const { projectId } = await v1ProjectContext(request, params, "view");
    const [slots, collections, syncedAt, lane] = await Promise.all([
      listEngineSlots(projectId),
      listEngineCollections(projectId),
      engineSyncedAt(projectId),
      gameLane(projectId)
    ]);
    return NextResponse.json({ slots, collections, engineSyncedAt: syncedAt, gameLane: lane });
  });
}

export async function POST(request: Request, { params }: Params) {
  return withValidation(async () => {
    const { projectId } = await v1ProjectContext(request, params, "edit");
    const body = await parseBody(request, catalogBodySchema);
    // Before the catalog, so its synced/pull-available check uses the new lane.
    if (body.lane) await setGameLane(projectId, body.lane);
    const slots = await upsertCatalog(
      projectId,
      body.slots.map((slot) => ({
        ...slot,
        intent: slot.intent ?? (slot.kind === "set_bag" ? "textures" : "texture"),
        localHash: slot.localHash ?? null
      })),
      body.collections
    );
    // Only the plugin posts the catalog, so this is "Godot has synced here".
    await markEngineSynced(projectId);
    return NextResponse.json({
      slots,
      collections: await listEngineCollections(projectId)
    });
  });
}
