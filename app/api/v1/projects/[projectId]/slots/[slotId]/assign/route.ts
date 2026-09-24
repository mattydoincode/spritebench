import { NextResponse } from "next/server";
import { assignEngineSlot, getEngineSlot } from "@/db/repo/engineSlots";
import { ApproveError } from "@/server/approve";
import { exportSlotAssignment } from "@/server/engineExport";
import { v1ProjectContext } from "@/server/v1";
import { assignSlotBodySchema, parseBody, withValidation } from "@/server/validation";
import {
  ASSIGN_STREAM_FLUSH_PAD,
  ASSIGN_STREAM_TYPE,
  encodeAssignEvent,
  type AssignStreamEvent
} from "@/shared/assignStream";
import { mergeSlotAssignment, replaceSlotAssignment } from "@/shared/engineSlot";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: Promise<{ projectId: string; slotId: string }> };

export async function POST(request: Request, { params }: Params) {
  return withValidation(async () => {
    const { projectId } = await v1ProjectContext(request, params, "edit");
    const { slotId } = await params;
    const body = await parseBody(request, assignSlotBodySchema);

    const existing = await getEngineSlot(projectId, slotId);
    if (!existing || existing.tombstonedAt) {
      return NextResponse.json({ error: "slot not found" }, { status: 404 });
    }

    const intent = existing.intent ?? "texture";
    const assetIds = body.replace
      ? replaceSlotAssignment(intent, body.assetIds)
      : mergeSlotAssignment(intent, existing.assignedAssetIds ?? [], body.assetIds);

    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();

    const send = async (event: AssignStreamEvent) => {
      await writer.write(encoder.encode(encodeAssignEvent(event)));
      await writer.write(encoder.encode(ASSIGN_STREAM_FLUSH_PAD));
    };

    void (async () => {
      try {
        await send({ type: "plan", assetIds });
        if (assetIds.length === 0 && intent !== "textures") {
          const slot = await assignEngineSlot(projectId, slotId, [], null);
          if (!slot) {
            await send({ type: "error", error: "slot not found" });
            return;
          }
          await send({ type: "done", slot });
          return;
        }
        const exported = await exportSlotAssignment(
          projectId,
          slotId,
          assetIds,
          intent,
          (assetId) => send({ type: "progress", assetId })
        );
        const slot = await assignEngineSlot(projectId, slotId, assetIds, exported.remoteHash);
        if (!slot) {
          await send({ type: "error", error: "slot not found" });
          return;
        }
        await send({ type: "done", slot });
      } catch (error) {
        if (error instanceof ApproveError) {
          await send({ type: "error", error: error.message });
          return;
        }
        await send({
          type: "error",
          error: error instanceof Error ? error.message : "assign failed"
        });
      } finally {
        await writer.close().catch(() => undefined);
      }
    })();

    return new NextResponse(readable, {
      headers: {
        "Content-Type": ASSIGN_STREAM_TYPE,
        "Cache-Control": "no-store",
        "X-Accel-Buffering": "no"
      }
    });
  });
}
