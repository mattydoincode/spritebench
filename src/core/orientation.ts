import { cloneImage, createImage } from "./pixels";
import type { ImageOrientation, RgbaImage } from "./types";

export function hasOrientationWork(
  orientation: ImageOrientation,
  flipHorizontal: boolean,
  flipVertical: boolean
): boolean {
  return orientation !== "none" || flipHorizontal || flipVertical;
}

function rotate90(image: RgbaImage, clockwise: boolean): RgbaImage {
  const out = createImage(image.height, image.width);

  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const tx = clockwise ? image.height - 1 - y : y;
      const ty = clockwise ? x : image.width - 1 - x;

      const si = (y * image.width + x) * 4;
      const ti = (ty * out.width + tx) * 4;
      out.data[ti] = image.data[si];
      out.data[ti + 1] = image.data[si + 1];
      out.data[ti + 2] = image.data[si + 2];
      out.data[ti + 3] = image.data[si + 3];
    }
  }

  return out;
}

function rotate180(image: RgbaImage): RgbaImage {
  const out = createImage(image.width, image.height);
  const count = image.width * image.height;

  for (let i = 0; i < count; i++) {
    const si = i * 4;
    const ti = (count - 1 - i) * 4;
    out.data[ti] = image.data[si];
    out.data[ti + 1] = image.data[si + 1];
    out.data[ti + 2] = image.data[si + 2];
    out.data[ti + 3] = image.data[si + 3];
  }

  return out;
}

export function flipHorizontally(image: RgbaImage): RgbaImage {
  const out = createImage(image.width, image.height);

  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const si = (y * image.width + x) * 4;
      const ti = (y * image.width + (image.width - 1 - x)) * 4;
      out.data[ti] = image.data[si];
      out.data[ti + 1] = image.data[si + 1];
      out.data[ti + 2] = image.data[si + 2];
      out.data[ti + 3] = image.data[si + 3];
    }
  }

  return out;
}

export function flipVertically(image: RgbaImage): RgbaImage {
  const out = createImage(image.width, image.height);
  const rowBytes = image.width * 4;

  for (let y = 0; y < image.height; y++) {
    const source = image.data.subarray(y * rowBytes, (y + 1) * rowBytes);
    out.data.set(source, (image.height - 1 - y) * rowBytes);
  }

  return out;
}

export function applyOrientation(
  image: RgbaImage,
  orientation: ImageOrientation,
  flipH: boolean,
  flipV: boolean
): RgbaImage {
  if (!hasOrientationWork(orientation, flipH, flipV)) return image;

  let working = cloneImage(image);

  if (orientation === "rotate90cw") working = rotate90(working, true);
  else if (orientation === "rotate90ccw") working = rotate90(working, false);
  else if (orientation === "rotate180") working = rotate180(working);

  if (flipH) working = flipHorizontally(working);
  if (flipV) working = flipVertically(working);

  return working;
}

export function describeOrientation(
  orientation: ImageOrientation,
  flipH: boolean,
  flipV: boolean
): string {
  if (!hasOrientationWork(orientation, flipH, flipV)) return "";

  const turn =
    orientation === "rotate90cw"
      ? "rotate 90cw"
      : orientation === "rotate180"
        ? "rotate 180"
        : orientation === "rotate90ccw"
          ? "rotate 90ccw"
          : "";

  const flip = flipH && flipV ? "flip xy" : flipH ? "flip x" : flipV ? "flip y" : "";

  if (!turn) return flip;
  return flip ? `${turn} ${flip}` : turn;
}
