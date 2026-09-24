import { NextResponse } from "next/server";
import { listEngineSlots, setSlotRemoteHash } from "@/db/repo/engineSlots";
import { ApproveError } from "@/server/approve";
import { slotExportForPull } from "@/server/engineExport";
import { v1ProjectContext } from "@/server/v1";
import { withValidation } from "@/server/validation";
import { storage } from "@/storage";

export const dynamic = "force-dynamic";

const SIGNED_URL_TTL_SECONDS = 3600;

type Params = { params: Promise<{ projectId: string }> };

/**
 * Slots Godot should write: assigned art whose remote bytes differ from the
 * last successful push, and whose local file was not edited in Godot.
 */
export async function GET(request: Request, { params }: Params) {
  return withValidation(async () => {
    const { projectId } = await v1ProjectContext(request, params, "view");
    const slots = await listEngineSlots(projectId);
    const pullable = slots.filter((slot) => slot.status === "pull_available");

    const items = [];

    for (const slot of pullable) {
      try {
        const exported = await slotExportForPull(projectId, slot);
        await setSlotRemoteHash(projectId, slot.id, exported.remoteHash);

        const base = {
          id: slot.id,
          kind: slot.kind,
          intent: slot.intent,
          label: slot.label,
          godotPath: slot.godotPath,
          remoteHash: exported.remoteHash
        };

        if (exported.intent === "texture") {
          items.push({
            ...base,
            url: await storage().signedUrl(exported.path, SIGNED_URL_TTL_SECONDS)
          });
          continue;
        }

        if (exported.intent === "sprite_frames") {
          items.push({
            ...base,
            bundle: {
              format: "spritebench.clips/1",
              clips: await Promise.all(
                exported.clips.map(async (clip) => ({
                  name: clip.name,
                  fps: clip.fps,
                  loop: clip.loop,
                  frames: await Promise.all(
                    clip.frames.map(async (frame) => ({
                      file: frame.file,
                      hold: frame.hold,
                      url: await storage().signedUrl(frame.path, SIGNED_URL_TTL_SECONDS)
                    }))
                  )
                }))
              )
            }
          });
          continue;
        }

        items.push({
          ...base,
          bundle: {
            format: "spritebench.bag/1",
            frames: await Promise.all(
              exported.frames.map(async (frame) => ({
                file: frame.file,
                url: await storage().signedUrl(frame.path, SIGNED_URL_TTL_SECONDS)
              }))
            )
          }
        });
      } catch (error) {
        if (error instanceof ApproveError) continue;
        throw error;
      }
    }

    return NextResponse.json({ slots: items });
  });
}
