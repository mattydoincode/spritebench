import { describe, expect, it } from "vitest";
import { centerOf, resizeFromCorner, rotateAbout, snapPointToGrid } from "@/client/grid";
import { DEFAULT_TERRAIN, emptyTiles } from "@/core/terrain";
import type { RepeatGroup, StagedItem, TerrainGroup } from "@/shared/model";

describe("snapPointToGrid", () => {
  it("snaps to intersections spaced by the scene cell size", () => {
    expect(snapPointToGrid({ x: 70, y: 100 }, 64)).toEqual({
      x: 64,
      y: 128
    });
  });

  it("snaps negative world coordinates around the same origin", () => {
    expect(snapPointToGrid({ x: -70, y: -100 }, 64)).toEqual({
      x: -64,
      y: -128
    });
  });

  it("uses one world unit when given an invalid cell size", () => {
    expect(snapPointToGrid({ x: 10.4, y: 20.6 }, 0)).toEqual({
      x: 10,
      y: 21
    });
  });
});

describe("resizeFromCorner", () => {
  const start = { x: 10, y: 20, width: 40, height: 20 };

  it("grows the south-east corner without moving the origin", () => {
    expect(resizeFromCorner(start, "se", { x: 70, y: 60 })).toEqual({
      x: 10,
      y: 20,
      width: 60,
      height: 40
    });
  });

  it("moves the origin when dragging the north-west corner", () => {
    expect(resizeFromCorner(start, "nw", { x: 0, y: 10 })).toEqual({
      x: 0,
      y: 10,
      width: 50,
      height: 30
    });
  });

  it("keeps the opposite corner planted on the other two handles", () => {
    expect(resizeFromCorner(start, "ne", { x: 70, y: 10 })).toEqual({
      x: 10,
      y: 10,
      width: 60,
      height: 30
    });
    expect(resizeFromCorner(start, "sw", { x: 0, y: 60 })).toEqual({
      x: 0,
      y: 20,
      width: 50,
      height: 40
    });
  });

  it("stays on the original aspect when locked", () => {
    // 2:1 box. Pointer is further along the same diagonal, so the scale is 2.
    expect(resizeFromCorner(start, "se", { x: 90, y: 60 }, { lockAspect: true })).toEqual({
      x: 10,
      y: 20,
      width: 80,
      height: 40
    });

    // Off the diagonal still keeps 2:1, rather than going wide and short.
    expect(resizeFromCorner(start, "se", { x: 90, y: 40 }, { lockAspect: true })).toEqual({
      x: 10,
      y: 20,
      width: 72,
      height: 36
    });
  });

  it("refuses to collapse below one unit", () => {
    expect(resizeFromCorner(start, "se", { x: 10, y: 20 })).toEqual({
      x: 10,
      y: 20,
      width: 1,
      height: 1
    });
  });

  it("snaps the dragged corner before measuring", () => {
    expect(resizeFromCorner(start, "se", { x: 73, y: 61 }, { snap: 16 })).toEqual({
      x: 10,
      y: 20,
      width: 70,
      height: 44
    });
  });

  it("keeps the opposite corner planted in the world when the sprite is turned", () => {
    const box = { x: 0, y: 0, width: 40, height: 20 };
    const center = { x: 20, y: 10 };
    const planted = rotateAbout({ x: 0, y: 0 }, center, 90);
    const pointer = rotateAbout({ x: 80, y: 20 }, center, 90);
    const next = resizeFromCorner(box, "se", pointer, { rotation: 90 });
    const nextPlanted = rotateAbout(
      { x: next.x, y: next.y },
      { x: next.x + next.width / 2, y: next.y + next.height / 2 },
      90
    );

    expect(next).toMatchObject({ width: 80, height: 20 });
    expect(nextPlanted.x).toBeCloseTo(planted.x);
    expect(nextPlanted.y).toBeCloseTo(planted.y);
  });
});

