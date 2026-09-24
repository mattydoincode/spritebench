import { normalizeEdits, type ImageEdit } from "./edits";
import { scaleRect } from "./slice";
import type {
  ColorDistanceMode,
  CutoutMode,
  DitherMode,
  ImageOrientation,
  PixelateMode,
  Rgb,
  Size
} from "./types";

export interface ProcessingSettings {
  edits: ImageEdit[];

  orientation: ImageOrientation;
  flipHorizontal: boolean;
  flipVertical: boolean;

  cutout: CutoutMode;
  chromaKeys: string[];
  cutoutTolerance: number;
  cutoutLocalTolerance: number;
  cutoutLuminanceThreshold: number;
  skipCutoutTransparentBorder: number;
  sampleCornersOnly: boolean;

  despeckleMinimumNeighbors: number;
  fillHoles: boolean;
  erodePixels: number;
  /**
   * Punch through pixels outside the diamond that fills the frame.
   * Canvas size stays the source size. Wins over `trimToContent`.
   */
  clipToIso: boolean;
  trimToContent: boolean;
  trimPadding: number;

  /** When false, `targetSize` is kept as a parked value and not applied. */
  downsample: boolean;
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

export const MAX_CHROMA_KEYS = 16;

export const DEFAULT_PROCESSING: ProcessingSettings = {
  edits: [],

  orientation: "none",
  flipHorizontal: false,
  flipVertical: false,

  cutout: "edgeFloodFill",
  chromaKeys: ["#ff00ff"],
  cutoutTolerance: 0.18,
  cutoutLocalTolerance: 0.08,
  cutoutLuminanceThreshold: 0.85,
  skipCutoutTransparentBorder: 0.5,
  sampleCornersOnly: false,

  despeckleMinimumNeighbors: 0,
  fillHoles: false,
  erodePixels: 0,
  clipToIso: false,
  trimToContent: true,
  trimPadding: 0,

  downsample: false,
  // Parked pixel-art size. Applied only when `downsample` is on.
  targetSize: { width: 32, height: 32 },
  pixelate: "dominantColor",

  snapAlpha: true,
  alphaThreshold: 0.5,

  paletteId: "",
  dither: "none",
  ditherStrength: 1,
  distanceMode: "oklab"
};

export function withDefaults(partial?: Partial<ProcessingSettings> | null): ProcessingSettings {
  const from = partial ?? {};
  const merged = { ...DEFAULT_PROCESSING, ...from };
  merged.edits = normalizeEdits(merged.edits);
  merged.chromaKeys = normalizeChromaKeys(from.chromaKeys);
  const size = from.targetSize ?? DEFAULT_PROCESSING.targetSize;
  merged.targetSize = {
    width: Math.max(0, Math.floor(size?.width ?? 0)),
    height: Math.max(0, Math.floor(size?.height ?? 0))
  };
  if (!("downsample" in from) && from.targetSize) {
    merged.downsample = merged.targetSize.width > 0 || merged.targetSize.height > 0;
  }
  return merged;
}

function normalizeChromaKeys(value: unknown): string[] {
  if (!Array.isArray(value)) return [...DEFAULT_PROCESSING.chromaKeys];
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .slice(0, MAX_CHROMA_KEYS);
}

export function effectiveTargetSize(settings: Pick<ProcessingSettings, "downsample" | "targetSize">): Size {
  return settings.downsample ? settings.targetSize : { width: 0, height: 0 };
}

/** Clip owns the frame. Trim after it would crop the diamond's transparent corners. */
export function trimsToContent(settings: Pick<ProcessingSettings, "clipToIso" | "trimToContent">): boolean {
  return settings.trimToContent && !settings.clipToIso;
}

/**
 * Maps source-space processing onto a differently sized image.
 *
 * Crops, erode, and trim padding are stored against the raw source. The
 * library runs the same pipeline over a 256-pixel thumbnail; without this
 * those rectangles land off the edge (blank thumb) and a 2px erode eats a
 * much larger fraction of the sprite.
 *
 * Pixel-grid edits keep their stored canvas size: the sampler already maps
 * that onto whatever image it is given.
 */
export function scaleProcessing(
  settings: ProcessingSettings,
  from: Size,
  to: Size
): ProcessingSettings {
  if (from.width === to.width && from.height === to.height) return settings;
  if (from.width <= 0 || from.height <= 0 || to.width <= 0 || to.height <= 0) {
    return settings;
  }

  const scale = Math.min(to.width / from.width, to.height / from.height);

  return {
    ...settings,
    edits: settings.edits.map((edit) =>
      edit.kind === "crop" ? { kind: "crop", ...scaleRect(edit, from, to) } : edit
    ),
    erodePixels: settings.erodePixels * scale,
    trimPadding: Math.round(settings.trimPadding * scale)
  };
}

function fnv1a(text: string): string {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
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

  return fnv1a(ordered);
}

export function hashPalette(palette: ReadonlyArray<Rgb>): string {
  return fnv1a(palette.map((color) => `${color.r},${color.g},${color.b}`).join("|"));
}
