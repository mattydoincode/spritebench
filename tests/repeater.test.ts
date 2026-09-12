import { describe, expect, it } from "vitest";
import {
  clampDegrees,
  isoLattice,
  isoStampBox,
  listIsoCells,
  planGridStamps,
  planIsoStamps,
  planRepeater,
  planScatterStamps,
  rotateFromCenter,
  stampStyle,
  towardEdge
} from "@/core/repeater";

describe("clampDegrees", () => {
  it("wraps into 0–359", () => {
    expect(clampDegrees(0)).toBe(0);
    expect(clampDegrees(360)).toBe(0);
    expect(clampDegrees(-90)).toBe(270);
    expect(clampDegrees(450)).toBe(90);
  });

  it("treats non-finite as upright", () => {
    expect(clampDegrees(Number.NaN)).toBe(0);
  });
});

describe("rotateFromCenter", () => {
  it("reads handle-up as 0 and clockwise as positive", () => {
    expect(rotateFromCenter({ x: 0, y: 0 }, { x: 0, y: -10 })).toBe(0);
    expect(rotateFromCenter({ x: 0, y: 0 }, { x: 10, y: 0 })).toBe(90);
    expect(rotateFromCenter({ x: 0, y: 0 }, { x: 0, y: 10 })).toBe(180);
    expect(rotateFromCenter({ x: 0, y: 0 }, { x: -10, y: 0 })).toBe(270);
  });

  it("snaps when asked", () => {
    expect(rotateFromCenter({ x: 0, y: 0 }, { x: 10, y: -1 }, 15)).toBe(90);
    expect(rotateFromCenter({ x: 0, y: 0 }, { x: 1, y: -10 }, 15)).toBe(0);
  });
});

describe("towardEdge", () => {
  it("leaves the value alone at bias 0", () => {
    expect(towardEdge(0.25, 0)).toBe(0.25);
    expect(towardEdge(0.8, 0)).toBe(0.8);
  });

  it("lands on an edge at bias 1", () => {
    expect(towardEdge(0.25, 1)).toBe(0);
    expect(towardEdge(0.8, 1)).toBe(1);
  });
});

describe("stampStyle", () => {
  const sequence = (rotate: Parameters<typeof stampStyle>[1], jitter = 0) => {
    const values = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6];
    let index = 0;
    return stampStyle(() => values[index++ % values.length], rotate, jitter);
  };

  it("stays upright with no rotate", () => {
    expect(sequence("none")).toMatchObject({ rotation: 0, flipH: false, flipV: false, scale: 1 });
  });

  it("picks a quarter turn", () => {
    expect(sequence("quarter").rotation % 90).toBe(0);
  });

  it("flips without rotating", () => {
    const style = sequence("flip");
    expect(style.rotation).toBe(0);
    expect(typeof style.flipH).toBe("boolean");
  });

  it("picks a free angle", () => {
    const style = sequence("free");
    expect(style.rotation).toBeGreaterThanOrEqual(0);
    expect(style.rotation).toBeLessThan(360);
    expect(style.flipH).toBe(false);
  });

  it("jitters scale and never goes below a sliver", () => {
    expect(stampStyle(() => 0, "none", 1).scale).toBe(0.2);
    expect(stampStyle(() => 1, "none", 1).scale).toBe(2);
  });
});

describe("planGridStamps", () => {
  const grid = (seed = 1) =>
    planGridStamps({
      origin: { x: 0, y: 0 },
      columns: [0, 1],
      rows: [0],
      stepX: 16,
      stepY: 16,
      cell: { width: 16, height: 16 },
      seed,
      mixCount: 3,
      rotate: "none",
      scaleJitter: 0
    });

  it("lays cells on the step and keeps mix picks stable for a seed", () => {
    const stamps = grid();
    expect(stamps.map((stamp) => ({ key: stamp.key, x: stamp.x, y: stamp.y }))).toEqual([
      { key: "0:0", x: 0, y: 0 },
      { key: "1:0", x: 16, y: 0 }
    ]);
    expect(grid().map((stamp) => stamp.mixIndex)).toEqual(stamps.map((stamp) => stamp.mixIndex));
  });
});

