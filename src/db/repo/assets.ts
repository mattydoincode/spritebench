import { and, asc, count, desc, eq, isNotNull, isNull, lt, sum } from "drizzle-orm";
import { withDefaults } from "@/core/settings";
import { DEFAULT_GENERATION, type AssetRecord } from "@/shared/model";
import { db, type Transaction } from "../index";
import { assets, type AssetRow } from "../schema";
import { nextAssetSeq } from "./projects";

/**
 * The wire shape carries provenance only. Everything editable -- name,
 * folder, tags, live processing settings -- comes from the project's Yjs
 * document instead, and the client merges the two with `resolveAsset`.
 */
export function toAssetRecord(row: AssetRow): AssetRecord {
  return {
    id: row.id,
    seq: row.seq,
    createdAt: row.createdAt.toISOString(),
    createdByUserId: row.createdByUserId,
    sourceWidth: row.sourceWidth,
    sourceHeight: row.sourceHeight,
    prompt: row.prompt,
    composedPrompt: row.composedPrompt,
    generation: { ...DEFAULT_GENERATION, ...(row.generation ?? {}) },
    generatedWith: withDefaults(row.processing),
    exportPath: row.exportKey,
    rerunOf: row.rerunOf,
    jobId: row.jobId,
    inputs: row.inputs ?? null,
    sequencePlan: row.sequencePlan ?? null,
    usage: row.usage ?? null,
    elapsedSeconds: row.elapsedSeconds,
    hasSource: row.sourceKey !== null,
    expiresAt: row.expiresAt?.toISOString() ?? null
  };
}

export async function listAssets(projectId: string): Promise<AssetRecord[]> {
  const rows = await db()
    .select()
    .from(assets)
    .where(and(eq(assets.projectId, projectId), isNull(assets.deletedAt)))
    .orderBy(asc(assets.seq));

  return rows.map(toAssetRecord);
}

export async function getAsset(projectId: string, id: string): Promise<AssetRecord | null> {
  const row = await getAssetRow(projectId, id);
  return row ? toAssetRecord(row) : null;
}

export async function getAssetRow(projectId: string, id: string): Promise<AssetRow | null> {
  const [row] = await db()
    .select()
    .from(assets)
    .where(and(eq(assets.id, id), eq(assets.projectId, projectId), isNull(assets.deletedAt)))
    .limit(1);

  return row ?? null;
}

export interface NewAsset {
  projectId: string;
  createdByUserId: string | null;
  /** Pre-allocated so the caller can name the storage key before inserting. */
  id: string;
  sourceKey: string;
  thumbKey?: string | null;
  sourceWidth: number;
  sourceHeight: number;
  byteSize: number;
  prompt: AssetRecord["prompt"];
  composedPrompt: string;
  generation: AssetRecord["generation"];
  processing: AssetRecord["generatedWith"];
  rerunOf?: string | null;
  jobId?: string | null;
  inputs?: AssetRecord["inputs"];
  sequencePlan?: AssetRecord["sequencePlan"];
  usage?: AssetRecord["usage"];
  elapsedSeconds?: number | null;
  expiresAt?: Date | null;
}

/**
 * Inserts an asset, allocating its per-project number as it goes.
 *
 * The id comes from the caller because the storage key is derived from it, so
 * the bytes have to be written before the row exists. A crash in between
 * leaves an orphaned object, which the nightly prune sweeps; the reverse
 * order would leave a row pointing at nothing, which the UI cannot render.
 */
export async function insertAsset(
  input: NewAsset,
  connection: Transaction = db()
): Promise<AssetRecord> {
  const seq = await nextAssetSeq(input.projectId, connection);

  const [row] = await connection
    .insert(assets)
    .values({
      id: input.id,
      projectId: input.projectId,
      createdByUserId: input.createdByUserId,
      seq,
      sourceKey: input.sourceKey,
      thumbKey: input.thumbKey ?? null,
      sourceWidth: input.sourceWidth,
      sourceHeight: input.sourceHeight,
      byteSize: input.byteSize,
      prompt: input.prompt,
      composedPrompt: input.composedPrompt,
      generation: input.generation,
      processing: input.processing,
      rerunOf: input.rerunOf ?? null,
      jobId: input.jobId ?? null,
      inputs: input.inputs ?? null,
      sequencePlan: input.sequencePlan ?? null,
      usage: input.usage ?? null,
      elapsedSeconds: input.elapsedSeconds ?? null,
      expiresAt: input.expiresAt ?? null
    })
    .returning();

  return toAssetRecord(row);
}

/** Records where an approved export landed. The only mutable field left. */
export async function setAssetExport(
  projectId: string,
  id: string,
  exportKey: string
): Promise<AssetRecord | null> {
  const [row] = await db()
    .update(assets)
    .set({ exportKey, updatedAt: new Date() })
    .where(and(eq(assets.id, id), eq(assets.projectId, projectId), isNull(assets.deletedAt)))
    .returning();

  return row ? toAssetRecord(row) : null;
}

/** Soft delete, so an "undo" toast and support recovery both stay possible. */
export async function softDeleteAsset(projectId: string, id: string): Promise<AssetRow | null> {
  const [row] = await db()
    .update(assets)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(assets.id, id), eq(assets.projectId, projectId), isNull(assets.deletedAt)))
    .returning();

  return row ?? null;
}

export async function countAssets(
  projectId: string,
  connection: Transaction = db()
): Promise<number> {
  const [row] = await connection
    .select({ value: count() })
    .from(assets)
    .where(and(eq(assets.projectId, projectId), isNull(assets.deletedAt)));

  return Number(row?.value ?? 0);
}

export async function storedBytes(projectId: string): Promise<number> {
  const [row] = await db()
    .select({ value: sum(assets.byteSize) })
    .from(assets)
    .where(
      and(
        eq(assets.projectId, projectId),
        isNull(assets.deletedAt),
        isNotNull(assets.sourceKey)
      )
    );

  return Number(row?.value ?? 0);
}

export async function listSourceKeys(projectId: string): Promise<string[]> {
  const rows = await db()
    .select({ sourceKey: assets.sourceKey })
    .from(assets)
    .where(and(eq(assets.projectId, projectId), isNotNull(assets.sourceKey)));

  return rows.map((row) => row.sourceKey).filter((key): key is string => key !== null);
}

/** Assets whose full-resolution source is past its retention window. */
export async function listExpiredSources(
  limit: number
): Promise<Array<{ id: string; sourceKey: string }>> {
  const rows = await db()
    .select({ id: assets.id, sourceKey: assets.sourceKey })
    .from(assets)
    .where(
      and(isNotNull(assets.sourceKey), isNotNull(assets.expiresAt), lt(assets.expiresAt, new Date()))
    )
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
