import { cloneImage, createImage, luminance, normalizedDistance, toByte } from "./pixels";
import type { CutoutMode, Rgb, RgbaImage } from "./types";

export function sampleBackgroundColor(image: RgbaImage, cornersOnly: boolean): Rgb {
  const counts = new Map<number, number>();
  const { width, height, data } = image;

  const consider = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    if (data[i + 3] <= 0) return;

    const qr = Math.round((data[i] / 255) * 15);
    const qg = Math.round((data[i + 1] / 255) * 15);
    const qb = Math.round((data[i + 2] / 255) * 15);
    const key = (qr << 8) | (qg << 4) | qb;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  };

  if (cornersOnly) {
    consider(0, 0);
    consider(width - 1, 0);
    consider(0, height - 1);
    consider(width - 1, height - 1);
  } else {
    for (let x = 0; x < width; x++) {
      consider(x, 0);
      consider(x, height - 1);
    }
    for (let y = 0; y < height; y++) {
      consider(0, y);
      consider(width - 1, y);
    }
  }

  if (counts.size === 0) return { r: 255, g: 255, b: 255 };

  let bestKey = 0;
  let bestCount = -1;
  for (const [key, count] of counts) {
    if (count > bestCount) {
      bestCount = count;
      bestKey = key;
    }
  }

  return {
    r: (((bestKey >> 8) & 0xf) / 15) * 255,
    g: (((bestKey >> 4) & 0xf) / 15) * 255,
    b: ((bestKey & 0xf) / 15) * 255
  };
}

export function transparentBorderFraction(image: RgbaImage, alphaThreshold: number): number {
  const cutoff = toByte(alphaThreshold);
  const { width, height, data } = image;
  let clear = 0;
  let samples = 0;

  const consider = (x: number, y: number) => {
    samples++;
    if (data[(y * width + x) * 4 + 3] < cutoff) clear++;
  };

  for (let x = 0; x < width; x++) {
    consider(x, 0);
    consider(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    consider(0, y);
    consider(width - 1, y);
  }

  return samples === 0 ? 0 : clear / samples;
}

function edgeFloodFill(
  image: RgbaImage,
  tolerance: number,
  localTolerance: number,
  sampleCornersOnly: boolean
): RgbaImage {
  const out = cloneImage(image);
  const { width, height, data } = out;
  const reference = sampleBackgroundColor(image, sampleCornersOnly);
  const visited = new Uint8Array(width * height);
  const stack = new Int32Array(width * height);
  let top = 0;

  const tryPush = (x: number, y: number, fromR: number, fromG: number, fromB: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;

    const pixel = y * width + x;
    if (visited[pixel]) return;

    const i = pixel * 4;
    if (data[i + 3] <= 0) {
      visited[pixel] = 1;
      return;
    }

    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    if (normalizedDistance(r, g, b, reference.r, reference.g, reference.b) > tolerance) return;
    if (normalizedDistance(r, g, b, fromR, fromG, fromB) > localTolerance) return;

    visited[pixel] = 1;
    stack[top++] = pixel;
  };

  for (let x = 0; x < width; x++) {
    tryPush(x, 0, reference.r, reference.g, reference.b);
    tryPush(x, height - 1, reference.r, reference.g, reference.b);
  }
  for (let y = 0; y < height; y++) {
    tryPush(0, y, reference.r, reference.g, reference.b);
    tryPush(width - 1, y, reference.r, reference.g, reference.b);
  }

  while (top > 0) {
    const pixel = stack[--top];
    const x = pixel % width;
    const y = (pixel - x) / width;
    const i = pixel * 4;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    tryPush(x + 1, y, r, g, b);
    tryPush(x - 1, y, r, g, b);
    tryPush(x, y + 1, r, g, b);
    tryPush(x, y - 1, r, g, b);
  }

  for (let pixel = 0; pixel < visited.length; pixel++) {
    if (visited[pixel]) out.data[pixel * 4 + 3] = 0;
  }

  return out;
}

export function cut(
  image: RgbaImage,
  mode: CutoutMode,
  chromaKey: Rgb,
  tolerance: number,
  localTolerance: number,
  luminanceThreshold: number,
  sampleCornersOnly: boolean
): RgbaImage {
  if (mode === "none") return image;
  if (mode === "edgeFloodFill") {
    return edgeFloodFill(image, tolerance, localTolerance, sampleCornersOnly);
  }

  const out = cloneImage(image);
  const count = out.width * out.height;

  for (let pixel = 0; pixel < count; pixel++) {
    const i = pixel * 4;
    if (out.data[i + 3] <= 0) continue;

    const r = out.data[i];
    const g = out.data[i + 1];
    const b = out.data[i + 2];

    let clear = false;
    if (mode === "chromaKey") {
      clear = normalizedDistance(r, g, b, chromaKey.r, chromaKey.g, chromaKey.b) <= tolerance;
    } else {
      const lum = luminance(r, g, b);
      clear = mode === "luminanceAbove" ? lum >= luminanceThreshold : lum <= luminanceThreshold;
    }

    if (clear) out.data[i + 3] = 0;
  }

  return out;
}

export function snapAlpha(image: RgbaImage, threshold: number): RgbaImage {
  const out = cloneImage(image);
  const cutoff = toByte(threshold);
  const count = out.width * out.height;

  for (let pixel = 0; pixel < count; pixel++) {
    const i = pixel * 4 + 3;
    out.data[i] = out.data[i] >= cutoff ? 255 : 0;
  }

  return out;
}

function alphaAtClamped(image: RgbaImage, x: number, y: number): number {
  const cx = Math.min(image.width - 1, Math.max(0, x));
  const cy = Math.min(image.height - 1, Math.max(0, y));
  return image.data[(cy * image.width + cx) * 4 + 3];
}

export function erodeAlpha(image: RgbaImage, pixels: number, alphaThreshold: number): RgbaImage {
  const passes = Math.max(0, Math.floor(pixels));
  if (passes === 0) return image;

  const cutoff = toByte(alphaThreshold);
  let current = cloneImage(image);

  for (let pass = 0; pass < passes; pass++) {
    const snapshot = cloneImage(current);

    for (let y = 0; y < current.height; y++) {
      for (let x = 0; x < current.width; x++) {
        const i = (y * current.width + x) * 4;
        if (snapshot.data[i + 3] < cutoff) continue;

        let exposed = false;
        for (let dy = -1; dy <= 1 && !exposed; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            if (alphaAtClamped(snapshot, x + dx, y + dy) < cutoff) {
              exposed = true;
              break;
            }
          }
        }

        if (exposed) current.data[i + 3] = 0;
      }
    }
  }

  return current;
}

