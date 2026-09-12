import crypto from "node:crypto";
import { parsePaletteText, uniqueOpaqueColors } from "@/core/palette";
import type { Rgb } from "@/core/types";
import {
  deletePalette as deletePaletteRow,
  getPaletteColors,
  insertPalette,
  listPalettes as listPaletteRows,
  type PaletteInfo
} from "@/db/repo/palettes";
import { basename, paletteKey } from "@/storage/keys";
import { storage } from "@/storage";
import { decodePng } from "./png";

export type { PaletteInfo };

const TEXT_EXTENSIONS = new Set([".hex", ".txt", ".gpl", ".pal"]);
const IMAGE_EXTENSIONS = new Set([".png"]);

function extensionOf(file: string): string {
  const name = basename(file);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot).toLowerCase() : "";
}

export function isPaletteFile(file: string): boolean {
  const extension = extensionOf(file);
  return TEXT_EXTENSIONS.has(extension) || IMAGE_EXTENSIONS.has(extension);
}

/** Parses palette bytes into colours. Pure; no storage or database access. */
export function parsePalette(filename: string, bytes: Uint8Array): Rgb[] {
  const extension = extensionOf(filename);

  if (IMAGE_EXTENSIONS.has(extension)) {
    return uniqueOpaqueColors(decodePng(Buffer.from(bytes)));
  }
  if (TEXT_EXTENSIONS.has(extension)) {
    return parsePaletteText(filename, Buffer.from(bytes).toString("utf8"));
  }

  return [];
}

/** Colours come from the database, parsed once at upload time. */
export async function loadPalette(projectId: string, paletteId: string): Promise<Rgb[]> {
  return getPaletteColors(projectId, paletteId);
}

export async function listPalettes(projectId: string): Promise<PaletteInfo[]> {
  return listPaletteRows(projectId);
}

export async function savePalette(
  projectId: string,
  name: string,
  bytes: Uint8Array
): Promise<PaletteInfo> {
  if (!isPaletteFile(name)) {
    throw new Error(`${name} is not a palette. Use .hex, .txt, .gpl, .pal, or .png.`);
  }

  const extension = extensionOf(name);
  const stem = basename(name)
    .slice(0, basename(name).length - extension.length)
    .replace(/[^a-zA-Z0-9-_ ]/g, "")
    .trim();

  const label = `${stem.length > 0 ? stem : "palette"}${extension}`;

  const colors = parsePalette(label, bytes);
  if (colors.length === 0) throw new Error(`no colours could be read out of ${name}`);

  // The id names the object, so uploading the same filename twice yields two
  // palettes rather than one silently replacing the other's bytes.
  const id = crypto.randomUUID();

  await storage().put(paletteKey(projectId, id), bytes, {
    contentType: extension === ".png" ? "image/png" : "text/plain"
  });

  return insertPalette(projectId, id, label, colors);
}

export async function deletePalette(projectId: string, paletteId: string): Promise<void> {
  const key = await deletePaletteRow(projectId, paletteId);
  if (key) await storage().delete(key);
}
