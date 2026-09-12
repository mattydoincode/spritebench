import { createImage } from "./pixels";
import type { RgbaImage } from "./types";

/**
 * OpenAI-style mask: alpha 0 is editable, 255 is protected. Gemini cannot
 * consume that as a mask channel -- it will draw the PNG -- so this flattens
 * the pair into one opaque layout plate.
 *
 * White = empty, draw here (Imagen's old mask colour, and a paper metaphor).
 * Everything else is already finished: the base pixel if it has coverage,
 * otherwise black so unused sheet cells stay empty instead of going
 * checkerboard-grey.
 */
export function flattenEditGuide(base: RgbaImage, mask: RgbaImage): RgbaImage {
  if (base.width !== mask.width || base.height !== mask.height) {
    throw new Error(
      `guide base ${base.width}x${base.height} does not match mask ${mask.width}x${mask.height}`
    );
  }

  const { width, height } = base;
  const guide = createImage(width, height);

  for (let pixel = 0; pixel < width * height; pixel++) {
    const i = pixel * 4;
    const out = guide.data;

    if (mask.data[i + 3] < 128) {
      out[i] = 255;
      out[i + 1] = 255;
      out[i + 2] = 255;
      out[i + 3] = 255;
      continue;
    }

    if (base.data[i + 3] < 128) {
      out[i] = 0;
      out[i + 1] = 0;
      out[i + 2] = 0;
      out[i + 3] = 255;
      continue;
    }

    out[i] = base.data[i];
    out[i + 1] = base.data[i + 1];
    out[i + 2] = base.data[i + 2];
    out[i + 3] = 255;
  }

  return guide;
}
