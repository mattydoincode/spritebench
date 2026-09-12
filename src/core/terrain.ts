import { luminance } from "./pixels";
import type { RgbaImage, Rgb } from "./types";

/**
 * Heightfield math for the terrain scene object.
 *
 * The canvas only draws. Caps live here so a 2k heightmap cannot become a
 * million-vert mesh, and so a test can assert the bound without a GPU.
 */

/** Default long-edge samples per tile. Cheap enough to leave on. */
export const MAX_TERRAIN_SAMPLES = 128;
/** Hard ceiling if you raise the per-terrain sample count. */
export const MAX_TERRAIN_DETAIL = 2048;
export const MAX_TERRAIN_TILES = 8;

export const TERRAIN_GRADIENTS = ["classic", "desert", "arctic", "palette"] as const;
export type TerrainGradientId = (typeof TERRAIN_GRADIENTS)[number];

export const TERRAIN_GRADIENT_LABELS: Record<TerrainGradientId, string> = {
  classic: "classic",
  desert: "desert",
  arctic: "arctic",
  palette: "scene palette"
};

export interface TerrainTile {
  heightAssetId: string;
  colorAssetId: string;
}

export const EMPTY_TERRAIN_TILE: TerrainTile = { heightAssetId: "", colorAssetId: "" };

export const DEFAULT_TERRAIN = {
  countX: 1,
  countY: 1,
  tileSize: 64,
  samples: 512,
  low: 0,
  high: 8,
  seaLevel: 3,
  flattenSea: true,
  gradientId: "classic" as const
};

export function clampTerrainCount(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(MAX_TERRAIN_TILES, Math.max(1, Math.floor(value)));
}

export function clampTileSize(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_TERRAIN.tileSize;
  return Math.max(1, value);
}

export function clampTerrainSamples(value: number): number {
  if (!Number.isFinite(value)) return MAX_TERRAIN_SAMPLES;
  return Math.min(MAX_TERRAIN_DETAIL, Math.max(2, Math.floor(value)));
}

export function emptyTiles(countX: number, countY: number): TerrainTile[] {
  const cols = clampTerrainCount(countX);
  const rows = clampTerrainCount(countY);
  return Array.from({ length: cols * rows }, () => ({ ...EMPTY_TERRAIN_TILE }));
}

/**
 * Keeps overlapping cells when the grid is resized. Extra cells are empty;
 * cells that fall off the new edge are dropped.
 */
export function resizeTerrainGrid(
  tiles: TerrainTile[],
  fromX: number,
  fromY: number,
  toX: number,
  toY: number
): TerrainTile[] {
  const oldX = clampTerrainCount(fromX);
  const oldY = clampTerrainCount(fromY);
  const nextX = clampTerrainCount(toX);
  const nextY = clampTerrainCount(toY);
  const next = emptyTiles(nextX, nextY);

  for (let row = 0; row < Math.min(oldY, nextY); row++) {
    for (let col = 0; col < Math.min(oldX, nextX); col++) {
      const source = tiles[row * oldX + col];
      if (source) next[row * nextX + col] = { ...source };
    }
  }

  return next;
}

export function tileIndex(col: number, row: number, countX: number): number {
  return row * clampTerrainCount(countX) + col;
}

export function terrainExtent(terrain: {
  countX: number;
  countY: number;
  tileSize: number;
}): { width: number; height: number } {
  const size = clampTileSize(terrain.tileSize);
  return {
    width: clampTerrainCount(terrain.countX) * size,
    height: clampTerrainCount(terrain.countY) * size
  };
}

/** Top-left of a cell in the same 2D units the scene uses. XZ in the mesh. */
export function tileOrigin(
  terrain: { x: number; y: number; tileSize: number },
  col: number,
  row: number
): { x: number; z: number } {
  const size = clampTileSize(terrain.tileSize);
  return {
    x: terrain.x + col * size,
    z: terrain.y + row * size
  };
}

export function heightFromLuma(luma: number, low: number, high: number): number {
  const t = Number.isFinite(luma) ? Math.min(1, Math.max(0, luma)) : 0;
  const floor = Number.isFinite(low) ? low : DEFAULT_TERRAIN.low;
  const ceil = Number.isFinite(high) ? high : DEFAULT_TERRAIN.high;
  return floor + t * (ceil - floor);
}

