import { oklabFromSrgb } from "./oklab";
import { cloneImage, toByte } from "./pixels";
import type { ColorDistanceMode, DitherMode, Rgb, RgbaImage } from "./types";

export function parseHexList(text: string): Rgb[] {
  const colors: Rgb[] = [];

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#") && line.length < 4) continue;

    const token = line.replace(/^#/, "").split(/[\s,;]+/)[0];
    if (!/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(token)) continue;

    if (token.length === 8) {
      const alpha = parseInt(token.slice(6, 8), 16) / 255;
      if (alpha < 0.5) continue;
    }

    colors.push({
      r: parseInt(token.slice(0, 2), 16),
      g: parseInt(token.slice(2, 4), 16),
      b: parseInt(token.slice(4, 6), 16)
    });
  }

  return colors;
}

export function parseGimpPalette(text: string): Rgb[] {
  const colors: Rgb[] = [];

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (/^(GIMP Palette|Name:|Columns:)/i.test(line)) continue;

    const parts = line.split(/\s+/);
    if (parts.length < 3) continue;

    const r = Number.parseInt(parts[0], 10);
    const g = Number.parseInt(parts[1], 10);
    const b = Number.parseInt(parts[2], 10);
    if ([r, g, b].some((v) => Number.isNaN(v))) continue;

    colors.push({ r, g, b });
  }

  return colors;
}

export function parseJascPalette(text: string): Rgb[] {
  const lines = text.split(/\r?\n/);
  const colors: Rgb[] = [];

  for (const raw of lines.slice(3)) {
    const line = raw.trim();
    if (!line) continue;

    const parts = line.split(/\s+/);
    if (parts.length < 3) continue;

    const r = Number.parseInt(parts[0], 10);
    const g = Number.parseInt(parts[1], 10);
    const b = Number.parseInt(parts[2], 10);
    if ([r, g, b].some((v) => Number.isNaN(v))) continue;

    colors.push({ r, g, b });
  }

  return colors;
}

export function uniqueOpaqueColors(image: RgbaImage): Rgb[] {
  const seen = new Set<number>();
  const colors: Rgb[] = [];
  const count = image.width * image.height;

  for (let pixel = 0; pixel < count; pixel++) {
    const i = pixel * 4;
    if (image.data[i + 3] < 128) continue;

    const key = (image.data[i] << 16) | (image.data[i + 1] << 8) | image.data[i + 2];
    if (seen.has(key)) continue;

    seen.add(key);
    colors.push({ r: image.data[i], g: image.data[i + 1], b: image.data[i + 2] });
  }

  return colors;
}

export function parsePaletteText(filename: string, text: string): Rgb[] {
  const extension = filename.split(".").pop()?.toLowerCase() ?? "";
  if (extension === "gpl") return parseGimpPalette(text);
  if (extension === "pal") return parseJascPalette(text);
  return parseHexList(text);
}

function toDistanceSpace(
  colors: Rgb[],
  mode: ColorDistanceMode
): Float64Array {
  const out = new Float64Array(colors.length * 3);

  colors.forEach((color, index) => {
    const i = index * 3;
    if (mode === "oklab") {
      const [l, a, b] = oklabFromSrgb(color.r, color.g, color.b);
      out[i] = l;
      out[i + 1] = a;
      out[i + 2] = b;
    } else if (mode === "weightedRgb") {
      out[i] = (color.r / 255) * 0.299;
      out[i + 1] = (color.g / 255) * 0.587;
      out[i + 2] = (color.b / 255) * 0.114;
    } else {
      out[i] = color.r / 255;
      out[i + 1] = color.g / 255;
      out[i + 2] = color.b / 255;
    }
  });

  return out;
}

function pointInSpace(
  r: number,
  g: number,
  b: number,
  mode: ColorDistanceMode
): [number, number, number] {
  if (mode === "oklab") return oklabFromSrgb(r, g, b);
  if (mode === "weightedRgb") {
    return [(r / 255) * 0.299, (g / 255) * 0.587, (b / 255) * 0.114];
  }
  return [r / 255, g / 255, b / 255];
}

