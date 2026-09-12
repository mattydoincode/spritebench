import { createImage } from "./pixels";
import type { RgbaImage, Size } from "./types";

export const ISO_DIAMOND_TEMPLATE_ID = "builtin:iso-diamond";
export const ISO_DIAMOND_TEMPLATE_NAME = "2:1 iso diamond";
export const ISO_DIAMOND_SIZE: Size = { width: 256, height: 128 };

export function isIsoDiamondTemplate(id: string): boolean {
  return id === ISO_DIAMOND_TEMPLATE_ID;
}

export function isoDiamondTemplateInfo(): {
  id: string;
  name: string;
  width: number;
  height: number;
} {
  return {
    id: ISO_DIAMOND_TEMPLATE_ID,
    name: ISO_DIAMOND_TEMPLATE_NAME,
    width: ISO_DIAMOND_SIZE.width,
    height: ISO_DIAMOND_SIZE.height
  };
}

/** Pixel centre inside the 2:1 diamond that fills `width` × `height`. */
export function pointInIsoDiamond(
  x: number,
  y: number,
  width: number,
  height: number
): boolean {
  if (width <= 0 || height <= 0) return false;

  const nx = Math.abs((x + 0.5) / width - 0.5) * 2;
  const ny = Math.abs((y + 0.5) / height - 0.5) * 2;
  return nx + ny <= 1 + 1 / Math.min(width, height);
}

/** Opaque diamond on transparent. Dark enough for keepInsideShape. */
export function buildIsoDiamondTemplate(size: Size = ISO_DIAMOND_SIZE): RgbaImage {
  const width = Math.max(2, Math.floor(size.width));
  const height = Math.max(1, Math.floor(size.height));
  const image = createImage(width, height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!pointInIsoDiamond(x, y, width, height)) continue;

      const i = (y * width + x) * 4;
      image.data[i] = 48;
      image.data[i + 1] = 58;
      image.data[i + 2] = 74;
      image.data[i + 3] = 255;
    }
  }

  return image;
}
