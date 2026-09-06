import { cut } from "@/core/cutout";
import { hexToRgb } from "@/core/pixels";
import {
  deleteTemplate as deleteTemplateRow,
  getTemplate,
  listTemplates as listTemplateRows,
  upsertTemplate,
  type TemplateInfo
} from "@/db/repo/templates";
import { basename, templateKey } from "@/storage/keys";
import { storage } from "@/storage";
import type { Bytes } from "@/storage/types";
import { decodePng, encodePng } from "./png";

export type { TemplateInfo };

export async function listTemplates(userId: string): Promise<TemplateInfo[]> {
  return listTemplateRows(userId);
}

export async function loadTemplate(userId: string, file: string): Promise<Bytes | null> {
  const row = await getTemplate(userId, basename(file));
  if (!row) return null;

  return storage()
    .get(row.storageKey)
    .catch(() => null);
}

export async function saveTemplate(
  userId: string,
  file: string,
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

  const filename = basename(file);
  await storage().put(templateKey(filename), encodePng(decoded), { contentType: "image/png" });

  return upsertTemplate(userId, filename, decoded.width, decoded.height);
}

export async function deleteTemplate(userId: string, file: string): Promise<void> {
  const key = await deleteTemplateRow(userId, basename(file));
  if (key) await storage().delete(key);
}
