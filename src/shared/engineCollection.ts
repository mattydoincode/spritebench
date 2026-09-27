/**
 * A Godot-defined table of keyed records (for example buildings) where each
 * record has named art fields (`front`, `roof`, …). Every (record, field)
 * pair is an ordinary engine slot of kind `record_field`, so assignment,
 * export, pull and the three-hash status all work unchanged.
 *
 * Godot owns the field list. Records can be created, renamed and deleted from
 * either side; `acked` and `pending` are the handshake that stops a push from
 * undoing a web edit Godot has not applied yet.
 */

export const COLLECTION_FIELD_INTENTS = ["texture", "textures"] as const;
export type CollectionFieldIntent = (typeof COLLECTION_FIELD_INTENTS)[number];

export interface EngineCollectionField {
  key: string;
  intent: CollectionFieldIntent;
}

export type EngineRecordOrigin = "godot" | "web";
export type EngineRecordRemovedBy = "godot" | "web";

export interface EngineRecordState {
  id: string;
  key: string;
  sort: number;
  origin: EngineRecordOrigin;
  /** Godot has listed this record at least once. */
  acked: boolean;
  /** The server holds a key Godot has not written back yet. */
  pending: boolean;
  removedBy: EngineRecordRemovedBy | null;
}

export interface IncomingRecord {
  id: string;
  key: string;
}

export interface EngineRecordView {
  id: string;
  key: string;
  sort: number;
  origin: EngineRecordOrigin;
  pending: boolean;
  /** Field key → slot id. */
  slots: Record<string, string>;
}

export interface EngineCollectionView {
  id: string;
  /** "web": a table made in SpriteBench, which owns its fields. */
  origin: "godot" | "web";
  label: string;
  godotPath: string;
  fields: EngineCollectionField[];
  records: EngineRecordView[];
  /** Deleted on the web. Godot drops these from the resource on sync. */
  removedRecordIds: string[];
}

/**
 * Merges what Godot listed into what the server holds.
 *
 * - A listed record takes Godot's key and position, unless the server is
 *   holding a web rename (`pending`), which wins until Godot echoes it back.
 * - A record deleted on the web stays deleted even while Godot still lists it.
 * - A web-created record Godot has never listed is kept and sorted last.
 * - Anything else Godot stopped listing was deleted in Godot.
 */
export function reconcileRecords(
  existing: readonly EngineRecordState[],
  incoming: readonly IncomingRecord[]
): EngineRecordState[] {
  const byId = new Map(existing.map((record) => [record.id, record]));
  const listed = new Set<string>();
  const out: EngineRecordState[] = [];

  incoming.forEach((row, sort) => {
    if (listed.has(row.id)) return;
    listed.add(row.id);
    const current = byId.get(row.id);

    if (!current) {
      out.push({
        id: row.id,
        key: row.key,
        sort,
        origin: "godot",
        acked: true,
        pending: false,
        removedBy: null
      });
      return;
    }

    if (current.removedBy === "web") {
      out.push({ ...current });
      return;
    }

    const holdKey = current.pending && current.key !== row.key;
    out.push({
      ...current,
      key: holdKey ? current.key : row.key,
      sort,
      acked: true,
      pending: holdKey,
      removedBy: null
    });
  });

  const unseen = existing
    .filter((record) => !listed.has(record.id))
    .sort((a, b) => a.sort - b.sort);
  let tail = incoming.length;

  for (const record of unseen) {
    if (record.removedBy) {
      out.push({ ...record });
      continue;
    }
    if (!record.acked) {
      out.push({ ...record, sort: tail++ });
      continue;
    }
    out.push({ ...record, removedBy: "godot", pending: false });
  }

  return out;
}

export function isLiveRecord(record: Pick<EngineRecordState, "removedBy">): boolean {
  return record.removedBy === null;
}

export function fieldSlotLabel(collectionLabel: string, recordKey: string, fieldKey: string): string {
  return `${collectionLabel}/${recordKey}.${fieldKey}`.slice(0, 255);
}

/** Record keys are what Godot code looks buildings up by, so keep them tidy. */
export function normalizeRecordKey(key: string): string {
  return key
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^A-Za-z0-9_\-./]/g, "")
    .slice(0, 120);
}

/** `name`, `name_2`, `name_3`, … — the first one not already taken. */
export function uniqueRecordKey(wanted: string, taken: Iterable<string>): string {
  const base = normalizeRecordKey(wanted) || "record";
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    const next = `${base}_${n}`;
    if (!used.has(next)) return next;
  }
}

/**
 * A name made into a key Godot can use as a StringName and a file name:
 * lowercase letters, digits and underscores, not starting with a digit.
 */
export function gameAssetKey(name: string): string {
  const key = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return /^[0-9]/.test(key) ? `_${key}` : key;
}
