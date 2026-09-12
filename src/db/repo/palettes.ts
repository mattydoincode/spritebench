import { and, asc, eq } from "drizzle-orm";
import type { Rgb } from "@/core/types";
import { paletteKey } from "@/storage/keys";
import { db } from "../index";
import { palettes, type PaletteRow } from "../schema";

/**
 * `id` addresses the palette; `name` is the label the picker shows. Two
 * collaborators uploading `apollo.gpl` get two palettes rather than one
 * overwriting the other.
 */
export interface PaletteInfo {
  id: string;
  name: string;
  count: number;
  preview: Rgb[];
}

export function toPaletteInfo(row: PaletteRow): PaletteInfo {
  return {
    id: row.id,
    name: row.filename,
    count: row.colors.length,
    preview: row.colors.slice(0, 24)
  };
}

export async function listPalettes(projectId: string): Promise<PaletteInfo[]> {
  const rows = await db()
    .select()
    .from(palettes)
    .where(eq(palettes.projectId, projectId))
    .orderBy(asc(palettes.filename));

  return rows.map(toPaletteInfo);
}

/**
 * Colours are parsed once on upload and stored, so no pipeline run ever
 * re-parses a `.gpl` or decodes a palette PNG.
 */
export async function getPaletteColors(projectId: string, paletteId: string): Promise<Rgb[]> {
  if (!paletteId) return [];

  const [row] = await db()
    .select({ colors: palettes.colors })
    .from(palettes)
    .where(and(eq(palettes.projectId, projectId), eq(palettes.id, paletteId)))
    .limit(1);

  return row?.colors ?? [];
}

export async function getPalette(projectId: string, paletteId: string): Promise<PaletteRow | null> {
  const [row] = await db()
    .select()
    .from(palettes)
    .where(and(eq(palettes.projectId, projectId), eq(palettes.id, paletteId)))
    .limit(1);

  return row ?? null;
}

export async function insertPalette(
  projectId: string,
  id: string,
  name: string,
  colors: Rgb[]
): Promise<PaletteInfo> {
  const [row] = await db()
    .insert(palettes)
    .values({
      id,
      projectId,
      filename: name,
      storageKey: paletteKey(projectId, id),
      colors
    })
    .returning();

  return toPaletteInfo(row);
}

export async function deletePalette(projectId: string, paletteId: string): Promise<string | null> {
  const [row] = await db()
    .delete(palettes)
    .where(and(eq(palettes.projectId, projectId), eq(palettes.id, paletteId)))
    .returning({ storageKey: palettes.storageKey });

  return row?.storageKey ?? null;
}
