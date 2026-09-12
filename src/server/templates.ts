import crypto from "node:crypto";
import { cut } from "@/core/cutout";
import {
  buildIsoDiamondTemplate,
  isIsoDiamondTemplate,
  isoDiamondTemplateInfo
} from "@/core/isoMask";
import {
  PIXEL_CONSTRAINT_PREVIEW_SIZE,
  buildPixelConstraintTemplate,
  isPixelConstraintTemplate,
  pixelConstraintTemplateInfo
} from "@/core/pixelMask";
import { hexToRgb } from "@/core/pixels";
import {
  deleteTemplate as deleteTemplateRow,
  getTemplate,
  insertTemplate,
  listTemplates as listTemplateRows,
  type TemplateInfo
} from "@/db/repo/templates";
import { templateKey } from "@/storage/keys";
import { storage } from "@/storage";
import { asBytes, type Bytes } from "@/storage/types";
import { decodePng, encodePng } from "./png";

export type { TemplateInfo };

export function isBuiltinTemplate(id: string): boolean {
  return isIsoDiamondTemplate(id) || isPixelConstraintTemplate(id);
}

export async function listTemplates(projectId: string): Promise<TemplateInfo[]> {
  return [isoDiamondTemplateInfo(), pixelConstraintTemplateInfo(), ...(await listTemplateRows(projectId))];
}

export async function loadTemplate(
  projectId: string,
  templateId: string
): Promise<Bytes | null> {
  if (isIsoDiamondTemplate(templateId)) {
    return asBytes(encodePng(buildIsoDiamondTemplate()));
  }

  if (isPixelConstraintTemplate(templateId)) {
    return asBytes(encodePng(buildPixelConstraintTemplate(PIXEL_CONSTRAINT_PREVIEW_SIZE)));
  }

  const row = await getTemplate(projectId, templateId);
  if (!row) return null;

  return storage()
    .get(row.storageKey)
    .catch(() => null);
}

/**
 * Stores a template under a fresh id.
 *
 * Never an upsert on the name: the name is a label, so two people uploading
 * `hero.png` get two templates instead of the second silently replacing the
 * first -- which, when the bucket key was name-derived, also meant replacing
 * bytes another project was still pointing at.
 */
export async function saveTemplate(
  projectId: string,
  name: string,
  bytes: Uint8Array,
  cutBackground: boolean,
  cutTolerance: number
): Promise<TemplateInfo> {
  let decoded = decodePng(Buffer.from(bytes));

  if (cutBackground) {
    decoded = cut(
      decoded,
      "edgeFloodFill",
      hexToRgb("#ffffff"),
      cutTolerance,
      cutTolerance,
      0.85,
      false
    );
  }

  const id = crypto.randomUUID();

  await storage().put(templateKey(projectId, id), encodePng(decoded), {
    contentType: "image/png"
  });

  return insertTemplate(projectId, id, name, decoded.width, decoded.height);
}

export async function deleteTemplate(projectId: string, templateId: string): Promise<void> {
  if (isBuiltinTemplate(templateId)) return;

  const key = await deleteTemplateRow(projectId, templateId);
  if (key) await storage().delete(key);
}
