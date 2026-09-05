import {
  cut,
  despeckle,
  erodeAlpha,
  snapAlpha as applySnapAlpha,
  transparentBorderFraction,
  trimToContent
} from "./cutout";
import { applyEdits, describeEdits } from "./edits";
import { applyOrientation, describeOrientation, hasOrientationWork } from "./orientation";
import { quantize } from "./palette";
import { hexToRgb } from "./pixels";
import { resize, resolveTargetSize } from "./resample";
import type { ProcessingSettings } from "./settings";
import type { Rgb, RgbaImage } from "./types";

export interface PipelineResult {
  image: RgbaImage;
  description: string;
}

export function applyPipeline(
  source: RgbaImage,
  settings: ProcessingSettings,
  palette: Rgb[] = []
): PipelineResult {
  const steps: string[] = [];
  let working = source;

  const edits = settings.edits ?? [];
  if (edits.length > 0) {
    working = applyEdits(working, edits);
    steps.push(describeEdits(edits));
  }

  if (hasOrientationWork(settings.orientation, settings.flipHorizontal, settings.flipVertical)) {
    working = applyOrientation(
      working,
      settings.orientation,
      settings.flipHorizontal,
      settings.flipVertical
    );
    steps.push(
      describeOrientation(settings.orientation, settings.flipHorizontal, settings.flipVertical)
    );
  }

  if (settings.cutout !== "none") {
    const clearFraction =
      settings.cutout === "edgeFloodFill"
        ? transparentBorderFraction(working, settings.alphaThreshold)
        : 0;

    if (
      settings.cutout === "edgeFloodFill" &&
      clearFraction >= settings.skipCutoutTransparentBorder
    ) {
      steps.push(
        `cutout skipped, border is ${Math.round(clearFraction * 100)}% transparent already`
      );
    } else {
      working = cut(
        working,
        settings.cutout,
        hexToRgb(settings.chromaKey),
        settings.cutoutTolerance,
        settings.cutoutLocalTolerance,
        settings.cutoutLuminanceThreshold,
        settings.sampleCornersOnly
      );
      steps.push(settings.cutout);
    }
  }

  if (settings.despeckleMinimumNeighbors > 0 || settings.fillHoles) {
    working = despeckle(
      working,
      settings.despeckleMinimumNeighbors,
      settings.fillHoles,
      settings.alphaThreshold
    );
    steps.push(settings.fillHoles ? "despeckle + fill holes" : "despeckle");
  }

  if (settings.erodePixels > 0) {
    working = erodeAlpha(working, settings.erodePixels, settings.alphaThreshold);
    steps.push(`erode ${settings.erodePixels}px`);
  }

  if (settings.trimToContent) {
    const before = `${working.width}x${working.height}`;
    working = trimToContent(working, settings.alphaThreshold, settings.trimPadding);
    steps.push(`trim ${before} to ${working.width}x${working.height}`);
  }

  const target = resolveTargetSize(
    { width: working.width, height: working.height },
    settings.targetSize
  );

  if (target.width > 0 && target.height > 0) {
    if (target.width !== working.width || target.height !== working.height) {
      working = resize(working, target, settings.pixelate, settings.alphaThreshold);
      steps.push(`${working.width}x${working.height} ${settings.pixelate}`);
    }
  }

  if (settings.snapAlpha) {
    working = applySnapAlpha(working, settings.alphaThreshold);
    steps.push("snap alpha");
  }

  if (palette.length > 0) {
    working = quantize(
      working,
      palette,
      settings.distanceMode,
      settings.dither,
      settings.ditherStrength,
      settings.alphaThreshold
    );
    const ditherLabel = settings.dither === "none" ? "" : ` + ${settings.dither}`;
    steps.push(`palette ${palette.length} colors${ditherLabel}`);
  }

  return {
    image: working === source ? { ...source, data: new Uint8ClampedArray(source.data) } : working,
    description: steps.filter((step) => step.length > 0).join(" \u00b7 ")
  };
}
