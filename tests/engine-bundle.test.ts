import { describe, expect, it } from "vitest";
import { hashExportBytes } from "@/server/apiToken";
import {
  describeShipment,
  hashBundleText,
  planBundle,
  planTexturesBag,
  spriteFramesBundleText,
  texturesBundleText,
  type BundleAsset
} from "@/shared/engineBundle";
import { NO_INSET, type Sequence } from "@/shared/sequence";
import type { AssetSet } from "@/shared/assetSet";

function frame(id: string, hold = 1): Sequence["frames"][number] {
  return {
    id,
    sourceAssetId: "sheet",
    rect: { x: 0, y: 0, width: 8, height: 8 },
    edits: [],
    hold
  };
}

function sequence(overrides: Partial<Sequence> & Pick<Sequence, "id" | "name">): Sequence {
  return {
    fps: 6,
    playback: "loop",
    inset: { ...NO_INSET },
    frames: [frame("f0"), frame("f1"), frame("f2"), frame("f3")],
    ...overrides
  };
}

function asset(overrides: Partial<BundleAsset> = {}): BundleAsset {
  return {
    id: "sheet",
    sequences: [],
    set: null,
    ...overrides
  };
}

const set: AssetSet = {
  id: "batch",
  kind: "animation",
  columns: 3,
  rows: 1,
  view: "animate",
  members: [
    { assetId: "sheet", index: 0, col: 0, row: 0 },
    { assetId: "b", index: 1, col: 1, row: 0 },
    { assetId: "c", index: 2, col: 2, row: 0 }
  ]
};

describe("planBundle", () => {
  it("skips kind:set sequences when exporting sprite frames", () => {
    const planned = planBundle("sprite_frames", asset({
      sequences: [
        sequence({ id: "walk", name: "walk" }),
        sequence({ id: "loot", name: "loot", kind: "set" })
      ]
    }));

    expect(planned.intent).toBe("sprite_frames");
    if (planned.intent !== "sprite_frames") return;
    expect(planned.clips.map((clip) => clip.name)).toEqual(["walk"]);
  });

  it("expands ping-pong without repeating the endpoints", () => {
    const planned = planBundle("sprite_frames", asset({
      sequences: [sequence({ id: "walk", name: "walk", playback: "pingPong" })]
    }));

    expect(planned.intent).toBe("sprite_frames");
    if (planned.intent !== "sprite_frames") return;
    expect(planned.clips[0].frames.map((frame) => frame.mode === "sequence" && frame.frameIndex)).toEqual([
      0, 1, 2, 3, 2, 1
    ]);
    expect(planned.clips[0].loop).toBe(true);
  });

  it("uses a default still clip when there are no animations", () => {
    const planned = planBundle("sprite_frames", asset());
    expect(planned.intent).toBe("sprite_frames");
    if (planned.intent !== "sprite_frames") return;
    expect(planned.clips).toEqual([
      {
        name: "default",
        fps: 6,
        loop: true,
        frames: [{ mode: "still", assetId: "sheet", hold: 1, file: "default_00.png" }]
      }
    ]);
  });

  it("prefers kind:set sequences for a bag over AssetSet members", () => {
    const planned = planBundle("textures", asset({
      set,
      sequences: [
        sequence({
          id: "tiles",
          name: "tiles",
          kind: "set",
          frames: [frame("a"), frame("b")]
        })
      ]
    }));

    expect(planned.intent).toBe("textures");
    if (planned.intent !== "textures") return;
    expect(planned.frames).toHaveLength(2);
    expect(planned.frames.map((entry) => entry.file)).toEqual(["00.png", "01.png"]);
    expect(planned.frames.every((entry) => entry.mode === "sequence")).toBe(true);
  });

  it("uses AssetSet members in index order when the assigned asset is the face", () => {
    const planned = planBundle("textures", asset({ set }));
    expect(planned.intent).toBe("textures");
    if (planned.intent !== "textures") return;
    expect(planned.frames.map((entry) => entry.mode === "still" && entry.assetId)).toEqual([
      "sheet",
      "b",
      "c"
    ]);
  });

  it("does not flatten a walk cycle into a bag", () => {
    const planned = planBundle("textures", asset({
      sequences: [sequence({ id: "walk", name: "walk" })]
    }));

    expect(planned.intent).toBe("textures");
    if (planned.intent !== "textures") return;
    expect(planned.frames).toEqual([
      { mode: "still", assetId: "sheet", hold: 1, file: "00.png" }
    ]);
  });
});

