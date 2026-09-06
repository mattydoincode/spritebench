import { describeEdits } from "./edits";
import { describeOrientation, hasOrientationWork } from "./orientation";
import { resolveTargetSize } from "./resample";
import type { ProcessingSettings } from "./settings";
import type { Rgb, Size } from "./types";

/**
 * Describes what the pipeline will do, without touching a single pixel.
 *
 * The worker only needs this label, and running the full pipeline to get it
 * meant a complete flood-fill, despeckle, resize and quantize pass over a
 * 1024x1024 image whose output was then thrown away.
 *
 * Two stages are genuinely pixel-dependent and are described conditionally
 * rather than guessed at:
 *  - `edgeFloodFill` may skip itself if the border is already transparent
 *  - `trimToContent` cannot know the content bounds up front
 */
export function describeSettings(
  settings: ProcessingSettings,
  source: Size,
  palette: Rgb[] = []
): string {
  const steps: string[] = [];

  const edits = settings.edits ?? [];
  if (edits.length > 0) steps.push(describeEdits(edits));

  if (hasOrientationWork(settings.orientation, settings.flipHorizontal, settings.flipVertical)) {
    steps.push(
      describeOrientation(settings.orientation, settings.flipHorizontal, settings.flipVertical)
    );
  }

  if (settings.cutout !== "none") steps.push(settings.cutout);

  if (settings.despeckleMinimumNeighbors > 0 || settings.fillHoles) {
    steps.push(settings.fillHoles ? "despeckle + fill holes" : "despeckle");
  }

  if (settings.erodePixels > 0) steps.push(`erode ${settings.erodePixels}px`);
  if (settings.trimToContent) steps.push("trim to content");

  // Compared against the post-rotation size, not the original: a quarter turn
  // swaps the edges without the pipeline resizing anything.
  const turned = afterOrientation(settings, source);
  const target = resolveTargetSize(turned, settings.targetSize);

  if (
    target.width > 0 &&
    target.height > 0 &&
    (target.width !== turned.width || target.height !== turned.height)
  ) {
    steps.push(`${target.width}x${target.height} ${settings.pixelate}`);
  }

  if (settings.snapAlpha) steps.push("snap alpha");

  if (palette.length > 0) {
    const ditherLabel = settings.dither === "none" ? "" : ` + ${settings.dither}`;
    steps.push(`palette ${palette.length} colors${ditherLabel}`);
  }

  return steps.filter((step) => step.length > 0).join(" \u00b7 ");
}

function afterOrientation(settings: ProcessingSettings, source: Size): Size {
  return settings.orientation === "rotate90cw" || settings.orientation === "rotate90ccw"
    ? { width: source.height, height: source.width }
    : { width: source.width, height: source.height };
}

/**
 * The size the pipeline will produce, ignoring trimming and cropping, which
 * depend on the image contents.
 */
export function expectedSize(settings: ProcessingSettings, source: Size): Size {
  const turned = afterOrientation(settings, source);
  const target = resolveTargetSize(turned, settings.targetSize);

  return target.width > 0 && target.height > 0 ? target : turned;
}
