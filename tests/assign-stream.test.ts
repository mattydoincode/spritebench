import { describe, expect, it } from "vitest";
import {
  applyAssignStreamEvent,
  consumeAssignEvents,
  ASSIGN_STREAM_FLUSH_PAD,
  currentAssignAssetId,
  describeAssignProgress,
  emptyAssignProgress,
  encodeAssignEvent,
  parseAssignStreamLine,
  splitNdjson
} from "@/shared/assignStream";
import type { EngineSlotRecord } from "@/shared/engineSlot";

const slot: EngineSlotRecord = {
  id: "slot",
  kind: "set_bag",
  intent: "textures",
  label: "cars",
  godotPath: "res://cars",
  assignedAssetIds: ["a", "b"],
  localHash: null,
  lastPushedHash: null,
  remoteHash: "abc",
  status: "pull_available",
  lastSeenAt: "2026-01-01T00:00:00.000Z",
  tombstonedAt: null
};

async function* chunks(...parts: string[]): AsyncGenerator<string> {
  for (const part of parts) yield part;
}

describe("assign stream", () => {
  it("round-trips events and holds a partial line", () => {
    const planned = encodeAssignEvent({ type: "plan", assetIds: ["a", "b"] });
    const progressed = encodeAssignEvent({ type: "progress", assetId: "a" });

    expect(parseAssignStreamLine(planned)).toEqual({ type: "plan", assetIds: ["a", "b"] });
    expect(splitNdjson(planned.slice(0, 8)).events).toEqual([]);
    expect(splitNdjson(`${planned}${progressed}`).events).toEqual([
      { type: "plan", assetIds: ["a", "b"] },
      { type: "progress", assetId: "a" }
    ]);
  });

  it("tracks which ids are done and names the count", () => {
    let progress = emptyAssignProgress("slot", ["x"]);
    progress = applyAssignStreamEvent(progress, { type: "plan", assetIds: ["a", "b", "c"] });
    expect(describeAssignProgress(progress)).toBe("processing 1 of 3");
    expect(currentAssignAssetId(progress)).toBe("a");

    progress = applyAssignStreamEvent(progress, { type: "progress", assetId: "a" });
    progress = applyAssignStreamEvent(progress, { type: "progress", assetId: "a" });
    expect(progress.completedIds).toEqual(["a"]);
    expect(currentAssignAssetId(progress)).toBe("b");
    expect(describeAssignProgress(progress)).toBe("processing 2 of 3");
  });

  it("returns the slot after a split stream", async () => {
    const seen: string[] = [];
    const first = encodeAssignEvent({ type: "plan", assetIds: ["a", "b"] });
    const rest = [
      encodeAssignEvent({ type: "progress", assetId: "a" }),
      encodeAssignEvent({ type: "progress", assetId: "b" }),
      encodeAssignEvent({ type: "done", slot })
    ].join("");

    const result = await consumeAssignEvents(
      chunks(first.slice(0, 10), first.slice(10) + rest),
      (event) => {
        seen.push(event.type);
      }
    );

    expect(result).toEqual(slot);
    expect(seen).toEqual(["plan", "progress", "progress", "done"]);
  });

  it("ignores flush padding between events", async () => {
    const seen: string[] = [];
    const result = await consumeAssignEvents(
      chunks(
        encodeAssignEvent({ type: "plan", assetIds: ["a"] }),
        ASSIGN_STREAM_FLUSH_PAD,
        encodeAssignEvent({ type: "progress", assetId: "a" }),
        ASSIGN_STREAM_FLUSH_PAD,
        encodeAssignEvent({ type: "done", slot })
      ),
      (event) => {
        seen.push(event.type);
      }
    );

    expect(result).toEqual(slot);
    expect(seen).toEqual(["plan", "progress", "done"]);
  });

  it("throws the streamed error", async () => {
    await expect(
      consumeAssignEvents(chunks(encodeAssignEvent({ type: "error", error: "asset not found" })), () => {
        /* ignore */
      })
    ).rejects.toThrow("asset not found");
  });
});
