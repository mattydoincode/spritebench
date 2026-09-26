import { NextResponse } from "next/server";
import { listEngineCollections } from "@/db/repo/engineCollections";
import { listEngineSlots, upsertCatalog } from "@/db/repo/engineSlots";
import { v1ProjectContext } from "@/server/v1";
import { catalogBodySchema, parseBody, withValidation } from "@/server/validation";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ projectId: string }> };

export async function GET(request: Request, { params }: Params) {
  return withValidation(async () => {
    const { projectId } = await v1ProjectContext(request, params, "view");
    return NextResponse.json({
      slots: await listEngineSlots(projectId),
      collections: await listEngineCollections(projectId)
    });
  });
}

export async function POST(request: Request, { params }: Params) {
  return withValidation(async () => {
    const { projectId } = await v1ProjectContext(request, params, "edit");
    const body = await parseBody(request, catalogBodySchema);
    const slots = await upsertCatalog(
      projectId,
      body.slots.map((slot) => ({
        ...slot,
        intent: slot.intent ?? (slot.kind === "set_bag" ? "textures" : "texture"),
        localHash: slot.localHash ?? null
      })),
      body.collections
    );
    return NextResponse.json({
      slots,
      collections: await listEngineCollections(projectId)
    });
  });
}
