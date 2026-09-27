import crypto from "node:crypto";
import { and, asc, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import {
  fieldSlotLabel,
  isLiveRecord,
  reconcileRecords,
  uniqueRecordKey,
  type EngineCollectionField,
  type EngineCollectionView,
  type EngineRecordState,
  type IncomingRecord
} from "@/shared/engineCollection";
import { fieldSlotId } from "@/server/fieldSlotId";
import { db, type Transaction } from "../index";
import {
  engineCollections,
  engineRecords,
  engineSlots,
  type EngineCollectionRow,
  type EngineRecordRow
} from "../schema";

export interface CatalogCollection {
  id: string;
  label: string;
  path: string;
  fields: EngineCollectionField[];
  records: IncomingRecord[];
}

export class CollectionError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "CollectionError";
  }
}

function toState(row: EngineRecordRow): EngineRecordState {
  return {
    id: row.id,
    key: row.key,
    sort: row.sort,
    origin: row.origin,
    acked: row.acked,
    pending: row.pending,
    removedBy: row.removedBy ?? null
  };
}

async function recordsOf(tx: Transaction, collectionId: string): Promise<EngineRecordRow[]> {
  return tx
    .select()
    .from(engineRecords)
    .where(eq(engineRecords.collectionId, collectionId))
    .orderBy(asc(engineRecords.sort), asc(engineRecords.createdAt));
}

async function writeRecords(
  tx: Transaction,
  projectId: string,
  collectionId: string,
  states: EngineRecordState[],
  now: Date
): Promise<void> {
  for (const state of states) {
    await tx
      .insert(engineRecords)
      .values({
        id: state.id,
        collectionId,
        projectId,
        key: state.key,
        sort: state.sort,
        origin: state.origin,
        acked: state.acked,
        pending: state.pending,
        removedBy: state.removedBy,
        updatedAt: now
      })
      .onConflictDoUpdate({
        target: engineRecords.id,
        set: {
          key: state.key,
          sort: state.sort,
          acked: state.acked,
          pending: state.pending,
          removedBy: state.removedBy,
          updatedAt: now
        }
      });
  }
}

/**
 * Makes the `record_field` slots match the collection: one live slot per live
 * record and field, labelled from the current keys. Everything else under the
 * collection is tombstoned so its assignment survives an undo.
 */
async function syncFieldSlots(
  tx: Transaction,
  projectId: string,
  collection: EngineCollectionRow,
  now: Date
): Promise<void> {
  const records = await recordsOf(tx, collection.id);
  const recordIds = records.map((record) => record.id);
  const live = collection.tombstonedAt ? [] : records.filter(isLiveRecord);
  const wanted: string[] = [];

  for (const record of live) {
    for (const field of collection.fields) {
      const id = fieldSlotId(record.id, field.key);
      wanted.push(id);
      const label = fieldSlotLabel(collection.label, record.key, field.key);

      await tx
        .insert(engineSlots)
        .values({
          id,
          projectId,
          kind: "record_field",
          intent: field.intent,
          label,
          recordId: record.id,
          fieldKey: field.key,
          lastSeenAt: now,
          tombstonedAt: null,
          updatedAt: now
        })
        .onConflictDoUpdate({
          target: engineSlots.id,
          set: {
            kind: "record_field",
            intent: field.intent,
            label,
            recordId: record.id,
            fieldKey: field.key,
            tombstonedAt: null,
            updatedAt: now
          }
        });
    }
  }

  if (recordIds.length === 0) return;

  await tx
    .update(engineSlots)
    .set({ tombstonedAt: now, updatedAt: now })
    .where(
      and(
        eq(engineSlots.projectId, projectId),
        inArray(engineSlots.recordId, recordIds),
        isNull(engineSlots.tombstonedAt),
        wanted.length > 0 ? notInArray(engineSlots.id, wanted) : undefined
      )
    );
}

/**
 * Runs inside the catalog upsert, after the plain slot rows are written, so a
 * field slot Godot listed for a record deleted on the web is re-tombstoned.
 * Collections the payload omits are tombstoned; their records are kept.
 */