describe("planTexturesBag", () => {
  it("concatenates every assigned still and renumbers the bag", () => {
    const planned = planTexturesBag([asset({ id: "a" }), asset({ id: "b" }), asset({ id: "c" })]);
    expect(planned.intent).toBe("textures");
    if (planned.intent !== "textures") return;
    expect(planned.frames.map((entry) => entry.mode === "still" && entry.assetId)).toEqual([
      "a",
      "b",
      "c"
    ]);
    expect(planned.frames.map((entry) => entry.file)).toEqual(["00.png", "01.png", "02.png"]);
  });

  it("keeps set expansion when a face is one of several assigned assets", () => {
    const planned = planTexturesBag([asset({ set }), asset({ id: "extra" })]);
    expect(planned.intent).toBe("textures");
    if (planned.intent !== "textures") return;
    expect(planned.frames.map((entry) => entry.mode === "still" && entry.assetId)).toEqual([
      "sheet",
      "b",
      "c",
      "extra"
    ]);
  });
});

describe("bundle hash", () => {
  it("is stable and name-sorted", () => {
    const left = hashBundleText(
      spriteFramesBundleText([
        { name: "walk", fps: 8, loop: true, frames: [{ hold: 1, sha256: "aa" }] },
        { name: "idle", fps: 6, loop: true, frames: [{ hold: 2, sha256: "bb" }] }
      ]),
      hashExportBytes
    );
    const right = hashBundleText(
      spriteFramesBundleText([
        { name: "idle", fps: 6, loop: true, frames: [{ hold: 2, sha256: "bb" }] },
        { name: "walk", fps: 8, loop: true, frames: [{ hold: 1, sha256: "aa" }] }
      ]),
      hashExportBytes
    );

    expect(left).toBe(right);
    expect(left).toMatch(/^[0-9a-f]{64}$/);
    expect(
      spriteFramesBundleText([
        { name: "idle", fps: 6, loop: true, frames: [{ hold: 2, sha256: "bb" }] },
        { name: "walk", fps: 8, loop: true, frames: [{ hold: 1, sha256: "aa" }] }
      ])
    ).toBe(
      [
        "spritebench.bundle/1",
        "intent sprite_frames",
        "clip idle 6 1",
        "  2 bb",
        "clip walk 8 1",
        "  1 aa",
        ""
      ].join("\n")
    );
  });

  it("hashes a bag as hold-1 lines", () => {
    expect(texturesBundleText(["aa", "bb"])).toBe(
      ["spritebench.bundle/1", "intent textures", "  1 aa", "  1 bb", ""].join("\n")
    );
    expect(texturesBundleText([])).toBe(["spritebench.bundle/1", "intent textures", ""].join("\n"));
  });
});

describe("describeShipment", () => {
  it("names clips and bag sizes", () => {
    expect(describeShipment("texture", [asset()])).toBe("still");
    expect(
      describeShipment("sprite_frames", [
        asset({
          sequences: [
            sequence({ id: "idle", name: "idle" }),
            sequence({ id: "walk", name: "walk" })
          ]
        })
      ])
    ).toBe("clips · idle, walk");
    expect(describeShipment("textures", [asset({ set })])).toBe("array · 3 textures");
    expect(describeShipment("textures", [asset({ id: "a" }), asset({ id: "b" })])).toBe(
      "array · 2 textures"
    );
  });
});