export function heightNorm(height: number, low: number, high: number): number {
  const floor = Number.isFinite(low) ? low : DEFAULT_TERRAIN.low;
  const ceil = Number.isFinite(high) ? high : DEFAULT_TERRAIN.high;
  if (ceil === floor) return 0;
  return Math.min(1, Math.max(0, (height - floor) / (ceil - floor)));
}

interface GradientStop {
  t: number;
  color: Rgb;
}

const CLASSIC_STOPS: GradientStop[] = [
  { t: 0, color: { r: 11, g: 29, b: 54 } },
  { t: 0.22, color: { r: 29, g: 78, b: 137 } },
  { t: 0.28, color: { r: 194, g: 178, b: 128 } },
  { t: 0.4, color: { r: 61, g: 122, b: 58 } },
  { t: 0.65, color: { r: 107, g: 94, b: 79 } },
  { t: 0.85, color: { r: 232, g: 238, b: 244 } },
  { t: 1, color: { r: 255, g: 255, b: 255 } }
];

const DESERT_STOPS: GradientStop[] = [
  { t: 0, color: { r: 61, g: 43, b: 31 } },
  { t: 0.3, color: { r: 196, g: 165, b: 116 } },
  { t: 0.6, color: { r: 138, g: 106, b: 58 } },
  { t: 0.85, color: { r: 90, g: 64, b: 48 } },
  { t: 1, color: { r: 217, g: 200, b: 168 } }
];

const ARCTIC_STOPS: GradientStop[] = [
  { t: 0, color: { r: 10, g: 39, b: 68 } },
  { t: 0.25, color: { r: 74, g: 127, b: 160 } },
  { t: 0.4, color: { r: 184, g: 212, b: 227 } },
  { t: 0.7, color: { r: 232, g: 240, b: 245 } },
  { t: 1, color: { r: 138, g: 154, b: 170 } }
];

const PRESET_STOPS: Record<Exclude<TerrainGradientId, "palette">, GradientStop[]> = {
  classic: CLASSIC_STOPS,
  desert: DESERT_STOPS,
  arctic: ARCTIC_STOPS
};