export function despeckle(
  image: RgbaImage,
  minimumOpaqueNeighbors: number,
  fillHoles: boolean,
  alphaThreshold: number
): RgbaImage {
  const minimum = Math.max(0, Math.floor(minimumOpaqueNeighbors));
  if (minimum === 0 && !fillHoles) return image;

  const cutoff = toByte(alphaThreshold);
  const snapshot = cloneImage(image);
  const out = cloneImage(image);

  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const i = (y * image.width + x) * 4;

      let opaqueNeighbors = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          if (alphaAtClamped(snapshot, x + dx, y + dy) >= cutoff) opaqueNeighbors++;
        }
      }

      const isOpaque = snapshot.data[i + 3] >= cutoff;

      if (isOpaque && minimum > 0 && opaqueNeighbors < minimum) {
        out.data[i + 3] = 0;
      } else if (!isOpaque && fillHoles && opaqueNeighbors >= 7) {
        out.data[i + 3] = 255;
      }
    }
  }

  return out;
}

export function trimToContent(
  image: RgbaImage,
  alphaThreshold: number,
  padding: number
): RgbaImage {
  const cutoff = toByte(alphaThreshold);
  let minX = image.width;
  let minY = image.height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      if (image.data[(y * image.width + x) * 4 + 3] < cutoff) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < 0) return image;

  const pad = Math.max(0, Math.floor(padding));
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(image.width - 1, maxX + pad);
  maxY = Math.min(image.height - 1, maxY + pad);

  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  if (width === image.width && height === image.height) return image;

  const out = createImage(width, height);
  for (let y = 0; y < height; y++) {
    const from = ((minY + y) * image.width + minX) * 4;
    out.data.set(image.data.subarray(from, from + width * 4), y * width * 4);
  }

  return out;
}
