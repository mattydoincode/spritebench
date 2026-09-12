import { cropImage } from "@/core/edits";
import { buildMask, conformToSize } from "@/core/mask";
import {
  DEFAULT_PIXEL_WINDOW,
  buildPixelConstraintMask,
  buildPixelConstraintTemplate,
  isPixelConstraintTemplate
} from "@/core/pixelMask";
import { createImage } from "@/core/pixels";
import { fitToAspect } from "@/core/size";
import { buildSheetMask } from "@/core/slice";
import type { RgbaImage, Size } from "@/core/types";
import { getAssetRow } from "@/db/repo/assets";
import { snapRequestSize } from "@/providers/models";
import {
  isChunkSpec,
  jobUsesEdit,
  type GenerationParams,
  type ImageSource,
  type JobInputs,
  type SequencePlan
} from "@/shared/model";
import { storage } from "@/storage";
import { asBytes, type Bytes } from "@/storage/types";
import { decodePng, encodePng } from "./png";
import { loadTemplate } from "./templates";

export { jobUsesEdit };

export interface EditInputs {
  /** PNG bytes, held in memory. Concurrent jobs previously overwrote each
   *  other's inputs by sharing fixed `_edit_base.png` / `_edit_mask.png` paths. */
  base: Bytes;
  mask: Bytes | null;
  /** Checkerboard plate when a starting image is also present. */
  plate?: Bytes | null;
  size: Size;
}

export async function loadImageSource(projectId: string, source: ImageSource): Promise<Bytes> {
  if (source.kind === "template") {
    const bytes = await loadTemplate(projectId, source.templateId);
    if (!bytes) throw new Error(`template not found: ${source.templateId}`);
    return bytes;
  }

  const row = await getAssetRow(projectId, source.assetId);
  if (!row?.sourceKey) throw new Error(`asset not found: ${source.assetId}`);

  const bytes = await storage().get(row.sourceKey);
  if (!bytes) throw new Error(`asset source missing: ${source.assetId}`);
  return bytes;
}

/**
 * Fit a loaded base (already cropped, if this is a chunk) and optional mask
 * onto the request size. Mask-only stills reuse the mask image as the base
 * so the sketch is still visible to the model.
 */
export function buildEditFromImages(
  baseImage: RgbaImage | null,
  maskImage: RgbaImage | null,
  inputs: JobInputs,
  generation: GenerationParams
): EditInputs {
  const source = baseImage ?? maskImage;
  if (!source) throw new Error("edit needs a base or a mask");

  const fit = inputs.base?.fit ?? inputs.mask?.fit ?? "contain";
  const matchAspect = inputs.base?.matchAspect ?? true;
  const budget = snapRequestSize(generation.size, generation.model);
  const requested = matchAspect
    ? fitToAspect({ width: source.width, height: source.height }, budget)
    : budget;
  const size = snapRequestSize(requested, generation.model);
  const base = conformToSize(source, size, fit, true);

  if (!inputs.mask || !maskImage) {
    return { base: asBytes(encodePng(base)), mask: null, size };
  }

  const mask = buildMask(
    maskImage,
    size,
    inputs.mask.maskSource,
    0.5,
    0.85,
    inputs.mask.dilatePixels,
    inputs.mask.fit
  );

  if (mask.width !== base.width || mask.height !== base.height) {
    throw new Error(
      `mask ${mask.width}x${mask.height} does not match base ${base.width}x${base.height}`
    );
  }

  return { base: asBytes(encodePng(base)), mask: asBytes(encodePng(mask)), size };
}

export async function editInputsForJob(
  projectId: string,
  job: {
    inputs?: JobInputs | null;
    sequencePlan?: SequencePlan | null;
    generation: GenerationParams;
  }
): Promise<EditInputs | null> {
  const plan = job.sequencePlan;
  if (plan?.actions?.length) {
    const size = snapRequestSize(job.generation.size, job.generation.model);
    const base = createImage(size.width, size.height);
    const mask = buildSheetMask(size, plan.columns, plan.rows, plan.actions);
    return {
      base: asBytes(encodePng(base)),
      mask: asBytes(encodePng(mask)),
      size
    };
  }

  const inputs = job.inputs;
  if (!inputs?.base && !inputs?.mask) return null;

  let baseImage: RgbaImage | null = null;
  if (inputs.base) {
    baseImage = decodePng(Buffer.from(await loadImageSource(projectId, inputs.base.source)));
    if (isChunkSpec(inputs.chunk)) {
      baseImage = cropImage(baseImage, { kind: "crop", ...inputs.chunk.rect });
    }
  }

  const pixelConstraint =
    inputs.mask?.source.kind === "template" && isPixelConstraintTemplate(inputs.mask.source.templateId);

  if (pixelConstraint && inputs.mask) {
    const budget = snapRequestSize(job.generation.size, job.generation.model);
    const requested =
      baseImage && (inputs.base?.matchAspect ?? true)
        ? fitToAspect({ width: baseImage.width, height: baseImage.height }, budget)
        : budget;
    const size = snapRequestSize(requested, job.generation.model);
    const cells = inputs.mask.window ?? DEFAULT_PIXEL_WINDOW;
    const plate = buildPixelConstraintTemplate(size, cells);
    // Plate alone is the base. A starting image (loop / reference) stays the
    // base; the checkerboard goes out as its own attachment so Gemini does
    // not flatten the character into a white hole.
    if (!baseImage) {
      return { base: asBytes(encodePng(plate)), mask: null, size };
    }

    const base = conformToSize(baseImage, size, inputs.base?.fit ?? "contain", true);
    return {
      base: asBytes(encodePng(base)),
      mask: asBytes(encodePng(buildPixelConstraintMask(size, cells))),
      plate: asBytes(encodePng(plate)),
      size
    };
  }

  const maskImage = inputs.mask
    ? decodePng(Buffer.from(await loadImageSource(projectId, inputs.mask.source)))
    : null;

  if (!baseImage && maskImage) baseImage = maskImage;

  return buildEditFromImages(baseImage, maskImage, inputs, job.generation);
}
