import { copyRegion, createImage, luminance, toByte } from "./pixels";
import { resize } from "./resample";
import type { MaskSource, RgbaImage, Size, TemplateFitMode } from "./types";

export function conformToSize(
  source: RgbaImage,
  size: Size,
  fit: TemplateFitMode,
  smooth: boolean
): RgbaImage {
  const width = Math.max(1, Math.floor(size.width));
  const height = Math.max(1, Math.floor(size.height));
  const mode = smooth ? "bilinear" : "nearest";

  if (fit === "stretch") {
    return resize(source, { width, height }, mode, 0.5);
  }

  const scale =
    fit === "cover"
      ? Math.max(width / source.width, height / source.height)
      : Math.min(width / source.width, height / source.height);

  const scaledWidth = Math.max(1, Math.round(source.width * scale));
  const scaledHeight = Math.max(1, Math.round(source.height * scale));
  const scaled = resize(source, { width: scaledWidth, height: scaledHeight }, mode, 0.5);

  const canvas = createImage(width, height);
  const offsetX = Math.round((width - scaledWidth) / 2);
  const offsetY = Math.round((height - scaledHeight) / 2);

  copyRegion(
    scaled,
    canvas,
    Math.max(0, -offsetX),
    Math.max(0, -offsetY),
    Math.min(scaledWidth, width),
    Math.min(scaledHeight, height),
    Math.max(0, offsetX),
    Math.max(0, offsetY)
  );

  return canvas;
}

export function buildAlphaVisualization(source: RgbaImage): RgbaImage {
  const out = createImage(source.width, source.height);
  const count = source.width * source.height;

  for (let pixel = 0; pixel < count; pixel++) {
    const i = pixel * 4;
    const alpha = source.data[i + 3];
    out.data[i] = alpha;
    out.data[i + 1] = alpha;
    out.data[i + 2] = alpha;
    out.data[i + 3] = 255;
  }

  return out;
}

export function buildShapeFlags(
  template: RgbaImage,
  alphaThreshold: number,
  luminanceThreshold: number
): boolean[] {
  const { width, height, data } = template;
  const cutoff = toByte(alphaThreshold);
  const ink = new Array<boolean>(width * height).fill(false);

  for (let pixel = 0; pixel < width * height; pixel++) {
    const i = pixel * 4;
    const opaque = data[i + 3] >= cutoff;
    const dark = luminance(data[i], data[i + 1], data[i + 2]) < luminanceThreshold;
    ink[pixel] = opaque && dark;
  }

  const reached = new Uint8Array(width * height);
  const stack: number[] = [];

  const push = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const pixel = y * width + x;
    if (reached[pixel] || ink[pixel]) return;
    reached[pixel] = 1;
    stack.push(pixel);
  };

  for (let x = 0; x < width; x++) {
    push(x, 0);
    push(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    push(0, y);
    push(width - 1, y);
  }

  while (stack.length > 0) {
    const pixel = stack.pop() as number;
    const x = pixel % width;
    const y = (pixel - x) / width;

    push(x + 1, y);
    push(x - 1, y);
    push(x, y + 1);
    push(x, y - 1);
  }

  const shape = new Array<boolean>(width * height);
  for (let pixel = 0; pixel < shape.length; pixel++) {
    shape[pixel] = ink[pixel] || reached[pixel] === 0;
  }

  return shape;
}

function dilate(flags: boolean[], width: number, height: number, passes: number): boolean[] {
  let current = flags;

  for (let pass = 0; pass < passes; pass++) {
    const next = [...current];

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const pixel = y * width + x;
        if (current[pixel]) continue;

        const neighbours = [
          x > 0 ? current[pixel - 1] : false,
          x < width - 1 ? current[pixel + 1] : false,
          y > 0 ? current[pixel - width] : false,
          y < height - 1 ? current[pixel + width] : false
        ];

        if (neighbours.some(Boolean)) next[pixel] = true;
      }
    }

    current = next;
  }

  return current;
}

export function buildMask(
  template: RgbaImage,
  size: Size,
  source: MaskSource,
  alphaThreshold: number,
  luminanceThreshold: number,
  dilateEditablePixels: number,
  fit: TemplateFitMode
): RgbaImage {
  const conformed = conformToSize(template, size, fit, false);
  const { width, height, data } = conformed;
  const cutoff = toByte(alphaThreshold);

  let editable = new Array<boolean>(width * height).fill(false);
  const shape =
    source === "keepInsideShape" || source === "keepOutsideShape"
      ? buildShapeFlags(conformed, alphaThreshold, luminanceThreshold)
      : null;

  for (let pixel = 0; pixel < editable.length; pixel++) {
    const i = pixel * 4;
    const opaque = data[i + 3] >= cutoff;
    const lum = luminance(data[i], data[i + 1], data[i + 2]);

    switch (source) {
      case "alphaFromTemplate":
        editable[pixel] = !opaque;
        break;
      case "transparentWhereDark":
        editable[pixel] = opaque && lum < luminanceThreshold;
        break;
      case "transparentWhereLight":
        editable[pixel] = !opaque || lum >= luminanceThreshold;
        break;
      case "keepInsideShape":
        editable[pixel] = shape![pixel];
        break;
      case "keepOutsideShape":
        editable[pixel] = !shape![pixel];
        break;
    }
  }

  const passes = Math.max(0, Math.floor(dilateEditablePixels));
  if (passes > 0) editable = dilate(editable, width, height, passes);

  const mask = createImage(width, height);
  for (let pixel = 0; pixel < editable.length; pixel++) {
    mask.data[pixel * 4 + 3] = editable[pixel] ? 0 : 255;
  }

  return mask;
}
