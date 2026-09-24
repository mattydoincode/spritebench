import {
  DEFAULT_ISO_PROJECTION,
  isoDiamondSize,
  type IsoProjection
} from "./iso";
import { createImage } from "./pixels";
import type { RgbaImage, Size } from "./types";

export const ISO_DIAMOND_TEMPLATE_ID = "builtin:iso-diamond";
export const ISO_DIAMOND_TEMPLATE_NAME = "isometric diamond";
export const ISO_DIAMOND_SIZE: Size = isoDiamondSize("true");

export const ISO_21_TEMPLATE_ID = "builtin:iso-diamond-21";
export const ISO_21_TEMPLATE_NAME = "2:1 diamond";
export const ISO_21_SIZE: Size = isoDiamondSize("dimetric");

export function isoProjectionForTemplate(id: string): IsoProjection | null {
  if (id === ISO_DIAMOND_TEMPLATE_ID) return "true";
  if (id === ISO_21_TEMPLATE_ID) return "dimetric";
  return null;
}

export function isIsoDiamondTemplate(id: string): boolean {
  return isoProjectionForTemplate(id) !== null;
}

export function isoProjectionFromSource(
  source: { kind: string; templateId?: string } | null | undefined
): IsoProjection {
  if (source?.kind !== "template" || !source.templateId) return DEFAULT_ISO_PROJECTION;
  return isoProjectionForTemplate(source.templateId) ?? DEFAULT_ISO_PROJECTION;
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

export function iso21TemplateInfo(): {
  id: string;
  name: string;
  width: number;
  height: number;
} {
  return {
    id: ISO_21_TEMPLATE_ID,
    name: ISO_21_TEMPLATE_NAME,
    width: ISO_21_SIZE.width,
    height: ISO_21_SIZE.height
  };
}

export function isoTemplateSize(id: string): Size {
  return isoProjectionForTemplate(id) === "dimetric" ? ISO_21_SIZE : ISO_DIAMOND_SIZE;
}

/** Pixel centre inside the diamond that fills `width` × `height`. */
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

/** Clear pixels outside the diamond that fills the frame. Size is unchanged. */
export function clipToIsoDiamond(image: RgbaImage): RgbaImage {
  const next = { ...image, data: new Uint8ClampedArray(image.data) };

  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      if (pointInIsoDiamond(x, y, image.width, image.height)) continue;
      next.data[(y * image.width + x) * 4 + 3] = 0;
    }
  }

  return next;
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
