import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { decodePng } from "@/server/png";
import { createImage } from "@/core/pixels";
import type { Rgb, RgbaImage } from "@/core/types";

const FIXTURE_DIR = path.join(import.meta.dirname, "fixtures");

export function loadFixture(name: string): RgbaImage {
  return decodePng(fs.readFileSync(path.join(FIXTURE_DIR, name)));
}

/** Stable digest of the raw RGBA buffer, so golden tests pin actual pixels. */
export function hashImage(image: RgbaImage): string {
  return crypto
    .createHash("sha256")
    .update(Buffer.from(image.data.buffer, image.data.byteOffset, image.data.byteLength))
    .digest("hex")
    .slice(0, 16);
}

export function fingerprint(image: RgbaImage, description: string) {
  return {
    size: `${image.width}x${image.height}`,
    description,
    sha256: hashImage(image)
  };
}

export function solid(width: number, height: number, color: Rgb, alpha = 255): RgbaImage {
  const image = createImage(width, height);

  for (let pixel = 0; pixel < width * height; pixel++) {
    const i = pixel * 4;
    image.data[i] = color.r;
    image.data[i + 1] = color.g;
    image.data[i + 2] = color.b;
    image.data[i + 3] = alpha;
  }

  return image;
}

/** A `border`-coloured frame around a `fill`-coloured centre. */
export function framed(
  size: number,
  border: Rgb,
  fill: Rgb,
  inset: number
): RgbaImage {
  const image = solid(size, size, border);

  for (let y = inset; y < size - inset; y++) {
    for (let x = inset; x < size - inset; x++) {
      const i = (y * size + x) * 4;
      image.data[i] = fill.r;
      image.data[i + 1] = fill.g;
      image.data[i + 2] = fill.b;
      image.data[i + 3] = 255;
    }
  }

  return image;
}

export function alphaAt(image: RgbaImage, x: number, y: number): number {
  return image.data[(y * image.width + x) * 4 + 3];
}

export function countOpaque(image: RgbaImage, cutoff = 128): number {
  let total = 0;
  for (let pixel = 0; pixel < image.width * image.height; pixel++) {
    if (image.data[pixel * 4 + 3] >= cutoff) total++;
  }
  return total;
}
