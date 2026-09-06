import { and, asc, count, desc, eq, isNotNull, isNull, lt, sum } from "drizzle-orm";
import { withDefaults, type ProcessingSettings } from "@/core/settings";
import { DEFAULT_GENERATION, type AssetRecord } from "@/shared/model";
import { basename } from "@/storage/keys";
import { db, type Transaction } from "../index";
import { assets, type AssetRow } from "../schema";

/**
 * Rows carry storage keys; the wire shape the client already understands
 * carries filenames. `sourceFile` stays in the payload for compatibility and
 * is derived from the key.
 */
export function toAssetRecord(row: AssetRow): AssetRecord {
  return {
    id: row.id,
    name: row.name,
    folder: row.folder,
    tags: row.tags ?? [],
    createdAt: row.createdAt.toISOString(),
    sourceFile: row.sourceKey ? basename(row.sourceKey) : "",
    sourceWidth: row.sourceWidth,
    sourceHeight: row.sourceHeight,
    prompt: row.prompt,
    composedPrompt: row.composedPrompt,
    generation: { ...DEFAULT_GENERATION, ...(row.generation ?? {}) },
    processing: withDefaults(row.processing),
    processingDescription: row.processingDescription,
    approvedPath: row.exportKey,
    approvedName: row.exportName,
    rerunOf: row.rerunOf,
    jobId: row.jobId,
    template: row.template ?? null,
    usage: row.usage ?? null,
    elapsedSeconds: row.elapsedSeconds,
    hasSource: row.sourceKey !== null,
    expiresAt: row.expiresAt?.toISOString() ?? null
  };
}

export async function listAssets(userId: string): Promise<AssetRecord[]> {
  const rows = await db()
    .select()
    .from(assets)
    .where(and(eq(assets.userId, userId), isNull(assets.deletedAt)))
    .orderBy(asc(assets.createdAt));

  return rows.map(toAssetRecord);
}

export async function getAsset(userId: string, id: string): Promise<AssetRecord | null> {
  const row = await getAssetRow(userId, id);
  return row ? toAssetRecord(row) : null;
}

export async function getAssetRow(userId: string, id: string): Promise<AssetRow | null> {
  const [row] = await db()
    .select()
    .from(assets)
    .where(and(eq(assets.id, id), eq(assets.userId, userId), isNull(assets.deletedAt)))
    .limit(1);

  return row ?? null;
}

export interface NewAsset {
  userId: string;
  name: string;
  folder: string;
  tags?: string[];
  sourceKey: string;
  thumbKey?: string | null;
  sourceWidth: number;
  sourceHeight: number;
  byteSize: number;
  prompt: AssetRecord["prompt"];
  composedPrompt: string;
  generation: AssetRecord["generation"];
  processing: AssetRecord["processing"];
  processingDescription?: string;
  rerunOf?: string | null;
  jobId?: string | null;
  template?: AssetRecord["template"];
  usage?: AssetRecord["usage"];
  elapsedSeconds?: number | null;
  expiresAt?: Date | null;
  createdAt?: Date;
}

export async function insertAsset(
  input: NewAsset,
  connection: Transaction = db()
): Promise<AssetRecord> {
  const [row] = await connection
    .insert(assets)
    .values({
      userId: input.userId,
      name: input.name,
      folder: input.folder,
      tags: input.tags ?? [],
      sourceKey: input.sourceKey,
      thumbKey: input.thumbKey ?? null,
      sourceWidth: input.sourceWidth,
      sourceHeight: input.sourceHeight,
      byteSize: input.byteSize,
      prompt: input.prompt,
      composedPrompt: input.composedPrompt,
      generation: input.generation,
      processing: input.processing,
      processingDescription: input.processingDescription ?? "",
      rerunOf: input.rerunOf ?? null,
      jobId: input.jobId ?? null,
      template: input.template ?? null,
      usage: input.usage ?? null,
      elapsedSeconds: input.elapsedSeconds ?? null,
      expiresAt: input.expiresAt ?? null,
      ...(input.createdAt ? { createdAt: input.createdAt } : {})
    })
    .returning();

  return toAssetRecord(row);
}

