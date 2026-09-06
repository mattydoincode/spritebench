import { parsePaletteText, uniqueOpaqueColors } from "@/core/palette";
import type { Rgb } from "@/core/types";
import {
  deletePalette as deletePaletteRow,
  getPaletteColors,
  listPalettes as listPaletteRows,
  upsertPalette,
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
export async function loadPalette(userId: string, file: string): Promise<Rgb[]> {
  return getPaletteColors(userId, basename(file));
}

export async function listPalettes(userId: string): Promise<PaletteInfo[]> {
  return listPaletteRows(userId);
}

export async function savePalette(
  userId: string,
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

  const filename = `${stem.length > 0 ? stem : "palette"}${extension}`;

  const colors = parsePalette(filename, bytes);
  if (colors.length === 0) throw new Error(`no colours could be read out of ${name}`);

  await storage().put(paletteKey(filename), bytes, {
    contentType: extension === ".png" ? "image/png" : "text/plain"
  });

  return upsertPalette(userId, filename, colors);
}

export async function deletePalette(userId: string, file: string): Promise<void> {
  const key = await deletePaletteRow(userId, basename(file));
  if (key) await storage().delete(key);
}