function lerpByte(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

function lerpRgb(a: Rgb, b: Rgb, t: number): Rgb {
  return {
    r: lerpByte(a.r, b.r, t),
    g: lerpByte(a.g, b.g, t),
    b: lerpByte(a.b, b.b, t)
  };
}

function sampleStops(stops: GradientStop[], t: number): Rgb {
  const clamped = Math.min(1, Math.max(0, t));
  if (stops.length === 0) return { r: 128, g: 128, b: 128 };

  let next = stops[stops.length - 1];
  let prev = stops[0];
  for (let index = 1; index < stops.length; index++) {
    if (clamped <= stops[index].t) {
      next = stops[index];
      prev = stops[index - 1];
      break;
    }
  }

  const span = next.t - prev.t;
  const local = span <= 0 ? 0 : (clamped - prev.t) / span;
  return lerpRgb(prev.color, next.color, local);
}

export function sampleGradient(
  id: TerrainGradientId,
  t: number,
  palette: Rgb[] = []
): Rgb {
  if (id === "palette") {
    if (palette.length === 0) return sampleStops(CLASSIC_STOPS, t);
    const last = palette.length - 1;
    const index = Math.min(last, Math.max(0, Math.round(Math.min(1, Math.max(0, t)) * last)));
    return palette[index];
  }

  return sampleStops(PRESET_STOPS[id] ?? CLASSIC_STOPS, t);
}

/** Long edge capped; the other scales with the image. Never below 2. */
export function sampleGridSize(
  width: number,
  height: number,
  max = MAX_TERRAIN_SAMPLES
): { columns: number; rows: number } {
  const w = Math.max(1, Math.floor(width));
  const h = Math.max(1, Math.floor(height));
  const cap = Math.max(2, Math.floor(max));
  const long = Math.max(w, h);

  if (long <= cap) return { columns: Math.max(2, w), rows: Math.max(2, h) };

  const scale = cap / long;
  return {
    columns: Math.max(2, Math.round(w * scale)),
    rows: Math.max(2, Math.round(h * scale))
  };
}

function pixelAt(image: RgbaImage, x: number, y: number): { r: number; g: number; b: number } {
  const cx = Math.min(image.width - 1, Math.max(0, x));
  const cy = Math.min(image.height - 1, Math.max(0, y));
  const i = (cy * image.width + cx) * 4;
  return { r: image.data[i], g: image.data[i + 1], b: image.data[i + 2] };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * UV 0..1 maps onto pixel corners so a vert on the sample grid hits a texel,
 * and anything in between blends the four neighbours.
 */
export function sampleBilinear(
  image: RgbaImage,
  u: number,
  v: number
): { r: number; g: number; b: number } {
  if (image.width <= 0 || image.height <= 0) return { r: 0, g: 0, b: 0 };

  const x = Math.min(1, Math.max(0, u)) * Math.max(0, image.width - 1);
  const y = Math.min(1, Math.max(0, v)) * Math.max(0, image.height - 1);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = x - x0;
  const ty = y - y0;

  const a = pixelAt(image, x0, y0);
  const b = pixelAt(image, x0 + 1, y0);
  const c = pixelAt(image, x0, y0 + 1);
  const d = pixelAt(image, x0 + 1, y0 + 1);

  return {
    r: lerp(lerp(a.r, b.r, tx), lerp(c.r, d.r, tx), ty),
    g: lerp(lerp(a.g, b.g, tx), lerp(c.g, d.g, tx), ty),
    b: lerp(lerp(a.b, b.b, tx), lerp(c.b, d.b, tx), ty)
  };
}

export interface TerrainMesh {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
  vertexCount: number;
}

export interface TerrainTileImages {
  height?: RgbaImage | null;
  color?: RgbaImage | null;
}

export interface TerrainBuildOptions {
  x: number;
  y: number;
  countX: number;
  countY: number;
  tileSize: number;
  /** Long-edge samples per tile. Missing uses the default 512. */
  samples?: number;
  low: number;
  high: number;
  seaLevel: number;
  flattenSea: boolean;
  gradientId: TerrainGradientId;
  tiles: TerrainTileImages[];
  palette?: Rgb[];
}

function emptyMesh(): TerrainMesh {
  return {
    positions: new Float32Array(0),
    normals: new Float32Array(0),
    colors: new Float32Array(0),
    indices: new Uint32Array(0),
    vertexCount: 0
  };
}

function buildTileMesh(
  origin: { x: number; z: number },
  tileSize: number,
  images: TerrainTileImages,
  options: Pick<
    TerrainBuildOptions,
    "low" | "high" | "seaLevel" | "flattenSea" | "gradientId" | "samples"
  >,
  palette: Rgb[]
): TerrainMesh {
  const heightMap = images.height ?? null;
  const colorMap = images.color ?? null;
  const cap = clampTerrainSamples(options.samples ?? DEFAULT_TERRAIN.samples);
  const grid = heightMap
    ? sampleGridSize(heightMap.width, heightMap.height, cap)
    : { columns: 2, rows: 2 };

  const columns = grid.columns;
  const rows = grid.rows;
  const vertexCount = columns * rows;
  const positions = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);
  const heights = new Float32Array(vertexCount);

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < columns; col++) {
      const u = columns === 1 ? 0 : col / (columns - 1);
      const v = rows === 1 ? 0 : row / (rows - 1);
      const index = row * columns + col;

      let elevation = options.seaLevel;

      if (heightMap) {
        const pixel = sampleBilinear(heightMap, u, v);
        elevation = heightFromLuma(luminance(pixel.r, pixel.g, pixel.b), options.low, options.high);
      }

      const drawn = options.flattenSea ? Math.max(elevation, options.seaLevel) : elevation;
      heights[index] = drawn;

      positions[index * 3] = origin.x + u * tileSize;
      positions[index * 3 + 1] = drawn;
      positions[index * 3 + 2] = origin.z + v * tileSize;

      const tint = colorMap
        ? sampleBilinear(colorMap, u, v)
        : sampleGradient(options.gradientId, heightNorm(elevation, options.low, options.high), palette);

      colors[index * 3] = tint.r / 255;
      colors[index * 3 + 1] = tint.g / 255;
      colors[index * 3 + 2] = tint.b / 255;
    }
  }

  const normals = new Float32Array(vertexCount * 3);
  const stepX = tileSize / Math.max(1, columns - 1);
  const stepZ = tileSize / Math.max(1, rows - 1);

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < columns; col++) {
      const index = row * columns + col;
      const left = col > 0 ? heights[index - 1] : heights[index];
      const right = col < columns - 1 ? heights[index + 1] : heights[index];
      const up = row > 0 ? heights[index - columns] : heights[index];
      const down = row < rows - 1 ? heights[index + columns] : heights[index];

      const dx = (right - left) / (col > 0 && col < columns - 1 ? 2 * stepX : stepX || 1);
      const dz = (down - up) / (row > 0 && row < rows - 1 ? 2 * stepZ : stepZ || 1);

      // Cross of (1, dx, 0) and (0, dz, 1) → (-dx, 1, -dz). Uses drawn
      // heights so a flattened sea is actually flat, not a lit slope.
      let nx = -dx;
      let ny = 1;
      let nz = -dz;
      const length = Math.hypot(nx, ny, nz) || 1;
      normals[index * 3] = nx / length;
      normals[index * 3 + 1] = ny / length;
      normals[index * 3 + 2] = nz / length;
    }
  }

  const quadCols = columns - 1;
  const quadRows = rows - 1;
  const indices = new Uint32Array(Math.max(0, quadCols * quadRows * 6));
  let cursor = 0;

  for (let row = 0; row < quadRows; row++) {
    for (let col = 0; col < quadCols; col++) {
      const a = row * columns + col;
      const b = a + 1;
      const c = a + columns;
      const d = c + 1;
      indices[cursor++] = a;
      indices[cursor++] = c;
      indices[cursor++] = b;
      indices[cursor++] = b;
      indices[cursor++] = c;
      indices[cursor++] = d;
    }
  }

  return { positions, normals, colors, indices, vertexCount };
}

