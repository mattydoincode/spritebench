import { and, desc, eq } from "drizzle-orm";
import { templateKey } from "@/storage/keys";
import { db } from "../index";
import { templates, type TemplateRow } from "../schema";

/** `id` addresses the template; `name` is only ever displayed. */
export interface TemplateInfo {
  id: string;
  name: string;
  width: number;
  height: number;
}

export function toTemplateInfo(row: TemplateRow): TemplateInfo {
  return { id: row.id, name: row.filename, width: row.width, height: row.height };
}

export async function listTemplates(projectId: string): Promise<TemplateInfo[]> {
  const rows = await db()
    .select()
    .from(templates)
    .where(eq(templates.projectId, projectId))
    .orderBy(desc(templates.createdAt));

  return rows.map(toTemplateInfo);
}

export async function getTemplate(
  projectId: string,
  templateId: string
): Promise<TemplateRow | null> {
  const [row] = await db()
    .select()
    .from(templates)
    .where(and(eq(templates.projectId, projectId), eq(templates.id, templateId)))
    .limit(1);

  return row ?? null;
}

export async function insertTemplate(
  projectId: string,
  id: string,
  name: string,
  width: number,
  height: number
): Promise<TemplateInfo> {
  const [row] = await db()
    .insert(templates)
    .values({
      id,
      projectId,
      filename: name,
      storageKey: templateKey(projectId, id),
      width,
      height
    })
    .returning();

  return toTemplateInfo(row);
}

export async function deleteTemplate(
  projectId: string,
  templateId: string
): Promise<string | null> {
  const [row] = await db()
    .delete(templates)
    .where(and(eq(templates.projectId, projectId), eq(templates.id, templateId)))
    .returning({ storageKey: templates.storageKey });

  return row?.storageKey ?? null;
}
