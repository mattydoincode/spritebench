import fs from "node:fs";
import path from "node:path";
import { buildMask, conformToSize } from "@/core/mask";
import { fitToAspect, snapRequestSize } from "@/core/size";
import type { Size } from "@/core/types";
import type { GenerationParams, TemplateSpec } from "@/shared/model";
import { paths } from "./paths";
import { decodePng, encodePng } from "./png";

export interface EditInputs {
  basePath: string;
  maskPath: string | null;
  size: Size;
}

export function templatePath(file: string): string {
  return path.join(paths.templates, path.basename(file));
}

export async function buildEditInputs(
  template: TemplateSpec,
  generation: GenerationParams
): Promise<EditInputs> {
  const source = templatePath(template.file);
  if (!fs.existsSync(source)) throw new Error(`template not found: ${template.file}`);

  const decoded = decodePng(fs.readFileSync(source));

  const budget = snapRequestSize(generation.size, generation.model);
  const requested = template.matchAspect
    ? fitToAspect({ width: decoded.width, height: decoded.height }, budget)
    : budget;

  const size = snapRequestSize(requested, generation.model);

  const base = conformToSize(decoded, size, template.fit, true);
  const basePath = path.join(paths.templates, "_edit_base.png");
  fs.writeFileSync(basePath, encodePng(base));

  let maskPath: string | null = null;
  if (template.useAsMask) {
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

    maskPath = path.join(paths.templates, "_edit_mask.png");
    fs.writeFileSync(maskPath, encodePng(mask));
  }

  return { basePath, maskPath, size };
}
