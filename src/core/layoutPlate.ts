import { buildIsoDiamondTemplate, isIsoDiamondTemplate } from "./isoMask";
import {
  buildPixelConstraintTemplate,
  isPixelConstraintTemplate,
  pixelConstraintWindow,
  samplePixelConstraintGrid
} from "./pixelMask";
import type { ImageEdit, PixelGridEdit } from "./edits";
import type { RgbaImage, Size } from "./types";

export function pixelGridEdit(edits: ImageEdit[]): PixelGridEdit | null {
  return edits.find((entry): entry is PixelGridEdit => entry.kind === "pixelGrid") ?? null;
}

export function layoutPlateForJob(job: {
  mask?: { source: { kind: string; templateId?: string }; window?: Size } | null;
  edits: ImageEdit[];
  sourceSize: Size;
  targetSize: Size;
}): RgbaImage | null {
  const grid = pixelGridEdit(job.edits);
  const templateId = job.mask?.source.kind === "template" ? job.mask.source.templateId : null;

  if (grid || (templateId && isPixelConstraintTemplate(templateId))) {
    const cells = grid
      ? { width: grid.columns, height: grid.rows }
      : pixelConstraintWindow(job.mask?.window ?? job.targetSize);
    const canvas =
      grid?.canvasWidth && grid.canvasHeight
        ? { width: grid.canvasWidth, height: grid.canvasHeight }
        : job.sourceSize.width > 0 && job.sourceSize.height > 0
          ? job.sourceSize
          : { width: 1024, height: 1024 };
    return buildPixelConstraintTemplate(canvas, cells);
  }

  if (templateId && isIsoDiamondTemplate(templateId)) {
    return buildIsoDiamondTemplate();
  }

  return null;
}

/** Source overlay is the plate the model saw. Processed overlay is cell-sampled. */
export function overlayPlateForView(
  plate: RgbaImage,
  edits: ImageEdit[],
  view: "source" | "processed"
): RgbaImage {
  if (view === "source") return plate;
  const grid = pixelGridEdit(edits);
  return grid ? samplePixelConstraintGrid(plate, grid) : plate;
}