function concatMeshes(parts: TerrainMesh[]): TerrainMesh {
  if (parts.length === 0) return emptyMesh();
  if (parts.length === 1) return parts[0];

  let vertexCount = 0;
  let indexCount = 0;
  for (const part of parts) {
    vertexCount += part.vertexCount;
    indexCount += part.indices.length;
  }

  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);
  const indices = new Uint32Array(indexCount);

  let vertexOffset = 0;
  let indexOffset = 0;

  for (const part of parts) {
    positions.set(part.positions, vertexOffset * 3);
    normals.set(part.normals, vertexOffset * 3);
    colors.set(part.colors, vertexOffset * 3);
    for (let i = 0; i < part.indices.length; i++) {
      indices[indexOffset + i] = part.indices[i] + vertexOffset;
    }
    vertexOffset += part.vertexCount;
    indexOffset += part.indices.length;
  }

  return { positions, normals, colors, indices, vertexCount };
}

export function buildTerrainMesh(options: TerrainBuildOptions): TerrainMesh {
  const countX = clampTerrainCount(options.countX);
  const countY = clampTerrainCount(options.countY);
  const tileSize = clampTileSize(options.tileSize);
  const palette = options.palette ?? [];
  const parts: TerrainMesh[] = [];

  for (let row = 0; row < countY; row++) {
    for (let col = 0; col < countX; col++) {
      const images = options.tiles[tileIndex(col, row, countX)] ?? {};
      parts.push(
        buildTileMesh(
          tileOrigin({ x: options.x, y: options.y, tileSize }, col, row),
          tileSize,
          images,
          options,
          palette
        )
      );
    }
  }

  return concatMeshes(parts);
}

export function buildSceneTerrainMesh(
  terrains: TerrainBuildOptions[]
): TerrainMesh {
  return concatMeshes(terrains.map((terrain) => buildTerrainMesh(terrain)));
}

export function meshFocus(mesh: TerrainMesh): { center: [number, number, number]; radius: number } {
  if (mesh.vertexCount === 0) return { center: [0, 0, 0], radius: 64 };

  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  for (let i = 0; i < mesh.vertexCount; i++) {
    const x = mesh.positions[i * 3];
    const y = mesh.positions[i * 3 + 1];
    const z = mesh.positions[i * 3 + 2];
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    maxZ = Math.max(maxZ, z);
  }

  const center: [number, number, number] = [
    (minX + maxX) / 2,
    (minY + maxY) / 2,
    (minZ + maxZ) / 2
  ];
  const radius = Math.max(8, Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) / 2);
  return { center, radius };
}
