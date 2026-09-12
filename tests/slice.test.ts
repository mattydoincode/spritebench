import { describe, expect, it } from "vitest";
import {
  DEFAULT_GRID,
  applyInset,
  buildSheetMask,
  cellFrameSize,
  cellUsed,
  clampFrame,
  detectGrid,
  nudgeFrame,
  placeFrame,
  placeFrames,
  resizeFrame,
  scaleRect,
  sliceGrid,
  tightenFrames,
  unionInset
} from "@/core/slice";
import { createImage } from "@/core/pixels";
import { thumbnailSize } from "@/core/size";
import type { Rect, RgbaImage } from "@/core/types";

const OPAQUE = 0.5;

function paint(image: RgbaImage, rect: Rect): void {
  for (let y = rect.y; y < rect.y + rect.height; y++) {
    for (let x = rect.x; x < rect.x + rect.width; x++) {
      const i = (y * image.width + x) * 4;
      image.data[i] = 200;
      image.data[i + 3] = 255;
    }
  }
}

function boxes(rects: Rect[]): string[] {
  return rects.map((rect) => `${rect.width}x${rect.height}@${rect.x},${rect.y}`);
}

describe("sliceGrid", () => {
  it("divides a sheet evenly when it divides evenly", () => {
    const rects = sliceGrid({ width: 100, height: 50 }, { ...DEFAULT_GRID, columns: 4, rows: 2 });

    expect(rects).toHaveLength(8);
    expect(boxes(rects.slice(0, 4))).toEqual([
      "25x25@0,0",
      "25x25@25,0",
      "25x25@50,0",
      "25x25@75,0"
    ]);
  });

  it("returns rectangles in row-major order", () => {
    const rects = sliceGrid({ width: 60, height: 40 }, { ...DEFAULT_GRID, columns: 3, rows: 2 });

    expect(rects.map((rect) => [rect.x, rect.y])).toEqual([
      [0, 0],
      [20, 0],
      [40, 0],
      [0, 20],
      [20, 20],
      [40, 20]
    ]);
  });

  it("spreads the remainder instead of losing it off the last cell", () => {
    const rects = sliceGrid({ width: 100, height: 10 }, { ...DEFAULT_GRID, columns: 3, rows: 1 });

    // 100/3 does not divide. What matters is that the cells stay adjacent and
    // together cover the sheet, not that they are all the same width.
    expect(rects.map((rect) => rect.width)).toEqual([33, 34, 33]);
    expect(rects[2].x + rects[2].width).toBe(100);
  });

  it("honours margins and gutters", () => {
    const rects = sliceGrid(
      { width: 100, height: 100 },
      { columns: 2, rows: 1, marginX: 5, marginY: 0, spacingX: 10, spacingY: 0 }
    );

    expect(boxes(rects)).toEqual(["40x100@5,0", "40x100@55,0"]);
  });

  it("clamps a margin that would consume the sheet", () => {
    const rects = sliceGrid({ width: 20, height: 20 }, { ...DEFAULT_GRID, columns: 2, rows: 1, marginX: 500 });

    expect(rects).toHaveLength(2);
    for (const rect of rects) {
      expect(rect.width).toBeGreaterThanOrEqual(1);
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.width).toBeLessThanOrEqual(20);
    }
  });

  it("never returns a zero-width cell for a nonsense gutter", () => {
    const rects = sliceGrid({ width: 30, height: 30 }, { ...DEFAULT_GRID, columns: 4, rows: 4, spacingX: 999 });

    expect(rects).toHaveLength(16);
    for (const rect of rects) {
      expect(rect.width).toBeGreaterThanOrEqual(1);
      expect(rect.height).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("detectGrid", () => {
  it("finds a 2x2 grid from the transparent gutters", () => {
    const image = createImage(100, 100);
    paint(image, { x: 10, y: 10, width: 30, height: 30 });
    paint(image, { x: 60, y: 10, width: 30, height: 30 });
    paint(image, { x: 10, y: 60, width: 30, height: 30 });
    paint(image, { x: 60, y: 60, width: 30, height: 30 });

    expect(detectGrid(image, OPAQUE)).toEqual({
      columns: 2,
      rows: 2,
      marginX: 10,
      marginY: 10,
      spacingX: 20,
      spacingY: 20
    });
  });

  it("counts sprites of different sizes as separate columns", () => {
    const image = createImage(100, 20);
    paint(image, { x: 0, y: 0, width: 10, height: 20 });
    paint(image, { x: 20, y: 5, width: 30, height: 10 });
    paint(image, { x: 70, y: 0, width: 5, height: 20 });

    const grid = detectGrid(image, OPAQUE);

    expect(grid?.columns).toBe(3);
    expect(grid?.rows).toBe(1);
  });

  it("gives up on a sheet with no gutters at all", () => {
    const image = createImage(40, 40);
    paint(image, { x: 0, y: 0, width: 40, height: 40 });

    expect(detectGrid(image, OPAQUE)).toBeNull();
  });

  it("gives up on a fully transparent sheet", () => {
    expect(detectGrid(createImage(40, 40), OPAQUE)).toBeNull();
  });
});

describe("scaleRect", () => {
  it("maps a frame rectangle onto a downscaled thumbnail", () => {
    // A 4x4 sheet at 2880px thumbnails to 256px. Frame 5 sits at (720, 720).
    const source = { width: 2880, height: 2880 };
    const thumb = thumbnailSize(source);

    expect(thumb).toEqual({ width: 256, height: 256 });

    expect(scaleRect({ x: 720, y: 720, width: 720, height: 720 }, source, thumb)).toEqual({
      x: 64,
      y: 64,
      width: 64,
      height: 64
    });
  });

  it("is the identity when the spaces match", () => {
    const size = { width: 100, height: 100 };
    const rect = { x: 10, y: 20, width: 30, height: 40 };

    expect(scaleRect(rect, size, size)).toEqual(rect);
  });

  it("keeps the last frame inside the target after rounding", () => {
    const source = { width: 1000, height: 300 };
    const thumb = thumbnailSize(source);

    const last = scaleRect({ x: 900, y: 0, width: 100, height: 300 }, source, thumb);

    expect(last.x + last.width).toBeLessThanOrEqual(thumb.width);
    expect(last.y + last.height).toBeLessThanOrEqual(thumb.height);
  });

  it("never collapses a frame to nothing on a heavy downscale", () => {
    const source = { width: 3840, height: 1920 };
    const thumb = thumbnailSize(source);

    for (let column = 0; column < 4; column++) {
      const rect = scaleRect(
        { x: column * 960, y: 0, width: 960, height: 960 },
        source,
        thumb
      );

      expect(rect.width).toBeGreaterThan(0);
      expect(rect.height).toBeGreaterThan(0);
    }
  });
});

describe("thumbnailSize", () => {
  it("fits inside the longest edge and keeps the aspect", () => {
    expect(thumbnailSize({ width: 3840, height: 1920 })).toEqual({ width: 256, height: 128 });
  });

  it("does not enlarge something already small", () => {
    expect(thumbnailSize({ width: 64, height: 32 })).toEqual({ width: 64, height: 32 });
  });
});

describe("unionInset", () => {
  it("reports the dead space every frame shares", () => {
    const image = createImage(40, 20);
    // Two 20x20 cells. Content sits 4px in on the left of both, but only 2px
    // in on the right of the second, so the shared right inset is 2.
    paint(image, { x: 4, y: 3, width: 12, height: 14 });
    paint(image, { x: 24, y: 5, width: 14, height: 10 });

    const rects: Rect[] = [
      { x: 0, y: 0, width: 20, height: 20 },
      { x: 20, y: 0, width: 20, height: 20 }
    ];

    expect(unionInset(image, rects, OPAQUE)).toEqual({
      top: 3,
      right: 2,
      bottom: 3,
      left: 4
    });
  });

  it("is driven by the tightest frame, so no frame gets clipped", () => {
    const image = createImage(40, 20);
    paint(image, { x: 8, y: 8, width: 4, height: 4 });
    paint(image, { x: 20, y: 0, width: 20, height: 20 });

    // The second frame touches every edge, so nothing can be trimmed.
    const rects: Rect[] = [
      { x: 0, y: 0, width: 20, height: 20 },
      { x: 20, y: 0, width: 20, height: 20 }
    ];

    expect(unionInset(image, rects, OPAQUE)).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });

  it("skips empty frames rather than treating them as fully inset", () => {
    const image = createImage(40, 20);
    paint(image, { x: 4, y: 4, width: 12, height: 12 });

    const rects: Rect[] = [
      { x: 0, y: 0, width: 20, height: 20 },
      { x: 20, y: 0, width: 20, height: 20 }
    ];

    expect(unionInset(image, rects, OPAQUE)).toEqual({ top: 4, right: 4, bottom: 4, left: 4 });
  });

  it("returns nothing to trim for an entirely empty sheet", () => {
    const image = createImage(20, 20);
    const rects: Rect[] = [{ x: 0, y: 0, width: 20, height: 20 }];

    expect(unionInset(image, rects, OPAQUE)).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });
});

describe("placeFrame", () => {
  const sheet = { width: 100, height: 80 };

  it("centres a smaller frame inside its cell", () => {
    expect(placeFrame({ x: 0, y: 0, width: 40, height: 40 }, { width: 20, height: 10 }, sheet)).toEqual({
      x: 10,
      y: 15,
      width: 20,
      height: 10
    });
  });

  it("clamps a frame that would hang off the sheet", () => {
    expect(placeFrame({ x: 90, y: 70, width: 20, height: 20 }, { width: 16, height: 16 }, sheet)).toEqual({
      x: 84,
      y: 64,
      width: 16,
      height: 16
    });
  });

  it("places every cell of a grid", () => {
    const cells = sliceGrid({ width: 80, height: 40 }, { ...DEFAULT_GRID, columns: 2, rows: 1 });

    expect(placeFrames(cells, { width: 20, height: 20 }, { width: 80, height: 40 })).toEqual([
      { x: 10, y: 10, width: 20, height: 20 },
      { x: 50, y: 10, width: 20, height: 20 }
    ]);
  });
});

describe("cellFrameSize", () => {
  it("takes the smallest cell so every frame matches", () => {
    expect(
      cellFrameSize([
        { x: 0, y: 0, width: 33, height: 20 },
        { x: 33, y: 0, width: 34, height: 20 },
        { x: 67, y: 0, width: 33, height: 20 }
      ])
    ).toEqual({ width: 33, height: 20 });
  });
});

describe("clampFrame", () => {
  it("slides a box back onto the sheet without shrinking it", () => {
    expect(clampFrame({ x: -8, y: 90, width: 20, height: 10 }, { width: 100, height: 80 })).toEqual({
      x: 0,
      y: 70,
      width: 20,
      height: 10
    });
  });
});

describe("nudgeFrame", () => {
  it("moves by whole pixels and stops at the edge", () => {
    const start = { x: 2, y: 2, width: 10, height: 10 };

    expect(nudgeFrame(start, -4, 3, { width: 40, height: 40 })).toEqual({
      x: 0,
      y: 5,
      width: 10,
      height: 10
    });
  });
});

describe("resizeFrame", () => {
  it("grows and shrinks around the centre", () => {
    const rect = { x: 10, y: 10, width: 20, height: 20 };

    expect(resizeFrame(rect, { width: 10, height: 10 })).toEqual({
      x: 15,
      y: 15,
      width: 10,
      height: 10
    });

    expect(resizeFrame(rect, { width: 30, height: 10 })).toEqual({
      x: 5,
      y: 15,
      width: 30,
      height: 10
    });
  });

  it("clamps to the sheet when one is given", () => {
    expect(resizeFrame({ x: 0, y: 0, width: 10, height: 10 }, { width: 20, height: 20 }, { width: 30, height: 15 })).toEqual({
      x: 0,
      y: 0,
      width: 20,
      height: 15
    });
  });
});

describe("tightenFrames", () => {
  it("bakes the shared inset into the rectangles", () => {
    const image = createImage(40, 20);
    paint(image, { x: 4, y: 3, width: 12, height: 14 });
    paint(image, { x: 24, y: 5, width: 14, height: 10 });

    const rects: Rect[] = [
      { x: 0, y: 0, width: 20, height: 20 },
      { x: 20, y: 0, width: 20, height: 20 }
    ];

    expect(applyInset(rects, { top: 3, right: 2, bottom: 3, left: 4 })).toEqual([
      { x: 4, y: 3, width: 14, height: 14 },
      { x: 24, y: 3, width: 14, height: 14 }
    ]);

    expect(tightenFrames(image, rects, OPAQUE)).toEqual([
      { x: 4, y: 3, width: 14, height: 14 },
      { x: 24, y: 3, width: 14, height: 14 }
    ]);
  });
});

describe("buildSheetMask", () => {
  const actions = [
    { frames: 2 },
    { frames: 4 },
    { frames: 3 }
  ];

  it("opens holes for used cells and covers the rest", () => {
    const mask = buildSheetMask({ width: 40, height: 30 }, 4, 3, actions);

    expect(cellUsed(0, 0, actions)).toBe(true);
    expect(cellUsed(0, 2, actions)).toBe(false);
    expect(cellUsed(1, 3, actions)).toBe(true);
    expect(cellUsed(2, 3, actions)).toBe(false);

    // Centre of idle frame 0 is open; centre of idle's third cell is covered.
    expect(mask.data[(5 * 40 + 5) * 4 + 3]).toBe(0);
    expect(mask.data[(5 * 40 + 25) * 4 + 3]).toBe(255);
    // Padding would sit on row 2 col 3 (x=35, y=25).
    expect(mask.data[(25 * 40 + 35) * 4 + 3]).toBe(255);
  });
});
