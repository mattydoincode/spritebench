import { DEFAULT_PROCESSING, type ProcessingSettings } from "@/core/settings";
import type { CutoutMode, DitherMode, ImageOrientation } from "@/core/types";

/**
 * One-line summaries for collapsed panel sections, so a folded section still
 * says what it is set to. Empty means "nothing to say" -- the section is at
 * its plain default -- and nothing is shown.
 */

const CUTOUT_SHORT: Record<CutoutMode, string> = {
  none: "",
  edgeFloodFill: "flood fill",
  chromaKey: "chroma key",
  luminanceAbove: "clear bright",
  luminanceBelow: "clear dark"
};

const DITHER_SHORT: Record<DitherMode, string> = {
  none: "",
  bayer2x2: "bayer 2×2",
  bayer4x4: "bayer 4×4",
  bayer8x8: "bayer 8×8",
  floydSteinberg: "floyd–steinberg",
  atkinson: "atkinson"
};

const ORIENTATION_SHORT: Record<ImageOrientation, string> = {
  none: "",
  rotate90cw: "rotated 90°",
  rotate180: "rotated 180°",
  rotate90ccw: "rotated −90°"
};

function join(parts: Array<string | false | null | undefined>): string {
  return parts.filter((part): part is string => Boolean(part)).join(" · ");
}

/** "64×64", "64 wide", or empty when pixel art is off. */
export function pixelArtSummary(processing: Pick<ProcessingSettings, "downsample" | "targetSize">): string {
  if (!processing.downsample) return "";
  const { width, height } = processing.targetSize;
  if (width > 0 && height > 0) return `${width}×${height}`;
  if (width > 0) return `${width} wide`;
  if (height > 0) return `${height} tall`;
  return "";
}

export function transparencySummary(
  processing: Pick<ProcessingSettings, "cutout" | "clipToIso" | "chromaKeys">
): string {
  const method =
    processing.cutout === "chromaKey"
      ? `chroma key ×${processing.chromaKeys.length}`
      : CUTOUT_SHORT[processing.cutout];
  return join([method, processing.clipToIso && "iso clip"]);
}

export function paletteSummary(
  processing: Pick<ProcessingSettings, "paletteId" | "dither">,
  paletteName: string
): string {
  if (!processing.paletteId) return "";
  return join([paletteName, DITHER_SHORT[processing.dither]]);
}

/** What differs from the defaults: rotation, flips, and any cleanup applied. */
export function cleanupSummary(processing: ProcessingSettings): string {
  const base = DEFAULT_PROCESSING;
  return join([
    ORIENTATION_SHORT[processing.orientation],
    processing.flipHorizontal && "flip x",
    processing.flipVertical && "flip y",
    processing.despeckleMinimumNeighbors !== base.despeckleMinimumNeighbors && "despeckle",
    processing.fillHoles && "fill holes",
    processing.erodePixels > 0 && `erode ${processing.erodePixels}`,
    processing.trimPadding > 0 && `pad ${processing.trimPadding}`
  ]);
}

export function modelSummary(
  modelLabel: string,
  generation: { useAutoSize: boolean; size: { width: number; height: number } }
): string {
  return join([
    modelLabel,
    generation.useAutoSize ? "auto size" : `${generation.size.width}×${generation.size.height}`
  ]);
}

export function modesSummary(modes: {
  animation: boolean;
  itemGrid?: { columns: number; rows: number } | null;
  loopSteps?: number | null;
  chunk?: { columns: number; rows: number } | null;
  each: boolean;
}): string {
  return join([
    modes.animation && "animation",
    modes.itemGrid && `variations ${modes.itemGrid.columns}×${modes.itemGrid.rows}`,
    modes.loopSteps ? `chain ${modes.loopSteps}` : null,
    modes.chunk && `chunk ${modes.chunk.columns}×${modes.chunk.rows}`,
    modes.each && "each image"
  ]);
}

export function templateSummary(input: { images: number; mask: string | null }): string {
  return join([
    input.images === 1 ? "1 image" : input.images > 1 && `${input.images} images`,
    input.mask && `mask: ${input.mask}`
  ]);
}