export function findNearest(
  r: number,
  g: number,
  b: number,
  paletteSpace: Float64Array,
  mode: ColorDistanceMode
): number {
  const [pl, pa, pb] = pointInSpace(r, g, b, mode);
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < paletteSpace.length / 3; index++) {
    const i = index * 3;
    const dl = pl - paletteSpace[i];
    const da = pa - paletteSpace[i + 1];
    const db = pb - paletteSpace[i + 2];
    const distance = dl * dl + da * da + db * db;

    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  }

  return best;
}

export function buildBayerMatrix(size: number): number[][] {
  let matrix = [[0]];

  while (matrix.length < size) {
    const half = matrix.length;
    const next: number[][] = Array.from({ length: half * 2 }, () => new Array(half * 2).fill(0));

    for (let y = 0; y < half; y++) {
      for (let x = 0; x < half; x++) {
        const value = matrix[y][x] * 4;
        next[y][x] = value;
        next[y][x + half] = value + 2;
        next[y + half][x] = value + 3;
        next[y + half][x + half] = value + 1;
      }
    }

    matrix = next;
  }

  return matrix;
}

const ERROR_KERNELS: Record<string, Array<[number, number, number]>> = {
  floydSteinberg: [
    [1, 0, 7 / 16],
    [-1, 1, 3 / 16],
    [0, 1, 5 / 16],
    [1, 1, 1 / 16]
  ],
  atkinson: [
    [1, 0, 1 / 8],
    [2, 0, 1 / 8],
    [-1, 1, 1 / 8],
    [0, 1, 1 / 8],
    [1, 1, 1 / 8],
    [0, 2, 1 / 8]
  ]
};

export function quantize(
  image: RgbaImage,
  palette: Rgb[],
  distanceMode: ColorDistanceMode,
  ditherMode: DitherMode,
  ditherStrength: number,
  alphaThreshold: number
): RgbaImage {
  if (palette.length === 0) return image;

  const out = cloneImage(image);
  const cutoff = toByte(alphaThreshold);
  const space = toDistanceSpace(palette, distanceMode);
  const { width, height } = out;

  const kernel = ERROR_KERNELS[ditherMode];

  if (kernel) {
    const errors = new Float32Array(width * height * 3);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const pixel = y * width + x;
        const i = pixel * 4;
        if (out.data[i + 3] < cutoff) continue;

        const e = pixel * 3;
        const wantR = out.data[i] + errors[e];
        const wantG = out.data[i + 1] + errors[e + 1];
        const wantB = out.data[i + 2] + errors[e + 2];

        const index = findNearest(
          Math.min(255, Math.max(0, wantR)),
          Math.min(255, Math.max(0, wantG)),
          Math.min(255, Math.max(0, wantB)),
          space,
          distanceMode
        );
        const chosen = palette[index];

        out.data[i] = chosen.r;
        out.data[i + 1] = chosen.g;
        out.data[i + 2] = chosen.b;

        const errR = (wantR - chosen.r) * ditherStrength;
        const errG = (wantG - chosen.g) * ditherStrength;
        const errB = (wantB - chosen.b) * ditherStrength;

        for (const [dx, dy, weight] of kernel) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;

          const ne = (ny * width + nx) * 3;
          errors[ne] += errR * weight;
          errors[ne + 1] += errG * weight;
          errors[ne + 2] += errB * weight;
        }
      }
    }

    return out;
  }

  const bayerSize =
    ditherMode === "bayer2x2" ? 2 : ditherMode === "bayer4x4" ? 4 : ditherMode === "bayer8x8" ? 8 : 0;
  const matrix = bayerSize > 0 ? buildBayerMatrix(bayerSize) : null;
  const denominator = bayerSize * bayerSize;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (out.data[i + 3] < cutoff) continue;

      let r = out.data[i];
      let g = out.data[i + 1];
      let b = out.data[i + 2];

      if (matrix) {
        const bias =
          (matrix[y % bayerSize][x % bayerSize] / denominator - 0.5) * ditherStrength * 255;
        r = Math.min(255, Math.max(0, r + bias));
        g = Math.min(255, Math.max(0, g + bias));
        b = Math.min(255, Math.max(0, b + bias));
      }

      const chosen = palette[findNearest(r, g, b, space, distanceMode)];
      out.data[i] = chosen.r;
      out.data[i + 1] = chosen.g;
      out.data[i + 2] = chosen.b;
    }
  }

  return out;
}