describe("iso lattice", () => {
  const origin = { x: 0, y: 0 };
  const cell = { width: 64, height: 32 };
  const lattice = isoLattice(cell, 0, 0);

  it("is a 2:1 diamond whose neighbours share an edge", () => {
    expect(lattice).toEqual({ diamondW: 64, diamondH: 32, halfW: 32, halfH: 16 });

    const here = isoStampBox(0, 0, origin, lattice, cell);
    const east = isoStampBox(1, 0, origin, lattice, cell);
    const south = isoStampBox(0, 1, origin, lattice, cell);

    expect(here).toEqual({ x: 0, y: 0, width: 64, height: 32 });
    expect(east).toEqual({ x: 32, y: 16, width: 64, height: 32 });
    expect(south).toEqual({ x: -32, y: 16, width: 64, height: 32 });
  });

  it("sits a tall sprite on the diamond so buildings hang north", () => {
    const tall = { width: 64, height: 80 };
    expect(isoStampBox(0, 0, origin, isoLattice(tall, 0, 0), tall)).toEqual({
      x: 0,
      y: -48,
      width: 64,
      height: 80
    });
  });

  it("plans cells back-to-front and keeps mix picks stable", () => {
    const cells = [
      { col: 1, row: 1 },
      { col: 0, row: 0 },
      { col: 1, row: 0 }
    ];
    const stamps = planIsoStamps({
      origin,
      cells,
      cell,
      marginX: 0,
      marginY: 0,
      seed: 3,
      mixCount: 4,
      rotate: "none",
      scaleJitter: 0
    });

    expect(stamps.map((stamp) => stamp.key)).toEqual(["0:0", "1:0", "1:1"]);
    expect(
      planIsoStamps({
        origin,
        cells,
        cell,
        marginX: 0,
        marginY: 0,
        seed: 3,
        mixCount: 4,
        rotate: "none",
        scaleJitter: 0
      }).map((stamp) => stamp.mixIndex)
    ).toEqual(stamps.map((stamp) => stamp.mixIndex));
  });

  it("lists a bounded map in painter order", () => {
    expect(
      listIsoCells({
        origin,
        lattice,
        cell,
        countX: 2,
        countY: 2,
        fillX: false,
        fillY: false,
        view: { minX: -200, maxX: 200, minY: -200, maxY: 200 },
        maxTiles: 90,
        maxPerAxis: 30
      })
    ).toEqual([
      { col: 0, row: 0 },
      { col: 0, row: 1 },
      { col: 1, row: 0 },
      { col: 1, row: 1 }
    ]);
  });

  it("culls fill to tiles that actually hit the view", () => {
    const cells = listIsoCells({
      origin,
      lattice,
      cell,
      countX: 8,
      countY: 8,
      fillX: true,
      fillY: true,
      view: { minX: 0, maxX: 64, minY: 0, maxY: 32 },
      maxTiles: 90,
      maxPerAxis: 30
    });

    expect(cells).toContainEqual({ col: 0, row: 0 });
    expect(cells.some((entry) => entry.col === 4 && entry.row === 4)).toBe(false);
  });

  it("routes iso through planRepeater", () => {
    const stamps = planRepeater(
      {
        x: 0,
        y: 0,
        placement: "iso",
        rotate: "none",
        seed: 1,
        scaleJitter: 0,
        scatterCount: 16,
        areaWidth: 192,
        areaHeight: 192,
        minGap: 0,
        edgeBias: 0,
        marginX: 0,
        marginY: 0
      },
      cell,
      1,
      { columns: [], rows: [], stepX: 0, stepY: 0, cells: [{ col: 1, row: 0 }] }
    );

    expect(stamps).toEqual([
      expect.objectContaining({ key: "1:0", x: 32, y: 16, width: 64, height: 32 })
    ]);
  });
});

describe("planScatterStamps", () => {
  const scatter = (seed: number, extra: Partial<Parameters<typeof planScatterStamps>[0]> = {}) =>
    planScatterStamps({
      origin: { x: 10, y: 20 },
      area: { width: 100, height: 80 },
      cell: { width: 8, height: 8 },
      count: 12,
      seed,
      mixCount: 2,
      rotate: "free",
      scaleJitter: 0.2,
      minGap: 0,
      edgeBias: 0,
      ...extra
    });

  it("is deterministic for a seed", () => {
    expect(scatter(7)).toEqual(scatter(7));
    expect(scatter(7)).not.toEqual(scatter(8));
  });

  it("keeps stamp centres inside the rectangle", () => {
    for (const stamp of scatter(3, { rotate: "none", scaleJitter: 0 })) {
      const cx = stamp.x + stamp.width / 2;
      const cy = stamp.y + stamp.height / 2;
      expect(cx).toBeGreaterThanOrEqual(10);
      expect(cx).toBeLessThanOrEqual(110);
      expect(cy).toBeGreaterThanOrEqual(20);
      expect(cy).toBeLessThanOrEqual(100);
    }
  });

  it("drops stamps that cannot satisfy a gap", () => {
    const packed = scatter(1, {
      count: 40,
      area: { width: 10, height: 10 },
      minGap: 8,
      rotate: "none",
      scaleJitter: 0
    });
    expect(packed.length).toBeLessThan(40);
    expect(packed.length).toBeGreaterThan(0);
  });

  it("honours flip-only rotation", () => {
    const stamps = scatter(4, { rotate: "flip", scaleJitter: 0 });
    expect(stamps.every((stamp) => stamp.rotation === 0)).toBe(true);
    expect(stamps.some((stamp) => stamp.flipH || stamp.flipV)).toBe(true);
  });
});
