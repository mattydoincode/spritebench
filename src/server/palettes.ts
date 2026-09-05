import fs from "node:fs";
import path from "node:path";
import { parsePaletteText, uniqueOpaqueColors } from "@/core/palette";
import type { Rgb } from "@/core/types";
import { ensureFolders, paths } from "./paths";
import { decodePng } from "./png";

const TEXT_EXTENSIONS = new Set([".hex", ".txt", ".gpl", ".pal"]);
const IMAGE_EXTENSIONS = new Set([".png"]);

export function isPaletteFile(file: string): boolean {
  const extension = path.extname(file).toLowerCase();
  return TEXT_EXTENSIONS.has(extension) || IMAGE_EXTENSIONS.has(extension);
}

export function loadPalette(file: string): Rgb[] {
  if (!file) return [];

  const full = path.join(paths.palettes, path.basename(file));
  if (!fs.existsSync(full)) return [];

  const extension = path.extname(full).toLowerCase();

  if (IMAGE_EXTENSIONS.has(extension)) {
    return uniqueOpaqueColors(decodePng(fs.readFileSync(full)));
  }

  if (TEXT_EXTENSIONS.has(extension)) {
    return parsePaletteText(full, fs.readFileSync(full, "utf8"));
  }

  return [];
}

export function savePalette(name: string, bytes: Buffer): { file: string; count: number } {
  ensureFolders();

  const extension = path.extname(name).toLowerCase();
  if (!isPaletteFile(name)) {
    throw new Error(`${name} is not a palette. Use .hex, .txt, .gpl, .pal, or .png.`);
  }

  const base = path
    .basename(name, extension)
    .replace(/[^a-zA-Z0-9-_ ]/g, "")
    .trim();

  const file = `${base.length > 0 ? base : "palette"}${extension}`;
  fs.writeFileSync(path.join(paths.palettes, file), bytes);

  const colors = loadPalette(file);
  if (colors.length === 0) {
    fs.unlinkSync(path.join(paths.palettes, file));
    throw new Error(`no colours could be read out of ${name}`);
  }

  return { file, count: colors.length };
}

export function listPalettes(): Array<{ file: string; count: number; preview: Rgb[] }> {
  ensureFolders();

  return fs
    .readdirSync(paths.palettes)
    .filter(isPaletteFile)
    .sort()
    .map((file) => {
      const colors = loadPalette(file);
      return { file, count: colors.length, preview: colors.slice(0, 24) };
    });
}
