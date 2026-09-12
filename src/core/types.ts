export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8ClampedArray<ArrayBuffer>;
}

export interface Size {
  width: number;
  height: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Inset {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export type ImageOrientation = "none" | "rotate90cw" | "rotate180" | "rotate90ccw";

export type CutoutMode =
  | "none"
  | "edgeFloodFill"
  | "chromaKey"
  | "luminanceAbove"
  | "luminanceBelow";

export type PixelateMode =
  | "nearest"
  | "bilinear"
  | "bicubic"
  | "lanczos"
  | "boxAverage"
  | "dominantColor";

export type DitherMode =
  | "none"
  | "bayer2x2"
  | "bayer4x4"
  | "bayer8x8"
  | "floydSteinberg"
  | "atkinson";

export type ColorDistanceMode = "rgb" | "weightedRgb" | "oklab";

export type TemplateFitMode = "contain" | "cover" | "stretch";

export type MaskSource =
  | "alphaFromTemplate"
  | "transparentWhereDark"
  | "transparentWhereLight"
  | "keepInsideShape"
  | "keepOutsideShape";

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export const PIXELATE_MODES: PixelateMode[] = [
  "dominantColor",
  "boxAverage",
  "nearest",
  "bilinear",
  "bicubic",
  "lanczos"
];

export const CUTOUT_MODES: CutoutMode[] = [
  "none",
  "edgeFloodFill",
  "chromaKey",
  "luminanceAbove",
  "luminanceBelow"
];

export const DITHER_MODES: DitherMode[] = [
  "none",
  "bayer2x2",
  "bayer4x4",
  "bayer8x8",
  "floydSteinberg",
  "atkinson"
];

export const DISTANCE_MODES: ColorDistanceMode[] = ["oklab", "rgb", "weightedRgb"];

export const ORIENTATIONS: ImageOrientation[] = [
  "none",
  "rotate90cw",
  "rotate180",
  "rotate90ccw"
];

export const TEMPLATE_FIT_MODES: TemplateFitMode[] = ["contain", "cover", "stretch"];

export const MASK_SOURCES: MaskSource[] = [
  "alphaFromTemplate",
  "transparentWhereDark",
  "transparentWhereLight",
  "keepInsideShape",
  "keepOutsideShape"
];