export type AssetPatch = Partial<
  Pick<AssetRecord, "name" | "folder" | "tags" | "processingDescription">
> & {
  /** Merged over the stored settings, then run through `withDefaults`. */
  processing?: Partial<ProcessingSettings>;
  exportKey?: string | null;
  exportName?: string | null;
  thumbKey?: string | null;
};

export async function updateAsset(
  userId: string,
  id: string,
  patch: AssetPatch
): Promise<AssetRecord | null> {
  const [row] = await db()
    .update(assets)
    .set({
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.folder !== undefined ? { folder: patch.folder } : {}),
      ...(patch.tags !== undefined ? { tags: patch.tags } : {}),
      ...(patch.processing !== undefined ? { processing: withDefaults(patch.processing) } : {}),
      ...(patch.processingDescription !== undefined
        ? { processingDescription: patch.processingDescription }
        : {}),
      ...(patch.exportKey !== undefined ? { exportKey: patch.exportKey } : {}),
      ...(patch.exportName !== undefined ? { exportName: patch.exportName } : {}),
      ...(patch.thumbKey !== undefined ? { thumbKey: patch.thumbKey } : {}),
      updatedAt: new Date()
    })
    .where(and(eq(assets.id, id), eq(assets.userId, userId), isNull(assets.deletedAt)))
    .returning();

  return row ? toAssetRecord(row) : null;
}

/** Soft delete, so an "undo" toast and support recovery both stay possible. */
export async function softDeleteAsset(userId: string, id: string): Promise<AssetRow | null> {
  const [row] = await db()
    .update(assets)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(assets.id, id), eq(assets.userId, userId), isNull(assets.deletedAt)))
    .returning();

  return row ?? null;
}

export async function countAssets(userId: string, connection: Transaction = db()): Promise<number> {
  const [row] = await connection
    .select({ value: count() })
    .from(assets)
    .where(and(eq(assets.userId, userId), isNull(assets.deletedAt)));

  return Number(row?.value ?? 0);
}

export async function storedBytes(userId: string): Promise<number> {
  const [row] = await db()
    .select({ value: sum(assets.byteSize) })
    .from(assets)
    .where(and(eq(assets.userId, userId), isNull(assets.deletedAt), isNotNull(assets.sourceKey)));

  return Number(row?.value ?? 0);
}

export async function listSourceKeys(userId: string): Promise<string[]> {
  const rows = await db()
    .select({ sourceKey: assets.sourceKey })
    .from(assets)
    .where(and(eq(assets.userId, userId), isNotNull(assets.sourceKey)));

  return rows.map((row) => row.sourceKey).filter((key): key is string => key !== null);
}

/** Assets whose full-resolution source is past its retention window. */
export async function listExpiredSources(
  limit: number
): Promise<Array<{ id: string; sourceKey: string }>> {
  const rows = await db()
    .select({ id: assets.id, sourceKey: assets.sourceKey })
    .from(assets)
    .where(and(isNotNull(assets.sourceKey), isNotNull(assets.expiresAt), lt(assets.expiresAt, new Date())))
    .orderBy(asc(assets.expiresAt))
    .limit(limit);

  return rows.flatMap((row) => (row.sourceKey ? [{ id: row.id, sourceKey: row.sourceKey }] : []));
}

/** Drops the source key and its byte count, keeping the row and thumbnail. */
export async function clearSource(id: string): Promise<void> {
  await db()
    .update(assets)
    .set({ sourceKey: null, byteSize: 0, expiresAt: null, updatedAt: new Date() })
    .where(eq(assets.id, id));
}

export async function listDeletedAssets(
  limit: number
): Promise<Array<{ id: string; sourceKey: string | null; thumbKey: string | null }>> {
  return db()
    .select({ id: assets.id, sourceKey: assets.sourceKey, thumbKey: assets.thumbKey })
    .from(assets)
    .where(isNotNull(assets.deletedAt))
    .orderBy(desc(assets.deletedAt))
    .limit(limit);
}

export async function hardDeleteAsset(id: string): Promise<void> {
  await db().delete(assets).where(eq(assets.id, id));
}