describe("rotateAbout", () => {
  it("turns clockwise with y down", () => {
    const right = rotateAbout({ x: 1, y: 0 }, { x: 0, y: 0 }, 90);
    expect(right.x).toBeCloseTo(0);
    expect(right.y).toBeCloseTo(1);

    const up = rotateAbout({ x: 0, y: -1 }, { x: 0, y: 0 }, 90);
    expect(up.x).toBeCloseTo(1);
    expect(up.y).toBeCloseTo(0);
  });
});

/**
 * The scene tree's "jump to it" only helps if it puts the thing under the
 * cursor rather than at the corner of the screen, and x/y are corners.
 */
describe("centerOf", () => {
  const item = (patch: Partial<StagedItem> = {}): StagedItem => ({
    id: "i1",
    assetId: "a1",
    x: 0,
    y: 0,
    footprint: { width: 32, height: 48 },
    zIndex: 0,
    flipHorizontal: false,
    isoTurn: 0,
    flipVertical: false,
    showSource: false,
    opacity: 1,
    paused: false,
    sequenceId: "",
    heldFrame: 0,
    rotation: 0,
    ...patch
  });

  const group = (patch: Partial<RepeatGroup> = {}): RepeatGroup => ({
    id: "g1",
    name: "",
    assetIds: [],
    x: 0,
    y: 0,
    cell: { width: 16, height: 16 },
    marginX: 0,
    marginY: 0,
    countX: 4,
    countY: 2,
    fillX: false,
    fillY: false,
    placement: "grid",
    rotate: "none",
    scatterCount: 16,
    areaWidth: 192,
    areaHeight: 192,
    scaleJitter: 0,
    minGap: 0,
    edgeBias: 0,
    background: "",
    zIndex: 0,
    opacity: 1,
    seed: 0,
    ...patch
  });

  it("offsets a sprite by half its footprint", () => {
    expect(centerOf(item({ x: 100, y: 200 }))).toEqual({ x: 116, y: 224 });
  });

  it("spans a repeater by its cell size, counts and margins", () => {
    expect(centerOf(group())).toEqual({ x: 32, y: 16 });
    expect(centerOf(group({ marginX: 4, marginY: 4 }))).toEqual({ x: 40, y: 20 });
    expect(centerOf(group({ x: 10, y: 10 }))).toEqual({ x: 42, y: 26 });
  });

  /**
   * An auto-sized repeater has no cell until its art decodes, which happens
   * off in a canvas callback. Centring on the origin is the fallback.
   */
  it("falls back to the origin when the cell size is inherited", () => {
    const auto = group({ x: 50, y: 60, cell: { width: 0, height: 0 } });
    expect(centerOf(auto)).toEqual({ x: 50, y: 60 });
  });

  it("centres a scatter repeater on its area", () => {
    expect(
      centerOf(group({ placement: "scatter", x: 10, y: 20, areaWidth: 100, areaHeight: 40 }))
    ).toEqual({ x: 60, y: 40 });
  });

  it("centres an iso repeater on the diamond map's bounds", () => {
    expect(
      centerOf(
        group({
          placement: "iso",
          x: 0,
          y: 0,
          cell: { width: 16, height: 8 },
          countX: 2,
          countY: 2,
          marginX: 0,
          marginY: 0
        })
      )
    ).toEqual({ x: 8, y: 8 });
  });

  it("centres a terrain on its tile grid", () => {
    const terrain = (patch: Partial<TerrainGroup> = {}): TerrainGroup => ({
      id: "t1",
      name: "",
      x: 10,
      y: 20,
      zIndex: 0,
      ...DEFAULT_TERRAIN,
      countX: 3,
      countY: 2,
      tileSize: 64,
      tiles: emptyTiles(3, 2),
      ...patch
    });

    expect(centerOf(terrain())).toEqual({ x: 106, y: 84 });
  });
});