export async function syncCatalogCollections(
  tx: Transaction,
  projectId: string,
  collections: CatalogCollection[],
  now: Date
): Promise<void> {
  const ids = collections.map((collection) => collection.id);
  // Removed in SpriteBench: Godot listing it again does not bring it back.
  const stayRemoved = sql`case when ${engineCollections.removedOnWeb} then ${engineCollections.tombstonedAt} else null end`;

  for (const incoming of collections) {
    const [prior] = await tx
      .select({ origin: engineCollections.origin })
      .from(engineCollections)
      .where(eq(engineCollections.id, incoming.id))
      .limit(1);
    // A table made in SpriteBench keeps its own name and fields: the plugin
    // only mirrors them, so its copy never overrules the web's.
    const webOwned = prior?.origin === "web";

    const [collection] = await tx
      .insert(engineCollections)
      .values({
        id: incoming.id,
        projectId,
        label: incoming.label,
        godotPath: incoming.path,
        fields: incoming.fields,
        lastSeenAt: now,
        tombstonedAt: null,
        updatedAt: now
      })
      .onConflictDoUpdate({
        target: engineCollections.id,
        set: webOwned
          ? { godotPath: incoming.path, lastSeenAt: now, tombstonedAt: stayRemoved, updatedAt: now }
          : {
              label: incoming.label,
              godotPath: incoming.path,
              fields: incoming.fields,
              lastSeenAt: now,
              tombstonedAt: stayRemoved,
              updatedAt: now
            }
      })
      .returning();

    const existing = (await recordsOf(tx, incoming.id)).map(toState);
    await writeRecords(tx, projectId, incoming.id, reconcileRecords(existing, incoming.records), now);
    await syncFieldSlots(tx, projectId, collection, now);
  }

  const gone = await tx
    .update(engineCollections)
    .set({ tombstonedAt: now, updatedAt: now })
    .where(
      and(
        eq(engineCollections.projectId, projectId),
        isNull(engineCollections.tombstonedAt),
        // Only Godot's own tables go when Godot stops listing them.
        eq(engineCollections.origin, "godot"),
        ids.length > 0 ? notInArray(engineCollections.id, ids) : undefined
      )
    )
    .returning();

  for (const collection of gone) {
    await syncFieldSlots(tx, projectId, collection, now);
  }
}

export async function listEngineCollections(projectId: string): Promise<EngineCollectionView[]> {
  const collections = await db()
    .select()
    .from(engineCollections)
    .where(and(eq(engineCollections.projectId, projectId), isNull(engineCollections.tombstonedAt)))
    .orderBy(asc(engineCollections.label), asc(engineCollections.id));

  if (collections.length === 0) return [];

  const records = await db()
    .select()
    .from(engineRecords)
    .where(
      inArray(
        engineRecords.collectionId,
        collections.map((collection) => collection.id)
      )
    )
    .orderBy(asc(engineRecords.sort), asc(engineRecords.createdAt));

  return collections.map((collection) => {
    const mine = records.filter((record) => record.collectionId === collection.id);
    return {
      id: collection.id,
      origin: collection.origin,
      label: collection.label,
      godotPath: collection.godotPath,
      fields: collection.fields,
      records: mine.filter(isLiveRecord).map((record) => ({
        id: record.id,
        key: record.key,
        sort: record.sort,
        origin: record.origin,
        pending: record.pending || !record.acked,
        slots: Object.fromEntries(
          collection.fields.map((field) => [field.key, fieldSlotId(record.id, field.key)])
        )
      })),
      removedRecordIds: mine
        .filter((record) => record.removedBy === "web")
        .map((record) => record.id)
    };
  });
}

async function liveCollection(
  tx: Transaction,
  projectId: string,
  collectionId: string
): Promise<EngineCollectionRow> {
  const [collection] = await tx
    .select()
    .from(engineCollections)
    .where(
      and(
        eq(engineCollections.projectId, projectId),
        eq(engineCollections.id, collectionId),
        isNull(engineCollections.tombstonedAt)
      )
    )
    .limit(1);
  if (!collection) throw new CollectionError("collection not found", 404);
  return collection;
}

async function liveRecord(
  tx: Transaction,
  collectionId: string,
  recordId: string
): Promise<EngineRecordRow> {
  const [record] = await tx
    .select()
    .from(engineRecords)
    .where(
      and(
        eq(engineRecords.collectionId, collectionId),
        eq(engineRecords.id, recordId),
        isNull(engineRecords.removedBy)
      )
    )
    .limit(1);
  if (!record) throw new CollectionError("record not found", 404);
  return record;
}

/** A web-created record. Godot adds it to the resource on its next sync. */
export async function createEngineRecord(
  projectId: string,
  collectionId: string,
  key: string
): Promise<string> {
  const id = crypto.randomUUID();
  const now = new Date();

  await db().transaction(async (tx) => {
    const collection = await liveCollection(tx, projectId, collectionId);
    const records = await recordsOf(tx, collectionId);
    const live = records.filter(isLiveRecord);

    await tx.insert(engineRecords).values({
      id,
      collectionId,
      projectId,
      key: uniqueRecordKey(key, live.map((record) => record.key)),
      sort: records.reduce((max, record) => Math.max(max, record.sort + 1), 0),
      origin: "web",
      acked: false,
      pending: true,
      removedBy: null,
      updatedAt: now
    });
    await syncFieldSlots(tx, projectId, collection, now);
  });

  return id;
}

export async function renameEngineRecord(
  projectId: string,
  collectionId: string,
  recordId: string,
  key: string
): Promise<void> {
  const now = new Date();

  await db().transaction(async (tx) => {
    const collection = await liveCollection(tx, projectId, collectionId);
    const record = await liveRecord(tx, collectionId, recordId);
    const others = (await recordsOf(tx, collectionId))
      .filter((row) => isLiveRecord(row) && row.id !== recordId)
      .map((row) => row.key);
    const next = uniqueRecordKey(key, others);
    if (next === record.key) return;

    await tx
      .update(engineRecords)
      .set({ key: next, pending: true, updatedAt: now })
      .where(eq(engineRecords.id, recordId));
    await syncFieldSlots(tx, projectId, collection, now);
  });
}

