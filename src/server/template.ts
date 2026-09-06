import { buildMask, conformToSize } from "@/core/mask";
import { fitToAspect } from "@/core/size";
import type { Size } from "@/core/types";
import { snapRequestSize } from "@/providers/models";
import type { GenerationParams, TemplateSpec } from "@/shared/model";
import { asBytes, type Bytes } from "@/storage/types";
import { decodePng, encodePng } from "./png";
import { loadTemplate } from "./templates";

export interface EditInputs {
  /** PNG bytes, held in memory. Concurrent jobs previously overwrote each
   *  other's inputs by sharing fixed `_edit_base.png` / `_edit_mask.png` paths. */
  base: Bytes;
  mask: Bytes | null;
  size: Size;
}

export async function buildEditInputs(
  userId: string,
  template: TemplateSpec,
  generation: GenerationParams
): Promise<EditInputs> {
  const bytes = await loadTemplate(userId, template.file);
  if (!bytes) throw new Error(`template not found: ${template.file}`);

  const decoded = decodePng(Buffer.from(bytes));

  const budget = snapRequestSize(generation.size, generation.model);
  const requested = template.matchAspect
    ? fitToAspect({ width: decoded.width, height: decoded.height }, budget)
    : budget;

  const size = snapRequestSize(requested, generation.model);
  const base = conformToSize(decoded, size, template.fit, true);

  if (!template.useAsMask) {
    return { base: asBytes(encodePng(base)), mask: null, size };
  }

  const mask = buildMask(
    decoded,
    size,
    template.maskSource,
    0.5,
    0.85,
    template.dilatePixels,
    template.fit
  );

  if (mask.width !== base.width || mask.height !== base.height) {
    throw new Error(
      `mask ${mask.width}x${mask.height} does not match base ${base.width}x${base.height}`
    );
  }

  return { base: asBytes(encodePng(base)), mask: asBytes(encodePng(mask)), size };
}
