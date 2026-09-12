import { describe, expect, it } from "vitest";
import {
  attachSet,
  faceId,
  isLibraryVisible,
  sequenceFromSet,
  setSpecFromInputs,
  slotFromIndex,
  upsertMember,
  type AssetSet
} from "@/shared/assetSet";
import { frameSourceAssetId } from "@/shared/sequence";
import type { ResolvedAsset } from "@/shared/model";

function set(overrides: Partial<AssetSet> = {}): AssetSet {
  return {
    id: "batch",
    kind: "animation",
    columns: 4,
    rows: 1,
    view: "animate",
    members: [
      { assetId: "a", index: 0, col: 0, row: 0 },
      { assetId: "b", index: 1, col: 1, row: 0 }
    ],
    ...overrides
  };
}

describe("slotFromIndex", () => {
  it("maps a chunk index onto the source grid", () => {
    expect(slotFromIndex(0, 2)).toEqual({ col: 0, row: 0 });
    expect(slotFromIndex(1, 2)).toEqual({ col: 1, row: 0 });
    expect(slotFromIndex(2, 2)).toEqual({ col: 0, row: 1 });
    expect(slotFromIndex(3, 2)).toEqual({ col: 1, row: 1 });
  });
});

describe("setSpecFromInputs", () => {
  it("places a loop step in order", () => {
    expect(
      setSpecFromInputs({ loop: { steps: 4, index: 2 } })
    ).toEqual({ kind: "animation", columns: 4, rows: 1, index: 1, col: 1, row: 0 });
  });

  it("places a chunk cell on the source grid", () => {
    expect(
      setSpecFromInputs({
        chunk: { columns: 2, rows: 2, index: 3, rect: { x: 8, y: 8, width: 8, height: 8 } }
      })
    ).toEqual({ kind: "grid", columns: 2, rows: 2, index: 3, col: 1, row: 1 });
  });

  it("ignores a request that has not been expanded yet", () => {
    expect(setSpecFromInputs({ loop: { steps: 4 } })).toBeNull();
    expect(setSpecFromInputs({ chunk: { columns: 2, rows: 2 } })).toBeNull();
  });
});

describe("upsertMember", () => {
  it("inserts in index order and is idempotent per asset", () => {
    const first = upsertMember(set({ members: [] }), { assetId: "b", index: 1, col: 1, row: 0 });
    const second = upsertMember(first, { assetId: "a", index: 0, col: 0, row: 0 });
    const again = upsertMember(second, { assetId: "b", index: 1, col: 1, row: 0 });

    expect(second.members.map((entry) => entry.assetId)).toEqual(["a", "b"]);
    expect(faceId(second)).toBe("a");
    expect(again.members).toHaveLength(2);
  });
});

describe("isLibraryVisible", () => {
  it("always shows the face and hides the rest until extracted", () => {
    const group = set();
    expect(isLibraryVisible("a", true, group)).toBe(true);
    expect(isLibraryVisible("b", true, group)).toBe(false);
    expect(isLibraryVisible("b", false, group)).toBe(true);
    expect(isLibraryVisible("solo", true, null)).toBe(true);
  });
});

describe("sequenceFromSet", () => {
  it("builds full-image frames from each member, in view order", () => {
    const sizes = {
      a: { width: 16, height: 16 },
      b: { width: 32, height: 24 }
    };

    const loop = sequenceFromSet(set(), sizes);
    expect(loop.kind).toBe("animation");
    expect(loop.frames.map((frame) => frame.sourceAssetId)).toEqual(["a", "b"]);
    expect(loop.frames[1].rect).toEqual({ x: 0, y: 0, width: 32, height: 24 });

    const grid = sequenceFromSet(
      set({
        kind: "grid",
        view: "grid",
        columns: 2,
        rows: 2,
        members: [
          { assetId: "b", index: 1, col: 1, row: 0 },
          { assetId: "a", index: 0, col: 0, row: 0 }
        ]
      }),
      sizes
    );
    expect(grid.kind).toBe("set");
    expect(grid.frames.map((frame) => frame.sourceAssetId)).toEqual(["a", "b"]);
  });
});

describe("attachSet", () => {
  it("injects the derived sequence on the face only", () => {
    const face = attachSet({ id: "a", sequences: [] } as unknown as ResolvedAsset, set(), {
      a: { width: 8, height: 8 },
      b: { width: 8, height: 8 }
    });
    const member = attachSet({ id: "b", sequences: [] } as unknown as ResolvedAsset, set(), {
      a: { width: 8, height: 8 },
      b: { width: 8, height: 8 }
    });

    expect(face.sequences[0]?.id).toBe("set:batch");
    expect(member.sequences).toEqual([]);
    expect(member.set?.id).toBe("batch");
  });
});

describe("frameSourceAssetId", () => {
  it("follows the frame, then the parent", () => {
    expect(
      frameSourceAssetId("parent", {
        id: "f",
        sourceAssetId: "other",
        rect: { x: 0, y: 0, width: 1, height: 1 },
        edits: [],
        hold: 1
      })
    ).toBe("other");
    expect(
      frameSourceAssetId("parent", {
        id: "f",
        sourceAssetId: "",
        rect: { x: 0, y: 0, width: 1, height: 1 },
        edits: [],
        hold: 1
      })
    ).toBe("parent");
  });
});
