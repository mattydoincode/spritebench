import { and, desc, eq } from "drizzle-orm";
import { templateKey } from "@/storage/keys";
import { db } from "../index";
import { templates, type TemplateRow } from "../schema";

export interface TemplateInfo {
  file: string;
  width: number;
  height: number;
}

export function toTemplateInfo(row: TemplateRow): TemplateInfo {
  return { file: row.filename, width: row.width, height: row.height };
}

export async function listTemplates(userId: string): Promise<TemplateInfo[]> {
  const rows = await db()
    .select()
    .from(templates)
    .where(eq(templates.userId, userId))
    .orderBy(desc(templates.createdAt));

  return rows.map(toTemplateInfo);
}

export async function getTemplate(userId: string, filename: string): Promise<TemplateRow | null> {
  const [row] = await db()
    .select()
    .from(templates)
    .where(and(eq(templates.userId, userId), eq(templates.filename, filename)))
    .limit(1);

  return row ?? null;
}

export async function upsertTemplate(
  userId: string,
  filename: string,
  width: number,
  height: number
): Promise<TemplateInfo> {
  const [row] = await db()
    .insert(templates)
    .values({ userId, filename, storageKey: templateKey(filename), width, height })
    .onConflictDoUpdate({
      target: [templates.userId, templates.filename],
      set: { storageKey: templateKey(filename), width, height }
    })
    .returning();

  return toTemplateInfo(row);
}

export async function deleteTemplate(userId: string, filename: string): Promise<string | null> {
  const [row] = await db()
    .delete(templates)
    .where(and(eq(templates.userId, userId), eq(templates.filename, filename)))
    .returning({ storageKey: templates.storageKey });

  return row?.storageKey ?? null;
}
