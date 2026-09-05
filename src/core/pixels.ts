import type { RgbaImage, Rgb } from "./types";

export function createImage(width: number, height: number): RgbaImage {
  return {
    width: Math.max(1, Math.floor(width)),
    height: Math.max(1, Math.floor(height)),
    data: new Uint8ClampedArray(Math.max(1, Math.floor(width)) * Math.max(1, Math.floor(height)) * 4)
  };
}

export function cloneImage(image: RgbaImage): RgbaImage {
  return {
    width: image.width,
    height: image.height,
    data: new Uint8ClampedArray(image.data)
  };
}

export function toByte(normalized: number): number {
  return Math.round(Math.min(1, Math.max(0, normalized)) * 255);
}

export function luminance(r: number, g: number, b: number): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

export function normalizedDistance(
  r1: number,
  g1: number,
  b1: number,
  r2: number,
  g2: number,
  b2: number
): number {
  const dr = (r1 - r2) / 255;
  const dg = (g1 - g2) / 255;
  const db = (b1 - b2) / 255;
  return Math.sqrt(dr * dr + dg * dg + db * db) / SQRT3;
}

const SQRT3 = Math.sqrt(3);

export function hexToRgb(hex: string): Rgb {
  const cleaned = hex.replace(/^#/, "").trim();
  const full =
    cleaned.length === 3
      ? cleaned
          .split("")
          .map((c) => c + c)
          .join("")
      : cleaned;

  return {
    r: parseInt(full.slice(0, 2), 16) || 0,
    g: parseInt(full.slice(2, 4), 16) || 0,
    b: parseInt(full.slice(4, 6), 16) || 0
  };
}

export function copyRegion(
  source: RgbaImage,
  target: RgbaImage,
  sourceX: number,
  sourceY: number,
  width: number,
  height: number,
  targetX: number,
  targetY: number
): void {
  for (let y = 0; y < height; y++) {
    const sy = sourceY + y;
    const ty = targetY + y;
    if (sy < 0 || sy >= source.height || ty < 0 || ty >= target.height) continue;

    for (let x = 0; x < width; x++) {
      const sx = sourceX + x;
      const tx = targetX + x;
      if (sx < 0 || sx >= source.width || tx < 0 || tx >= target.width) continue;

      const si = (sy * source.width + sx) * 4;
      const ti = (ty * target.width + tx) * 4;
      target.data[ti] = source.data[si];
      target.data[ti + 1] = source.data[si + 1];
      target.data[ti + 2] = source.data[si + 2];
      target.data[ti + 3] = source.data[si + 3];
    }
  }
}
