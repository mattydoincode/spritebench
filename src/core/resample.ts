import { createImage, toByte } from "./pixels";
import type { PixelateMode, RgbaImage, Size } from "./types";

export function fitToHeight(source: Size, targetHeight: number): Size {
  const height = Math.max(1, Math.floor(targetHeight));
  if (source.height <= 0) return { width: height, height };

  return {
    width: Math.max(1, Math.round((source.width * height) / source.height)),
    height
  };
}

export function resolveTargetSize(source: Size, requested: Size): Size {
  const wantWidth = Math.floor(requested.width);
  const wantHeight = Math.floor(requested.height);

  if (wantWidth <= 0 && wantHeight <= 0) return { width: 0, height: 0 };
  if (wantWidth > 0 && wantHeight > 0) return { width: wantWidth, height: wantHeight };

  if (wantHeight > 0) return fitToHeight(source, wantHeight);

  return {
    width: wantWidth,
    height: Math.max(1, Math.round((source.height * wantWidth) / Math.max(1, source.width)))
  };
}

type Kernel = { support: number; weight: (t: number) => number };

const triangle: Kernel = {
  support: 1,
  weight: (t) => {
    const a = Math.abs(t);
    return a < 1 ? 1 - a : 0;
  }
};

const catmullRom: Kernel = {
  support: 2,
  weight: (t) => {
    const a = Math.abs(t);
    if (a < 1) return 1.5 * a * a * a - 2.5 * a * a + 1;
    if (a < 2) return -0.5 * a * a * a + 2.5 * a * a - 4 * a + 2;
    return 0;
  }
};

function sinc(x: number): number {
  if (x === 0) return 1;
  const p = Math.PI * x;
  return Math.sin(p) / p;
}

const lanczos3: Kernel = {
  support: 3,
  weight: (t) => {
    const a = Math.abs(t);
    return a < 3 ? sinc(a) * sinc(a / 3) : 0;
  }
};

interface Contribution {
  start: number;
  weights: Float32Array;
}

function buildContributions(sourceLength: number, targetLength: number, kernel: Kernel): Contribution[] {
  const ratio = sourceLength / targetLength;
  const filterScale = Math.max(1, ratio);
  const support = kernel.support * filterScale;
  const out: Contribution[] = [];

  for (let i = 0; i < targetLength; i++) {
    const center = (i + 0.5) * ratio;
    const start = Math.max(0, Math.floor(center - support + 0.5));
    const end = Math.min(sourceLength - 1, Math.ceil(center + support - 0.5));
    const count = Math.max(1, end - start + 1);
    const weights = new Float32Array(count);

    let total = 0;
    for (let k = 0; k < count; k++) {
      const w = kernel.weight((start + k + 0.5 - center) / filterScale);
      weights[k] = w;
      total += w;
    }

    if (total !== 0) {
      for (let k = 0; k < count; k++) weights[k] /= total;
    } else {
      weights.fill(0);
      weights[Math.floor(count / 2)] = 1;
    }

    out.push({ start, weights });
  }

  return out;
}

function resampleKernel(source: RgbaImage, target: Size, kernel: Kernel): RgbaImage {
  const horizontal = buildContributions(source.width, target.width, kernel);
  const vertical = buildContributions(source.height, target.height, kernel);

  const intermediate = new Float32Array(target.width * source.height * 4);

  for (let y = 0; y < source.height; y++) {
    for (let x = 0; x < target.width; x++) {
      const { start, weights } = horizontal[x];
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;

      for (let k = 0; k < weights.length; k++) {
        const si = (y * source.width + start + k) * 4;
        const w = weights[k];
        const alpha = source.data[si + 3] / 255;
        r += source.data[si] * alpha * w;
        g += source.data[si + 1] * alpha * w;
        b += source.data[si + 2] * alpha * w;
        a += alpha * w;
      }

      const ti = (y * target.width + x) * 4;
      intermediate[ti] = r;
      intermediate[ti + 1] = g;
      intermediate[ti + 2] = b;
      intermediate[ti + 3] = a;
    }
  }

  const out = createImage(target.width, target.height);

  for (let y = 0; y < target.height; y++) {
    const { start, weights } = vertical[y];

    for (let x = 0; x < target.width; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;

      for (let k = 0; k < weights.length; k++) {
        const si = ((start + k) * target.width + x) * 4;
        const w = weights[k];
        r += intermediate[si] * w;
        g += intermediate[si + 1] * w;
        b += intermediate[si + 2] * w;
        a += intermediate[si + 3] * w;
      }

      const ti = (y * target.width + x) * 4;
      out.data[ti + 3] = Math.round(Math.min(1, Math.max(0, a)) * 255);

      if (a > 0.0001) {
        out.data[ti] = Math.round(r / a);
        out.data[ti + 1] = Math.round(g / a);
        out.data[ti + 2] = Math.round(b / a);
      }
    }
  }

  return out;
}

