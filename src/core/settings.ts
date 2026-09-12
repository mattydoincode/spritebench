import { normalizeEdits, type ImageEdit } from "./edits";
import type {
  ColorDistanceMode,
  CutoutMode,
  DitherMode,
  ImageOrientation,
  PixelateMode,
  Size
} from "./types";

export interface ProcessingSettings {
  edits: ImageEdit[];

  orientation: ImageOrientation;
  flipHorizontal: boolean;
  flipVertical: boolean;

  cutout: CutoutMode;
  chromaKey: string;
  cutoutTolerance: number;
  cutoutLocalTolerance: number;
  cutoutLuminanceThreshold: number;
  skipCutoutTransparentBorder: number;
  sampleCornersOnly: boolean;

  despeckleMinimumNeighbors: number;
  fillHoles: boolean;
  erodePixels: number;
  trimToContent: boolean;
  trimPadding: number;

  targetSize: Size;
  pixelate: PixelateMode;

  snapAlpha: boolean;
  alphaThreshold: number;

  /** A `palettes.id`, or "" for no palette. */
  paletteId: string;
  dither: DitherMode;
  ditherStrength: number;
  distanceMode: ColorDistanceMode;
}

export const DEFAULT_PROCESSING: ProcessingSettings = {
  edits: [],

  orientation: "none",
  flipHorizontal: false,
  flipVertical: false,

  cutout: "edgeFloodFill",
  chromaKey: "#ff00ff",
  cutoutTolerance: 0.18,
  cutoutLocalTolerance: 0.08,
  cutoutLuminanceThreshold: 0.85,
  skipCutoutTransparentBorder: 0.5,
  sampleCornersOnly: false,

  despeckleMinimumNeighbors: 0,
  fillHoles: false,
  erodePixels: 0,
  trimToContent: true,
  trimPadding: 0,

  // Both zero means "keep whatever came back". A height of 64 used to be the
  // default, which quietly downsampled every new asset before anyone asked.
  targetSize: { width: 0, height: 0 },
  pixelate: "dominantColor",

  snapAlpha: true,
  alphaThreshold: 0.5,

  paletteId: "",
  dither: "none",
  ditherStrength: 1,
  distanceMode: "oklab"
};

export function withDefaults(partial?: Partial<ProcessingSettings> | null): ProcessingSettings {
  const merged = { ...DEFAULT_PROCESSING, ...(partial ?? {}) };
  merged.edits = normalizeEdits(merged.edits);
  merged.targetSize = {
    width: Math.max(0, Math.floor(merged.targetSize?.width ?? 0)),
    height: Math.max(0, Math.floor(merged.targetSize?.height ?? 0))
  };
  return merged;
}

export function hashSettings(settings: ProcessingSettings): string {
  const ordered = Object.keys(settings)
    .sort()
    .map((key) => {
      const value = settings[key as keyof ProcessingSettings];
      if (value && typeof value === "object") return `${key}:${JSON.stringify(value)}`;
      return `${key}:${String(value)}`;
    })
    .join("|");

  let hash = 2166136261;
  for (let i = 0; i < ordered.length; i++) {
    hash ^= ordered.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(36);
}
