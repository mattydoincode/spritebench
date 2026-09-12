import { describe, expect, it } from "vitest";
import { createImage } from "@/core/pixels";
import {
  DEFAULT_TERRAIN,
  MAX_TERRAIN_DETAIL,
  MAX_TERRAIN_SAMPLES,
  buildSceneTerrainMesh,
  buildTerrainMesh,
  clampTerrainCount,
  clampTerrainSamples,
  emptyTiles,
  heightFromLuma,
  heightNorm,
  meshFocus,
  resizeTerrainGrid,
  sampleBilinear,
  sampleGradient,
  sampleGridSize,
  terrainExtent,
  tileIndex,
  tileOrigin
} from "@/core/terrain";
import type { RgbaImage } from "@/core/types";

function fill(image: RgbaImage, r: number, g: number, b: number): RgbaImage {
  for (let i = 0; i < image.data.length; i += 4) {
    image.data[i] = r;
    image.data[i + 1] = g;
    image.data[i + 2] = b;
    image.data[i + 3] = 255;
  }
  return image;
}

function gray(width: number, height: number, value: number): RgbaImage {
  return fill(createImage(width, height), value, value, value);
}

describe("heightFromLuma", () => {
  it("maps black to low and white to high", () => {
    expect(heightFromLuma(0, -20, 80)).toBe(-20);
    expect(heightFromLuma(1, -20, 80)).toBe(80);
    expect(heightFromLuma(0.5, -20, 80)).toBe(30);
  });

  it("clamps luma and treats non-finite as 0", () => {
    expect(heightFromLuma(2, 0, 10)).toBe(10);
    expect(heightFromLuma(Number.NaN, 0, 10)).toBe(0);
  });
});

describe("heightNorm", () => {
  it("inverts heightFromLuma", () => {
    expect(heightNorm(-20, -20, 80)).toBe(0);
    expect(heightNorm(80, -20, 80)).toBe(1);
    expect(heightNorm(30, -20, 80)).toBe(0.5);
  });
});

describe("sampleGradient", () => {
  it("returns deep water at the bottom of classic", () => {
    expect(sampleGradient("classic", 0)).toEqual({ r: 11, g: 29, b: 54 });
  });

  it("returns snow at the top of classic", () => {
    expect(sampleGradient("classic", 1)).toEqual({ r: 255, g: 255, b: 255 });
  });

  it("bands a palette instead of interpolating", () => {
    const palette = [
      { r: 255, g: 0, b: 0 },
      { r: 0, g: 255, b: 0 },
      { r: 0, g: 0, b: 255 }
    ];

    expect(sampleGradient("palette", 0, palette)).toEqual(palette[0]);
    expect(sampleGradient("palette", 1, palette)).toEqual(palette[2]);
    expect(sampleGradient("palette", 0.5, palette)).toEqual(palette[1]);
  });

  it("falls back to classic when the palette is empty", () => {
    expect(sampleGradient("palette", 0, [])).toEqual(sampleGradient("classic", 0));
  });
});

describe("sampleGridSize", () => {
  it("keeps a small image as-is, but never below 2", () => {
    expect(sampleGridSize(16, 16)).toEqual({ columns: 16, rows: 16 });
    expect(sampleGridSize(1, 1)).toEqual({ columns: 2, rows: 2 });
  });

  it("caps the long edge at 128", () => {
    const grid = sampleGridSize(512, 256);
    expect(grid.columns).toBe(MAX_TERRAIN_SAMPLES);
    expect(grid.rows).toBe(64);
    expect(grid.columns).toBeLessThanOrEqual(MAX_TERRAIN_SAMPLES);
    expect(grid.rows).toBeLessThanOrEqual(MAX_TERRAIN_SAMPLES);
  });

  it("caps a tall image on height, not width", () => {
    expect(sampleGridSize(256, 512)).toEqual({ columns: 64, rows: MAX_TERRAIN_SAMPLES });
  });
});

