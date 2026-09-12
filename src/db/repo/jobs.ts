import { and, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { withDefaults } from "@/core/settings";
import { DEFAULT_GENERATION, type JobRecord, type JobStatus } from "@/shared/model";
import { db, type Transaction } from "../index";
import { jobs, type JobRow } from "../schema";

export function toJobRecord(row: JobRow): JobRecord {
  return {
    id: row.id,
    status: row.status,
    label: row.label,
    batchId: row.batchId,
    batchIndex: row.batchIndex,
    batchSize: row.batchSize,
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    userId: row.userId,
    providerKeyId: row.providerKeyId,
    prompt: row.prompt,
    composedPrompt: row.composedPrompt,
    generation: { ...DEFAULT_GENERATION, ...(row.generation ?? {}) },
    processing: withDefaults(row.processing),
    folder: row.folder,
    inputs: row.inputs ?? null,
    sequencePlan: row.sequencePlan ?? null,
    rerunOf: row.rerunOf,
    assetIds: row.assetIds ?? [],
    resolvedSize: row.resolvedSize ?? null,
    error: row.error
  };
}

/**
 * Every job in the project, whoever queued it. A collaborator needs to see
 * that four images are already generating, or they will queue four more.
 */
export async function listJobs(projectId: string): Promise<JobRecord[]> {
  const rows = await db()
    .select()
    .from(jobs)
    .where(eq(jobs.projectId, projectId))
    .orderBy(desc(jobs.createdAt))
    .limit(200);

  return rows.map(toJobRecord);
}

export async function getJobRow(id: string): Promise<JobRow | null> {
  const [row] = await db().select().from(jobs).where(eq(jobs.id, id)).limit(1);
  return row ?? null;
}

export interface NewJob {
  projectId: string;
  /** Who pressed Generate. One of the owner's keys pays regardless. */
  userId: string;
  /** Which of the owner's keys pays. Null on the environment-key dev path. */
  providerKeyId: string | null;
  label: string;
  batchId: string | null;
  batchIndex: number;
  batchSize: number;
  prompt: JobRecord["prompt"];
  composedPrompt: string;
  generation: JobRecord["generation"];
  processing: JobRecord["processing"];
  folder: string;
  inputs: JobRecord["inputs"];
  sequencePlan: JobRecord["sequencePlan"];
  rerunOf: string | null;
  status?: JobStatus;
}

export async function insertJob(
  input: NewJob,
  connection: Transaction = db()
): Promise<JobRow> {
  const [row] = await connection
    .insert(jobs)
    .values({
      projectId: input.projectId,
      userId: input.userId,
      providerKeyId: input.providerKeyId,
      status: input.status ?? "queued",
      label: input.label,
      batchId: input.batchId,
      batchIndex: input.batchIndex,
      batchSize: input.batchSize,
      prompt: input.prompt,
      composedPrompt: input.composedPrompt,
      generation: input.generation,
      processing: input.processing,
      folder: input.folder,
      inputs: input.inputs,
      sequencePlan: input.sequencePlan,
      rerunOf: input.rerunOf
    })
    .returning();

  return row;
}

/**
 * Images that queued and running jobs are already going to produce.
 *
 * The asset count alone understates what a project has committed to: a queued
 * batch has not written its rows yet, so without this a burst of requests
 * could each pass the quota check and collectively blow past the limit.
 */
export async function pendingImages(
  projectId: string,
  connection: Transaction = db()
): Promise<number> {
  const [row] = await connection
    .select({
      value: sql<number>`coalesce(sum(greatest(1, (${jobs.generation} ->> 'imageCount')::int)), 0)`
    })
    .from(jobs)
    .where(and(eq(jobs.projectId, projectId), inArray(jobs.status, ["queued", "blocked", "running"])));

  return Number(row?.value ?? 0);
}

export async function setQueueJobId(
  id: string,
  queueJobId: string | null,
  connection: Transaction = db()
): Promise<void> {
  await connection.update(jobs).set({ queueJobId }).where(eq(jobs.id, id));
}

/**
 * Claims a job for execution. Returns null if it is not claimable, which is
 * how a duplicate pg-boss delivery becomes a no-op rather than a second
 * paid generation.
 */
export async function claimJob(id: string): Promise<JobRow | null> {
  const [row] = await db()
    .update(jobs)
    .set({ status: "running", startedAt: new Date(), error: null })
    .where(and(eq(jobs.id, id), inArray(jobs.status, ["queued", "running"])))
    .returning();

  return row ?? null;
}

export async function markProviderCallComplete(id: string): Promise<void> {
  await db()
    .update(jobs)
    .set({ providerCallCompletedAt: new Date() })
    .where(eq(jobs.id, id));
}

export async function appendAssetId(id: string, assetId: string): Promise<void> {
  await db()
    .update(jobs)
    .set({ assetIds: sql`${jobs.assetIds} || ${JSON.stringify([assetId])}::jsonb` })
    .where(eq(jobs.id, id));
}

/**
 * Puts a job back in line after a failure the queue is going to retry, so the
 * UI shows it as still pending rather than flashing an error that resolves
 * itself. The message is kept for context while it waits.
 */
export async function requeueJob(id: string, error: string): Promise<void> {
  await db()
    .update(jobs)
    .set({ status: "queued", error, startedAt: null })
    .where(eq(jobs.id, id));
}

export async function finishJob(
  id: string,
  patch: { status: JobStatus; error?: string | null; resolvedSize?: JobRecord["resolvedSize"] }
): Promise<void> {
  await db()
    .update(jobs)
    .set({
      status: patch.status,
      error: patch.error ?? null,
      ...(patch.resolvedSize !== undefined ? { resolvedSize: patch.resolvedSize } : {}),
      finishedAt: new Date()
    })
    .where(eq(jobs.id, id));
}

export async function cancelJob(projectId: string, id: string): Promise<boolean> {
  const [row] = await db()
    .update(jobs)
    .set({ status: "cancelled", finishedAt: new Date() })
    .where(
      and(
        eq(jobs.id, id),
        eq(jobs.projectId, projectId),
        inArray(jobs.status, ["queued", "blocked"])
      )
    )
    .returning({ id: jobs.id });

  return row !== undefined;
}

export async function cancelBlockedInBatch(projectId: string, batchId: string): Promise<number> {
  const rows = await db()
    .update(jobs)
    .set({ status: "cancelled", finishedAt: new Date() })
    .where(
      and(eq(jobs.projectId, projectId), eq(jobs.batchId, batchId), eq(jobs.status, "blocked"))
    )
    .returning({ id: jobs.id });

  return rows.length;
}

export async function findBlockedLoopStep(
  projectId: string,
  batchId: string,
  index: number
): Promise<JobRow | null> {
  const rows = await db()
    .select()
    .from(jobs)
    .where(and(eq(jobs.projectId, projectId), eq(jobs.batchId, batchId), eq(jobs.status, "blocked")));

  return (
    rows.find((row) => {
      const loop = row.inputs?.loop;
      return loop != null && "index" in loop && loop.index === index;
    }) ?? null
  );
}

export async function unblockJob(
  id: string,
  inputs: JobRecord["inputs"]
): Promise<JobRow | null> {
  const [row] = await db()
    .update(jobs)
    .set({ status: "queued", inputs, error: null })
    .where(and(eq(jobs.id, id), eq(jobs.status, "blocked")))
    .returning();

  return row ?? null;
}

export async function clearFinishedJobs(projectId: string): Promise<void> {
  await db()
    .delete(jobs)
    .where(
      and(
        eq(jobs.projectId, projectId),
        ne(jobs.status, "queued"),
        ne(jobs.status, "blocked"),
        ne(jobs.status, "running")
      )
    );
}

/**
 * Fails jobs left mid-flight by a hard crash. Run on worker boot; a graceful
 * shutdown drains instead, so anything found here really did die.
 */
export async function failOrphanedJobs(): Promise<number> {
  const rows = await db()
    .update(jobs)
    .set({
      status: "error",
      error: "interrupted before the worker could finish it",
      finishedAt: new Date()
    })
    .where(and(eq(jobs.status, "running"), isNull(jobs.providerCallCompletedAt)))
    .returning({ id: jobs.id, projectId: jobs.projectId, batchId: jobs.batchId });

  const seen = new Set<string>();
  for (const row of rows) {
    if (!row.batchId || seen.has(row.batchId)) continue;
    seen.add(row.batchId);
    await cancelBlockedInBatch(row.projectId, row.batchId);
  }

  return rows.length;
}
