import type { SequencePlan } from "@/shared/model";
import { buildSheetFramesTemplate, isSheetFramesTemplate } from "./frameMask";
import { buildIsoDiamondTemplate, isIsoDiamondTemplate, isoTemplateSize } from "./isoMask";
import {
  buildPixelConstraintTemplate,
  buildSheetPixelConstraintTemplate,
  isPixelConstraintTemplate,
  pixelConstraintWindow,
  samplePixelConstraintGrid
} from "./pixelMask";
import type { ImageEdit, PixelGridEdit } from "./edits";
import type { RgbaImage, Size } from "./types";

export function pixelGridEdit(edits: ImageEdit[]): PixelGridEdit | null {
  return edits.find((entry): entry is PixelGridEdit => entry.kind === "pixelGrid") ?? null;
}

function stillPixelPlate(
  job: {
    mask?: { source: { kind: string; templateId?: string }; window?: Size } | null;
    edits: ImageEdit[];
    sourceSize: Size;
    targetSize: Size;
  },
  grid: PixelGridEdit | null
): RgbaImage {
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

export function layoutPlateForJob(job: {
  mask?: { source: { kind: string; templateId?: string }; window?: Size } | null;
  edits: ImageEdit[];
  sourceSize: Size;
  targetSize: Size;
  sequencePlan?: SequencePlan | null;
}): RgbaImage | null {
  const grid = pixelGridEdit(job.edits);
  const templateId = job.mask?.source.kind === "template" ? job.mask.source.templateId : null;
  const pixel = Boolean(grid || (templateId && isPixelConstraintTemplate(templateId)));
  const plan = job.sequencePlan?.actions?.length ? job.sequencePlan : null;

  if (pixel && plan) {
    const cells = pixelConstraintWindow(plan.plate?.sprite ?? job.mask?.window ?? job.targetSize);
    const canvas =
      job.sourceSize.width > 0 && job.sourceSize.height > 0
        ? job.sourceSize
        : (plan.plate?.canvas ?? { width: 1024, height: 1024 });
    return buildSheetPixelConstraintTemplate(canvas, cells, plan);
  }

  if (pixel) return stillPixelPlate(job, grid);

  if (templateId && isSheetFramesTemplate(templateId) && plan) {
    const canvas =
      job.sourceSize.width > 0 && job.sourceSize.height > 0
        ? job.sourceSize
        : (plan.plate?.canvas ?? { width: 1024, height: 1024 });
    return buildSheetFramesTemplate(canvas, plan);
  }

  if (templateId && isIsoDiamondTemplate(templateId)) {
    return buildIsoDiamondTemplate(isoTemplateSize(templateId));
  }

  return null;
}

/** Source overlay is the plate the model saw. Processed overlay is cell-sampled. */
export function overlayPlateForView(
  plate: RgbaImage,
  edits: ImageEdit[],
  view: "source" | "processed",
  sequencePlan?: SequencePlan | null
): RgbaImage {
  if (view === "source") return plate;
  const grid = pixelGridEdit(edits);
  if (!grid) return plate;
  if (sequencePlan?.actions?.length) {
    return samplePixelConstraintGrid(stillPixelPlate({
      mask: null,
      edits,
      sourceSize: plate,
      targetSize: { width: grid.columns, height: grid.rows }
    }, grid), grid);
  }
  return samplePixelConstraintGrid(plate, grid);
}
