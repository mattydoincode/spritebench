import { describe, expect, it } from "vitest";
import { createSlotQueue } from "@/client/slotQueue";
import { describeSlotActivity, emptyAssignProgress } from "@/shared/assignStream";
import { applySlotEdits, sameAssignment } from "@/shared/slotEdits";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
}

describe("applySlotEdits", () => {
  it("applies a remove queued behind an add to the added list", () => {
    expect(
      applySlotEdits("textures", ["a"], [
        { type: "add", assetIds: ["b", "c"] },
        { type: "drop", assetIds: ["a"] }
      ])
    ).toEqual(["b", "c"]);
  });

  it("moves by asset id, so an earlier add does not shift the target", () => {
    expect(
      applySlotEdits("textures", ["a", "b"], [
        { type: "add", assetIds: ["c"] },
        { type: "move", assetId: "c", delta: -2 }
      ])
    ).toEqual(["c", "a", "b"]);
  });

  it("keeps the last replace for a still slot", () => {
    expect(
      applySlotEdits("texture", ["a"], [
        { type: "replace", assetIds: ["b"] },
        { type: "replace", assetIds: ["c"] }
      ])
    ).toEqual(["c"]);
  });

  it("compares assignments in order", () => {
    expect(sameAssignment(["a", "b"], ["a", "b"])).toBe(true);
    expect(sameAssignment(["a", "b"], ["b", "a"])).toBe(false);
  });
});

describe("createSlotQueue", () => {
  it("runs different slots in parallel", async () => {
    const started: string[] = [];
    const gate = deferred();
    const queue = createSlotQueue<string>(async (key) => {
      started.push(key);
      await gate.promise;
    });

    const a = queue.enqueue("a", "1");
    const b = queue.enqueue("b", "1");
    await Promise.resolve();
    expect(started).toEqual(["a", "b"]);
    gate.resolve();
    await Promise.all([a, b]);
  });

  it("batches edits queued while a slot is busy into the next run", async () => {
    const batches: string[][] = [];
    const gate = deferred();
    const queued: number[] = [];
    const queue = createSlotQueue<string>(
      async (_key, edits) => {
        batches.push(edits);
        if (batches.length === 1) await gate.promise;
      },
      (_key, count) => queued.push(count)
    );

    const first = queue.enqueue("s", "1");
    const second = queue.enqueue("s", "2");
    const third = queue.enqueue("s", "3");
    expect(queue.pending("s")).toBe(2);
    gate.resolve();
    await Promise.all([first, second, third]);

    expect(batches).toEqual([["1"], ["2", "3"]]);
    expect(queued).toContain(2);
    expect(queue.pending("s")).toBe(0);
  });

  it("keeps draining after a failed run", async () => {
    const batches: string[][] = [];
    const queue = createSlotQueue<string>(async (_key, edits) => {
      batches.push(edits);
      if (edits[0] === "bad") throw new Error("boom");
    });

    await Promise.all([queue.enqueue("s", "bad"), queue.enqueue("s", "good")]);
    expect(batches).toEqual([["bad"], ["good"]]);
  });
});

describe("describeSlotActivity", () => {
  it("reports progress and what is waiting", () => {
    const progress = emptyAssignProgress("s", ["a", "b"]);
    expect(describeSlotActivity(progress, 0)).toBe("processing 1 of 2");
    expect(describeSlotActivity(progress, 3)).toBe("processing 1 of 2 · 3 queued");
    expect(describeSlotActivity(null, 1)).toBe("queued");
  });
});
