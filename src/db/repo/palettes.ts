import { and, asc, eq } from "drizzle-orm";
import type { Rgb } from "@/core/types";
import { paletteKey } from "@/storage/keys";
import { db } from "../index";
import { palettes, type PaletteRow } from "../schema";

export interface PaletteInfo {
  file: string;
  count: number;
  preview: Rgb[];
}

export function toPaletteInfo(row: PaletteRow): PaletteInfo {
  return { file: row.filename, count: row.colors.length, preview: row.colors.slice(0, 24) };
}

export async function listPalettes(userId: string): Promise<PaletteInfo[]> {
  const rows = await db()
    .select()
    .from(palettes)
    .where(eq(palettes.userId, userId))
    .orderBy(asc(palettes.filename));

  return rows.map(toPaletteInfo);
}

/**
 * Colours are parsed once on upload and stored, so no pipeline run ever
 * re-parses a `.gpl` or decodes a palette PNG.
 */
export async function getPaletteColors(userId: string, filename: string): Promise<Rgb[]> {
  if (!filename) return [];

  const [row] = await db()
    .select({ colors: palettes.colors })
    .from(palettes)
    .where(and(eq(palettes.userId, userId), eq(palettes.filename, filename)))
    .limit(1);

  return row?.colors ?? [];
}

export async function upsertPalette(
  userId: string,
  filename: string,
  colors: Rgb[]
): Promise<PaletteInfo> {
  const [row] = await db()
    .insert(palettes)
    .values({ userId, filename, storageKey: paletteKey(filename), colors })
    .onConflictDoUpdate({
      target: [palettes.userId, palettes.filename],
      set: { storageKey: paletteKey(filename), colors }
    })
    .returning();

  return toPaletteInfo(row);
}

export async function deletePalette(userId: string, filename: string): Promise<string | null> {
  const [row] = await db()
    .delete(palettes)
    .where(and(eq(palettes.userId, userId), eq(palettes.filename, filename)))
    .returning({ storageKey: palettes.storageKey });

  return row?.storageKey ?? null;
}