describe("sampleBilinear", () => {
  it("hits the corner pixels exactly", () => {
    const image = createImage(2, 1);
    image.data.set([0, 0, 0, 255, 255, 255, 255, 255]);

    expect(sampleBilinear(image, 0, 0)).toEqual({ r: 0, g: 0, b: 0 });
    expect(sampleBilinear(image, 1, 0)).toEqual({ r: 255, g: 255, b: 255 });
  });

  it("blends neighbouring pixels between corners", () => {
    const image = createImage(2, 1);
    image.data.set([0, 0, 0, 255, 255, 255, 255, 255]);

    expect(sampleBilinear(image, 0.5, 0).r).toBeCloseTo(127.5);
  });
});

describe("tile layout", () => {
  it("addresses cells row-major", () => {
    expect(tileIndex(0, 0, 3)).toBe(0);
    expect(tileIndex(2, 0, 3)).toBe(2);
    expect(tileIndex(0, 1, 3)).toBe(3);
  });

  it("places adjacent tiles on a shared edge", () => {
    const terrain = { x: 10, y: 20, tileSize: 64 };
    expect(tileOrigin(terrain, 0, 0)).toEqual({ x: 10, z: 20 });
    expect(tileOrigin(terrain, 1, 0)).toEqual({ x: 74, z: 20 });
    expect(tileOrigin(terrain, 0, 1)).toEqual({ x: 10, z: 84 });
  });

  it("spans the grid for the 2D footprint", () => {
    expect(terrainExtent({ countX: 3, countY: 2, tileSize: 64 })).toEqual({
      width: 192,
      height: 128
    });
  });

  it("keeps overlapping cells when the grid grows or shrinks", () => {
    const tiles = emptyTiles(2, 1);
    tiles[0] = { heightAssetId: "a", colorAssetId: "c" };
    tiles[1] = { heightAssetId: "b", colorAssetId: "" };

    const grown = resizeTerrainGrid(tiles, 2, 1, 2, 2);
    expect(grown).toHaveLength(4);
    expect(grown[0]).toEqual({ heightAssetId: "a", colorAssetId: "c" });
    expect(grown[1]).toEqual({ heightAssetId: "b", colorAssetId: "" });
    expect(grown[2]).toEqual({ heightAssetId: "", colorAssetId: "" });

    const shrunk = resizeTerrainGrid(tiles, 2, 1, 1, 1);
    expect(shrunk).toEqual([{ heightAssetId: "a", colorAssetId: "c" }]);
  });

  it("clamps tile counts to 1–8", () => {
    expect(clampTerrainCount(0)).toBe(1);
    expect(clampTerrainCount(99)).toBe(8);
    expect(clampTerrainCount(Number.NaN)).toBe(1);
  });

  it("clamps samples to 2–2048", () => {
    expect(clampTerrainSamples(1)).toBe(2);
    expect(clampTerrainSamples(256)).toBe(256);
    expect(clampTerrainSamples(2048)).toBe(MAX_TERRAIN_DETAIL);
    expect(clampTerrainSamples(9999)).toBe(MAX_TERRAIN_DETAIL);
    expect(clampTerrainSamples(Number.NaN)).toBe(MAX_TERRAIN_SAMPLES);
  });
});

