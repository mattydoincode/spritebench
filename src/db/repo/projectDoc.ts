import { and, asc, count, eq, gt, gte, lte } from "drizzle-orm";
import * as Y from "yjs";
import { createDoc, encodeState } from "@/shared/doc";
import { db, type Transaction } from "../index";
import { projectDocUpdates, projectDocs } from "../schema";

/**
 * Persistence for the shared document.
 *
 * The document is stored twice over: a compacted `state` blob, plus the log
 * of updates appended since it was compacted. Clients poll with the last
 * `seq` they saw and get only the tail, which is what makes an idle poll cost
 * a couple hundred bytes rather than the whole project.
 */

export interface DocSnapshot {
  /** A full Yjs state vector update -- enough to construct the document. */
  state: Uint8Array;
  /** High-water mark; ask for updates after this to stay current. */
  seq: number;
}

/**
 * The compacted state, creating an empty document on first read.
 *
 * Concurrent first reads race, which `onConflictDoNothing` settles: the loser
 * re-reads the winner's row rather than overwriting it with its own empty
 * document.
 */
export async function readDocState(
  projectId: string,
  tx: Transaction = db()
): Promise<DocSnapshot> {
  const [row] = await tx
    .select()
    .from(projectDocs)
    .where(eq(projectDocs.projectId, projectId))
    .limit(1);

  if (row) return { state: new Uint8Array(row.state), seq: row.seq };

  const empty = encodeState(createDoc());

  await tx
    .insert(projectDocs)
    .values({ projectId, state: Buffer.from(empty), seq: 0 })
    .onConflictDoNothing();

  const [created] = await tx
    .select()
    .from(projectDocs)
    .where(eq(projectDocs.projectId, projectId))
    .limit(1);

  return created
    ? { state: new Uint8Array(created.state), seq: created.seq }
    : { state: empty, seq: 0 };
}

export interface DocTail {
  updates: Uint8Array[];
  seq: number;
}

/** Updates appended after `since`, oldest first. */
export async function readDocUpdates(
  projectId: string,
  since: number,
  tx: Transaction = db()
): Promise<DocTail> {
  const rows = await tx
    .select({ seq: projectDocUpdates.seq, update: projectDocUpdates.update })
    .from(projectDocUpdates)
    .where(and(eq(projectDocUpdates.projectId, projectId), gt(projectDocUpdates.seq, since)))
    .orderBy(asc(projectDocUpdates.seq));

  return {
    updates: rows.map((row) => new Uint8Array(row.update)),
    seq: rows.length > 0 ? rows[rows.length - 1].seq : since
  };
}

export async function appendDocUpdate(
  projectId: string,
  update: Uint8Array,
  actorUserId: string | null
): Promise<number> {
  const [row] = await db()
    .insert(projectDocUpdates)
    .values({ projectId, update: Buffer.from(update), actorUserId })
    .returning({ seq: projectDocUpdates.seq });

  return row.seq;
}

/**
 * The whole document as one update, for a client that has nothing.
 *
 * Reads the compacted state and folds the tail in rather than returning both,
 * so the caller never has to know compaction exists.
 */
export async function readDoc(projectId: string): Promise<DocSnapshot> {
  return readDocWith(projectId, db());
}

async function readDocWith(projectId: string, tx: Transaction): Promise<DocSnapshot> {
  const snapshot = await readDocState(projectId, tx);
  const tail = await readDocUpdates(projectId, snapshot.seq, tx);

  if (tail.updates.length === 0) return snapshot;

  const doc = new Y.Doc();
  Y.applyUpdate(doc, snapshot.state);
  for (const update of tail.updates) Y.applyUpdate(doc, update);

  return { state: encodeState(doc), seq: tail.seq };
}

export type DocIncrement =
  | { full: true; state: Uint8Array; seq: number }
  | { full: false; updates: Uint8Array[]; seq: number };

/**
 * Reads what an already-open client is missing. If compaction has passed the
 * client's sequence, the deleted log segment is recovered by returning the
 * full compacted document. Repeatable read makes the state/log decision
 * atomic with respect to the compactor's update-and-delete transaction.
 */
export async function readDocSince(projectId: string, since: number): Promise<DocIncrement> {
  return db().transaction(
    async (tx) => {
      const snapshot = await readDocState(projectId, tx);

      if (since < snapshot.seq) {
        const full = await readDocWith(projectId, tx);
        return { full: true, ...full };
      }

      const tail = await readDocUpdates(projectId, since, tx);
      return { full: false, ...tail };
    },
    { isolationLevel: "repeatable read" }
  );
}

/**
 * Folds the update log into the compacted state and drops what was folded in.
 *
 * Without this the log grows without bound and every cold load replays the
 * project's entire edit history. Truncation is bounded by the same `seq` that
 * was compacted, so an update appended mid-compaction survives to the next
 * pass instead of being lost.
 */
export async function compactDoc(projectId: string): Promise<{ folded: number }> {
  return db().transaction(async (tx) => {
    const snapshot = await readDocState(projectId, tx);
    const tail = await readDocUpdates(projectId, snapshot.seq, tx);

    if (tail.updates.length === 0) return { folded: 0 };

    const doc = new Y.Doc();
    Y.applyUpdate(doc, snapshot.state);
    for (const update of tail.updates) Y.applyUpdate(doc, update);

    await tx
      .update(projectDocs)
      .set({ state: Buffer.from(encodeState(doc)), seq: tail.seq, updatedAt: new Date() })
      .where(eq(projectDocs.projectId, projectId));

    await tx
      .delete(projectDocUpdates)
      .where(
        and(eq(projectDocUpdates.projectId, projectId), lte(projectDocUpdates.seq, tail.seq))
      );

    return { folded: tail.updates.length };
  });
}

/** Projects whose update log is long enough to be worth compacting. */
export async function projectsNeedingCompaction(threshold: number): Promise<string[]> {
  const rows = await db()
    .select({ projectId: projectDocUpdates.projectId, updates: count() })
    .from(projectDocUpdates)
    .groupBy(projectDocUpdates.projectId)
    .having(gte(count(), threshold));

  return rows.map((row) => row.projectId);
}
