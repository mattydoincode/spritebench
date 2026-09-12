import { describe, expect, it } from "vitest";
import { gridShapes, padGridForAspect, planSheet, planSheetRequest, planSheetRequestForGrid } from "@/core/sheet";
import { MAX_ASPECT, MAX_EDGE, MAX_TOTAL_PIXELS, isValidFlexibleSize } from "@/core/size";

describe("padGridForAspect", () => {
  it("leaves a 4x3 grid alone", () => {
    expect(padGridForAspect(4, 3)).toEqual({ columns: 4, rows: 3 });
  });

  it("adds rows under an 8-wide strip", () => {
    expect(padGridForAspect(8, 1).rows).toBeGreaterThanOrEqual(3);
    const padded = padGridForAspect(8, 1);
    expect(Math.max(padded.columns / padded.rows, padded.rows / padded.columns)).toBeLessThanOrEqual(
      MAX_ASPECT
    );
  });
});

describe("planSheetRequestForGrid", () => {
  it("honours the prescribed shape", () => {
    const request = planSheetRequestForGrid({ columns: 4, rows: 3 }, 256);

    expect(request.columns).toBe(4);
    expect(request.rows).toBe(3);
    expect(isValidFlexibleSize(request.size)).toBe(true);
  });
});

describe("gridShapes", () => {
  it("refuses a strip, because MAX_ASPECT is 3", () => {
    const shapes = gridShapes(8);

    expect(shapes).not.toContainEqual({ columns: 8, rows: 1 });
    expect(shapes).toContainEqual({ columns: 4, rows: 2 });
  });

  it("allows a 3:1 strip, which is exactly at the limit", () => {
    expect(gridShapes(3)).toContainEqual({ columns: 3, rows: 1 });
  });

  it("never proposes a shape past the aspect limit", () => {
    for (let count = 1; count <= 32; count++) {
      for (const shape of gridShapes(count)) {
        const aspect = Math.max(shape.columns / shape.rows, shape.rows / shape.columns);
        expect(aspect).toBeLessThanOrEqual(MAX_ASPECT);
      }
    }
  });
});

describe("planSheetRequest", () => {
  it("asks for a canvas the provider will accept", () => {
    for (const count of [1, 2, 4, 6, 8, 9, 12, 16, 20, 24]) {
      const request = planSheetRequest(count);

      expect(isValidFlexibleSize(request.size), `${count} frames`).toBe(true);
      expect(request.size.width).toBeLessThanOrEqual(MAX_EDGE);
      expect(request.size.height).toBeLessThanOrEqual(MAX_EDGE);
      expect(request.size.width * request.size.height).toBeLessThanOrEqual(MAX_TOTAL_PIXELS);
    }
  });

  it("holds every frame it was asked for", () => {
    for (let count = 1; count <= 24; count++) {
      const request = planSheetRequest(count);
      expect(request.columns * request.rows).toBeGreaterThanOrEqual(count);
    }
  });

  it("gives sixteen frames a 4x4 grid of 720px cells", () => {
    const request = planSheetRequest(16);

    expect(request).toMatchObject({ columns: 4, rows: 4, cell: 720, spare: 0 });
    expect(request.size).toEqual({ width: 2880, height: 2880 });
  });

  it("lets MAX_EDGE bind on a wide grid", () => {
    // 4x2 wants 1018px cells by area, but 4 * 1018 overruns the 3840 edge.
    const request = planSheetRequest(8);

    expect(request).toMatchObject({ columns: 4, rows: 2, cell: 960 });
    expect(request.size).toEqual({ width: 3840, height: 1920 });
  });

  it("keeps cells big enough to downsample from, even at 24 frames", () => {
    expect(planSheetRequest(24).cell).toBeGreaterThanOrEqual(512);
  });

  it("respects a cost ceiling on the cell size", () => {
    const request = planSheetRequest(16, 256);

    expect(request).toMatchObject({ columns: 4, rows: 4, cell: 256 });
    expect(isValidFlexibleSize(request.size)).toBe(true);
  });

  it("overrides the ceiling when it would make the canvas too small to accept", () => {
    // 4 cells of 256px is a 512x512 canvas, under MIN_TOTAL_PIXELS. The
    // provider's floor wins over the caller's cost hint.
    const request = planSheetRequest(4, 256);

    expect(request.cell).toBeGreaterThan(256);
    expect(isValidFlexibleSize(request.size)).toBe(true);
  });

  it("quantises the cell so the canvas edges stay legal", () => {
    for (const count of [3, 5, 7, 11, 13]) {
      const request = planSheetRequest(count, 300);

      expect(request.cell % 16).toBe(0);
      expect(isValidFlexibleSize(request.size), `${count} frames`).toBe(true);
    }
  });

  it("prefers no wasted cells when the cell size ties", () => {
    // 4 frames fits 2x2 exactly; 3x2 would leave two cells empty.
    expect(planSheetRequest(4, 128).spare).toBe(0);
  });
});

describe("planSheet", () => {
  const square = { width: 32, height: 32 };

  it("packs equal frames into a tight square grid", () => {
    const plan = planSheet(Array(4).fill(square));

    expect(plan).toMatchObject({ columns: 2, rows: 2, cell: square });
    expect(plan.size).toEqual({ width: 64, height: 64 });
    expect(plan.placements.map((p) => [p.x, p.y])).toEqual([
      [0, 0],
      [32, 0],
      [0, 32],
      [32, 32]
    ]);
  });

  it("honours a forced column count", () => {
    const plan = planSheet(Array(6).fill(square), { columns: 6 });

    expect(plan).toMatchObject({ columns: 6, rows: 1 });
    expect(plan.size).toEqual({ width: 192, height: 32 });
  });

  it("puts a transparent gutter around and between cells", () => {
    const plan = planSheet(Array(2).fill(square), { columns: 2, padding: 2 });

    expect(plan.size).toEqual({ width: 70, height: 36 });
    expect(plan.placements.map((p) => [p.x, p.y])).toEqual([
      [2, 2],
      [36, 2]
    ]);
  });

  it("sizes cells to the largest frame and sits shorter frames on the floor", () => {
    // One column, so the alignment inside the cell is the only thing moving.
    const plan = planSheet(
      [
        { width: 32, height: 32 },
        { width: 16, height: 20 }
      ],
      { columns: 1 }
    );

    expect(plan.cell).toEqual({ width: 32, height: 32 });
    // Centred across, bottom-aligned down: 8 in from the left, and 12 down
    // into the second cell so the feet land on the cell floor.
    expect(plan.placements[1]).toMatchObject({ x: 8, y: 44, width: 16, height: 20 });
  });

  it("keeps every placement inside the sheet", () => {
    const plan = planSheet([
      { width: 30, height: 10 },
      { width: 12, height: 40 },
      { width: 25, height: 25 }
    ], { padding: 3 });

    for (const placement of plan.placements) {
      expect(placement.x).toBeGreaterThanOrEqual(0);
      expect(placement.y).toBeGreaterThanOrEqual(0);
      expect(placement.x + placement.width).toBeLessThanOrEqual(plan.size.width);
      expect(placement.y + placement.height).toBeLessThanOrEqual(plan.size.height);
    }
  });

  it("survives being handed nothing", () => {
    const plan = planSheet([]);

    expect(plan.placements).toEqual([]);
    expect(plan.size.width).toBeGreaterThan(0);
  });
});