describe("buildTerrainMesh", () => {
  const base = {
    x: 0,
    y: 0,
    countX: 1,
    countY: 1,
    tileSize: 10,
    low: -20,
    high: 80,
    seaLevel: 0,
    flattenSea: false,
    gradientId: "classic" as const,
    tiles: [] as Array<{ height?: RgbaImage; color?: RgbaImage }>
  };

  it("builds a flat placeholder when a cell has no heightmap", () => {
    const mesh = buildTerrainMesh({ ...base, tiles: [{}] });
    expect(mesh.vertexCount).toBe(4);

    for (let i = 0; i < mesh.vertexCount; i++) {
      expect(mesh.positions[i * 3 + 1]).toBe(0);
    }
  });

  it("maps a white heightmap to high", () => {
    const mesh = buildTerrainMesh({
      ...base,
      tiles: [{ height: gray(4, 4, 255) }]
    });

    for (let i = 0; i < mesh.vertexCount; i++) {
      expect(mesh.positions[i * 3 + 1]).toBe(80);
    }
  });

  it("flattens verts below sea level without changing the rest", () => {
    const mesh = buildTerrainMesh({
      ...base,
      flattenSea: true,
      tiles: [{ height: gray(4, 4, 0) }]
    });

    for (let i = 0; i < mesh.vertexCount; i++) {
      expect(mesh.positions[i * 3 + 1]).toBe(0);
    }
  });

  it("colors from an albedo image when one is present", () => {
    const mesh = buildTerrainMesh({
      ...base,
      tiles: [{ height: gray(4, 4, 128), color: fill(createImage(4, 4), 255, 0, 0) }]
    });

    expect(mesh.colors[0]).toBeCloseTo(1);
    expect(mesh.colors[1]).toBeCloseTo(0);
    expect(mesh.colors[2]).toBeCloseTo(0);
  });

  it("caps verts on a huge heightmap", () => {
    const mesh = buildTerrainMesh({
      ...base,
      tiles: [{ height: gray(800, 800, 128) }]
    });

    expect(mesh.vertexCount).toBe(DEFAULT_TERRAIN.samples * DEFAULT_TERRAIN.samples);
  });

  it("keeps more verts when samples is raised", () => {
    const image = gray(400, 400, 128);
    const coarse = buildTerrainMesh({ ...base, samples: 64, tiles: [{ height: image }] });
    const fine = buildTerrainMesh({ ...base, samples: 256, tiles: [{ height: image }] });

    expect(coarse.vertexCount).toBe(64 * 64);
    expect(fine.vertexCount).toBe(256 * 256);
    expect(fine.vertexCount).toBeGreaterThan(coarse.vertexCount);
  });

  it("will not sample past the hard detail ceiling", () => {
    expect(sampleGridSize(8000, 8000, clampTerrainSamples(9999))).toEqual({
      columns: MAX_TERRAIN_DETAIL,
      rows: MAX_TERRAIN_DETAIL
    });
  });

  it("places a 2x1 grid so the shared edge lines up", () => {
    const mesh = buildTerrainMesh({
      ...base,
      countX: 2,
      countY: 1,
      tileSize: 10,
      tiles: [{}, {}]
    });

    const xs = new Set<number>();
    for (let i = 0; i < mesh.vertexCount; i++) xs.add(mesh.positions[i * 3]);

    expect(xs.has(0)).toBe(true);
    expect(xs.has(10)).toBe(true);
    expect(xs.has(20)).toBe(true);
  });

  it("lands a mid vert between neighbouring height pixels", () => {
    const ramp = createImage(8, 1);
    for (let x = 0; x < 8; x++) {
      const value = x < 4 ? 0 : 255;
      const i = x * 4;
      ramp.data[i] = value;
      ramp.data[i + 1] = value;
      ramp.data[i + 2] = value;
      ramp.data[i + 3] = 255;
    }

    const mesh = buildTerrainMesh({
      ...base,
      flattenSea: false,
      samples: 3,
      tiles: [{ height: ramp }]
    });

    expect(mesh.positions[1]).toBeCloseTo(-20);
    expect(mesh.positions[4]).toBeCloseTo(30);
    expect(mesh.positions[7]).toBeCloseTo(80);
  });

  it("rises from left to right on a horizontal ramp", () => {
    const ramp = createImage(4, 1);
    for (let x = 0; x < 4; x++) {
      const value = [0, 85, 170, 255][x];
      const i = x * 4;
      ramp.data[i] = value;
      ramp.data[i + 1] = value;
      ramp.data[i + 2] = value;
      ramp.data[i + 3] = 255;
    }

    const mesh = buildTerrainMesh({
      ...base,
      flattenSea: false,
      tiles: [{ height: ramp }]
    });

    const left = mesh.positions[1];
    const right = mesh.positions[(mesh.vertexCount - 1) * 3 + 1];
    expect(left).toBeCloseTo(-20);
    expect(right).toBeCloseTo(80);
    expect(right).toBeGreaterThan(left);
  });

  it("flattens only the verts that sit below sea", () => {
    const split = createImage(2, 1);
    split.data.set([0, 0, 0, 255, 255, 255, 255, 255]);

    const mesh = buildTerrainMesh({
      ...base,
      flattenSea: true,
      tiles: [{ height: split }]
    });

    const heights = new Set<number>();
    for (let i = 0; i < mesh.vertexCount; i++) heights.add(mesh.positions[i * 3 + 1]);

    expect(heights.has(0)).toBe(true);
    expect(heights.has(80)).toBe(true);
    expect([...heights].some((value) => value < 0)).toBe(false);
  });

  it("gives a flattened underwater slope upward normals", () => {
    const shallow = createImage(4, 1);
    for (let x = 0; x < 4; x++) {
      const value = x === 0 ? 0 : 20;
      const i = x * 4;
      shallow.data[i] = value;
      shallow.data[i + 1] = value;
      shallow.data[i + 2] = value;
      shallow.data[i + 3] = 255;
    }

    const mesh = buildTerrainMesh({
      ...base,
      flattenSea: true,
      tiles: [{ height: shallow }]
    });

    for (let i = 0; i < mesh.vertexCount; i++) {
      expect(mesh.positions[i * 3 + 1]).toBe(0);
      expect(mesh.normals[i * 3]).toBeCloseTo(0);
      expect(mesh.normals[i * 3 + 1]).toBeCloseTo(1);
      expect(mesh.normals[i * 3 + 2]).toBeCloseTo(0);
    }
  });

  it("colours a white heightmap from the gradient when there is no albedo", () => {
    const mesh = buildTerrainMesh({
      ...base,
      tiles: [{ height: gray(4, 4, 255) }]
    });

    expect(mesh.colors[0]).toBeCloseTo(1);
    expect(mesh.colors[1]).toBeCloseTo(1);
    expect(mesh.colors[2]).toBeCloseTo(1);
  });

  it("emits six indices per quad", () => {
    const mesh = buildTerrainMesh({
      ...base,
      tiles: [{ height: gray(4, 4, 128) }]
    });

    expect(mesh.indices.length).toBe((4 - 1) * (4 - 1) * 6);
    expect(Math.max(...mesh.indices)).toBe(mesh.vertexCount - 1);
  });

  it("places two scene terrains in one mesh", () => {
    const mesh = buildSceneTerrainMesh([
      { ...base, x: 0, y: 0, tiles: [{}] },
      { ...base, x: 100, y: 0, tiles: [{}] }
    ]);

    const xs = new Set<number>();
    for (let i = 0; i < mesh.vertexCount; i++) xs.add(mesh.positions[i * 3]);

    expect(xs.has(0)).toBe(true);
    expect(xs.has(100)).toBe(true);
    expect(mesh.vertexCount).toBe(8);
  });
});

describe("meshFocus", () => {
  it("returns a default frame for an empty mesh", () => {
    expect(meshFocus({
      positions: new Float32Array(0),
      normals: new Float32Array(0),
      colors: new Float32Array(0),
      indices: new Uint32Array(0),
      vertexCount: 0
    })).toEqual({ center: [0, 0, 0], radius: 64 });
  });

  it("centres on the vertex bounds", () => {
    const mesh = buildTerrainMesh({
      x: 0,
      y: 0,
      countX: 1,
      countY: 1,
      tileSize: 10,
      low: 0,
      high: 0,
      seaLevel: 0,
      flattenSea: false,
      gradientId: "classic",
      tiles: [{}]
    });

    const focus = meshFocus(mesh);
    expect(focus.center[0]).toBeCloseTo(5);
    expect(focus.center[2]).toBeCloseTo(5);
    expect(focus.radius).toBeGreaterThanOrEqual(8);
  });
});