function resampleNearest(source: RgbaImage, target: Size): RgbaImage {
  const out = createImage(target.width, target.height);

  for (let y = 0; y < target.height; y++) {
    const sy = Math.min(source.height - 1, Math.floor((y * source.height) / target.height));

    for (let x = 0; x < target.width; x++) {
      const sx = Math.min(source.width - 1, Math.floor((x * source.width) / target.width));
      const si = (sy * source.width + sx) * 4;
      const ti = (y * target.width + x) * 4;
      out.data[ti] = source.data[si];
      out.data[ti + 1] = source.data[si + 1];
      out.data[ti + 2] = source.data[si + 2];
      out.data[ti + 3] = source.data[si + 3];
    }
  }

  return out;
}

function blockBounds(index: number, sourceLength: number, targetLength: number): [number, number] {
  const start = Math.floor((index * sourceLength) / targetLength);
  const end = Math.max(start + 1, Math.floor(((index + 1) * sourceLength) / targetLength));
  return [start, Math.min(end, sourceLength)];
}

function resampleBoxAverage(source: RgbaImage, target: Size): RgbaImage {
  const out = createImage(target.width, target.height);

  for (let y = 0; y < target.height; y++) {
    const [startY, endY] = blockBounds(y, source.height, target.height);

    for (let x = 0; x < target.width; x++) {
      const [startX, endX] = blockBounds(x, source.width, target.width);

      let r = 0;
      let g = 0;
      let b = 0;
      let alphaSum = 0;
      let samples = 0;

      for (let sy = startY; sy < endY; sy++) {
        for (let sx = startX; sx < endX; sx++) {
          const si = (sy * source.width + sx) * 4;
          const alpha = source.data[si + 3];
          r += source.data[si] * alpha;
          g += source.data[si + 1] * alpha;
          b += source.data[si + 2] * alpha;
          alphaSum += alpha;
          samples++;
        }
      }

      const ti = (y * target.width + x) * 4;
      if (alphaSum <= 0 || samples === 0) continue;

      out.data[ti] = Math.round(r / alphaSum);
      out.data[ti + 1] = Math.round(g / alphaSum);
      out.data[ti + 2] = Math.round(b / alphaSum);
      out.data[ti + 3] = Math.round(alphaSum / samples);
    }
  }

  return out;
}

function resampleDominantColor(source: RgbaImage, target: Size, alphaThreshold: number): RgbaImage {
  const out = createImage(target.width, target.height);
  const cutoff = toByte(alphaThreshold);
  const counts = new Map<number, number>();

  for (let y = 0; y < target.height; y++) {
    const [startY, endY] = blockBounds(y, source.height, target.height);

    for (let x = 0; x < target.width; x++) {
      const [startX, endX] = blockBounds(x, source.width, target.width);

      counts.clear();
      let samples = 0;
      let opaque = 0;

      for (let sy = startY; sy < endY; sy++) {
        for (let sx = startX; sx < endX; sx++) {
          const si = (sy * source.width + sx) * 4;
          samples++;

          if (source.data[si + 3] < cutoff) continue;
          opaque++;

          const key = (source.data[si] << 16) | (source.data[si + 1] << 8) | source.data[si + 2];
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
      }

      if (opaque * 2 < samples || counts.size === 0) continue;

      let bestKey = 0;
      let bestCount = -1;
      for (const [key, count] of counts) {
        if (count > bestCount) {
          bestCount = count;
          bestKey = key;
        }
      }

      const ti = (y * target.width + x) * 4;
      out.data[ti] = (bestKey >> 16) & 0xff;
      out.data[ti + 1] = (bestKey >> 8) & 0xff;
      out.data[ti + 2] = bestKey & 0xff;
      out.data[ti + 3] = 255;
    }
  }

  return out;
}

export function resize(
  source: RgbaImage,
  target: Size,
  mode: PixelateMode,
  alphaThreshold: number
): RgbaImage {
  const width = Math.max(1, Math.floor(target.width));
  const height = Math.max(1, Math.floor(target.height));
  if (width === source.width && height === source.height) return source;

  const size = { width, height };

  switch (mode) {
    case "nearest":
      return resampleNearest(source, size);
    case "bilinear":
      return resampleKernel(source, size, triangle);
    case "bicubic":
      return resampleKernel(source, size, catmullRom);
    case "lanczos":
      return resampleKernel(source, size, lanczos3);
    case "boxAverage":
      return resampleBoxAverage(source, size);
    case "dominantColor":
    default:
      return resampleDominantColor(source, size, alphaThreshold);
  }
}