/** Tombstoned rather than deleted, so Godot learns to drop it. */
export async function deleteEngineRecord(
  projectId: string,
  collectionId: string,
  recordId: string
): Promise<void> {
  const now = new Date();

  await db().transaction(async (tx) => {
    const collection = await liveCollection(tx, projectId, collectionId);
    await liveRecord(tx, collectionId, recordId);

    await tx
      .update(engineRecords)
      .set({ removedBy: "web", pending: false, updatedAt: now })
      .where(eq(engineRecords.id, recordId));
    await syncFieldSlots(tx, projectId, collection, now);
  });
}

/**
 * A table made in SpriteBench: SpriteBench owns its name and fields, and the
 * plugin writes it into Godot as a SpriteBenchCollection. Starts with no rows.
 */
export async function createWebTable(
  projectId: string,
  label: string,
  fields: EngineCollectionField[]
): Promise<string> {
  const id = crypto.randomUUID();
  const [clash] = await db()
    .select({ id: engineCollections.id })
    .from(engineCollections)
    .where(
      and(
        eq(engineCollections.projectId, projectId),
        eq(engineCollections.label, label),
        isNull(engineCollections.tombstonedAt)
      )
    )
    .limit(1);
  if (clash) throw new CollectionError(`there is already a table called ${label}`, 409);

  await db().insert(engineCollections).values({
    id,
    projectId,
    origin: "web",
    label,
    godotPath: "",
    fields
  });
  return id;
}

/**
 * Replaces a web table's fields; its cells follow (new fields appear, removed
 * ones go). `renames` carry each row's art, in both lanes, from an old field
 * key to its new one, since a cell's slot id is derived from the key.
 */
export async function setWebTableFields(
  projectId: string,
  collectionId: string,
  fields: EngineCollectionField[],
  renames: Array<{ from: string; to: string }> = []
): Promise<void> {
  const now = new Date();
  await db().transaction(async (tx) => {
    const collection = await liveCollection(tx, projectId, collectionId);
    if (collection.origin !== "web") {
      throw new CollectionError("this table's fields are set in Godot", 409);
    }
    const [updated] = await tx
      .update(engineCollections)
      .set({ fields, updatedAt: now })
      .where(eq(engineCollections.id, collectionId))
      .returning();
    await syncFieldSlots(tx, projectId, updated, now);

    const keys = new Set(fields.map((field) => field.key));
    const records = (await recordsOf(tx, collectionId)).filter(isLiveRecord);
    for (const rename of renames) {
      if (!keys.has(rename.to)) continue;
      for (const record of records) {
        const [old] = await tx
          .select()
          .from(engineSlots)
          .where(eq(engineSlots.id, fieldSlotId(record.id, rename.from)))
          .limit(1);
        if (!old) continue;
        await tx
          .update(engineSlots)
          .set({
            assignedAssetIds: old.assignedAssetIds,
            remoteHash: old.remoteHash,
            finalAssetIds: old.finalAssetIds,
            finalRemoteHash: old.finalRemoteHash,
            updatedAt: now
          })
          .where(eq(engineSlots.id, fieldSlotId(record.id, rename.to)));
      }
    }
  });
}

/** Renames a table made in SpriteBench; its cells' labels follow. */
export async function renameWebTable(projectId: string, collectionId: string, label: string): Promise<void> {
  const now = new Date();
  await db().transaction(async (tx) => {
    const collection = await liveCollection(tx, projectId, collectionId);
    if (collection.origin !== "web") throw new CollectionError("rename this table in Godot", 409);
    const [clash] = await tx
      .select({ id: engineCollections.id })
      .from(engineCollections)
      .where(
        and(
          eq(engineCollections.projectId, projectId),
          eq(engineCollections.label, label),
          isNull(engineCollections.tombstonedAt)
        )
      )
      .limit(1);
    if (clash && clash.id !== collectionId) {
      throw new CollectionError(`there is already a table called ${label}`, 409);
    }
    const [updated] = await tx
      .update(engineCollections)
      .set({ label, updatedAt: now })
      .where(eq(engineCollections.id, collectionId))
      .returning();
    await syncFieldSlots(tx, projectId, updated, now);
  });
}

/**
 * Removes a table and its cells from SpriteBench. One made here goes from
 * Godot on the next sync; one Godot made is marked removed so its listing
 * never brings it back, and Godot keeps its resource and art.
 */
export async function removeGameTable(projectId: string, collectionId: string): Promise<void> {
  const now = new Date();
  await db().transaction(async (tx) => {
    const collection = await liveCollection(tx, projectId, collectionId);
    const [gone] = await tx
      .update(engineCollections)
      .set({ tombstonedAt: now, updatedAt: now, removedOnWeb: collection.origin === "godot" })
      .where(eq(engineCollections.id, collectionId))
      .returning();
    await syncFieldSlots(tx, projectId, gone, now);
  });
}
