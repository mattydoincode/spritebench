export const ENGINE_SLOT_KINDS = ["node", "set_item", "set_bag", "record_field"] as const;
export type EngineSlotKind = (typeof ENGINE_SLOT_KINDS)[number];

export const ENGINE_SLOT_INTENTS = ["texture", "sprite_frames", "textures"] as const;
export type EngineSlotIntent = (typeof ENGINE_SLOT_INTENTS)[number];

/**
 * Every slot holds two sets of art: the AI prototype and the artist's final.
 * SpriteBench stores both; the game decides which it pulls (a project-wide
 * plugin setting), taking a slot's final when it has one and falling back to
 * its prototype otherwise.
 */
export const ENGINE_LANES = ["prototype", "final"] as const;
export type EngineLane = (typeof ENGINE_LANES)[number];

export const ENGINE_SLOT_STATUSES = [
  "empty",
  "in_sync",
  "pull_available",
  "edited_in_godot",
  "conflict"
] as const;
export type EngineSlotStatus = (typeof ENGINE_SLOT_STATUSES)[number];

export interface EngineSlotRecord {
  id: string;
  kind: EngineSlotKind;
  intent: EngineSlotIntent;
  label: string;
  godotPath: string;
  /** The prototype lane's art. */
  assignedAssetIds: string[];
  /** The final lane's art. */
  finalAssetIds: string[];
  localHash: string | null;
  lastPushedHash: string | null;
  /** Export hash of the prototype lane. */
  remoteHash: string | null;
  /** Export hash of the final lane. */
  finalRemoteHash: string | null;
  /** The lane Godot is pulling for this slot; `status` is measured against it. */
  lane: EngineLane;
  status: EngineSlotStatus;
  lastSeenAt: string;
  tombstonedAt: string | null;
  /** Set for `record_field` slots. */
  recordId: string | null;
  fieldKey: string | null;
}

/** Arrays append unique ids. Stills and clips take the first incoming id. */
export function mergeSlotAssignment(
  intent: EngineSlotIntent,
  existing: readonly string[],
  incoming: readonly string[]
): string[] {
  const have = existing ?? [];
  const next = incoming.filter((id) => id.length > 0);
  if (next.length === 0) return [...have];
  if (intent !== "textures") return [next[0]];

  const seen = new Set(have);
  return [...have, ...next.filter((id) => !seen.has(id))];
}

/** Same rules as merge, but the incoming list is the whole assignment. */
export function replaceSlotAssignment(
  intent: EngineSlotIntent,
  incoming: readonly string[]
): string[] {
  const next = incoming.filter((id) => id.length > 0);
  if (intent !== "textures") return next.length > 0 ? [next[0]] : [];

  const seen = new Set<string>();
  const unique: string[] = [];
  for (const id of next) {
    if (seen.has(id)) continue;
    seen.add(id);
    unique.push(id);
  }
  return unique;
}

export function dropSlotAssignment(
  existing: readonly string[],
  remove: readonly string[]
): string[] {
  if (remove.length === 0) return [...existing];
  const drop = new Set(remove);
  return existing.filter((id) => !drop.has(id));
}

/** Moves one entry of an array assignment by `delta` places, clamped to the ends. */
export function moveSlotAssignment(
  existing: readonly string[],
  index: number,
  delta: number
): string[] {
  const next = [...existing];
  if (index < 0 || index >= next.length) return next;
  const to = Math.max(0, Math.min(next.length - 1, index + delta));
  const [moved] = next.splice(index, 1);
  next.splice(to, 0, moved);
  return next;
}

/**
 * Three hashes decide who last wrote the pixels.
 *
 * `local` is what Godot reports for the file on disk. `lastPushed` is what
 * the plugin last wrote from SpriteBench. `remote` is the current assigned
 * export, including an empty bag after the last array image is removed.
 * Missing hashes compare as empty strings so a brand-new slot with an
 * assignment is `pull_available`, not a conflict.
 */
export function deriveSlotStatus(input: {
  assignedAssetIds: readonly string[];
  localHash: string | null;
  lastPushedHash: string | null;
  remoteHash: string | null;
}): EngineSlotStatus {
  if (!input.remoteHash) return "empty";

  const local = input.localHash ?? "";
  const last = input.lastPushedHash ?? "";
  const remote = input.remoteHash;
  const localMatchesLast = local === last;
  const remoteMatchesLast = remote === last;

  if (localMatchesLast && remoteMatchesLast) return "in_sync";
  if (localMatchesLast && !remoteMatchesLast) return "pull_available";
  if (!localMatchesLast && remoteMatchesLast) return "edited_in_godot";
  return "conflict";
}

/** The lane Godot gets: final where the slot has one, when the game wants finals. */
export function servedLane(
  slot: { finalAssetIds: readonly string[] },
  gameLane: EngineLane
): EngineLane {
  return gameLane === "final" && slot.finalAssetIds.length > 0 ? "final" : "prototype";
}

export function laneAssetIds(
  slot: { assignedAssetIds: readonly string[]; finalAssetIds: readonly string[] },
  lane: EngineLane
): string[] {
  return [...(lane === "final" ? slot.finalAssetIds : slot.assignedAssetIds)];
}

export function laneRemoteHash(
  slot: { remoteHash: string | null; finalRemoteHash: string | null },
  lane: EngineLane
): string | null {
  return lane === "final" ? slot.finalRemoteHash : slot.remoteHash;
}

/** Where a lane's exported files live, so the two lanes never overwrite each other. */
export function laneStorageId(slotId: string, lane: EngineLane): string {
  return lane === "final" ? `${slotId}-final` : slotId;
}

/** A (slot, lane) pair as one string: the edit queue's key and the sync banner's item. */
export function laneKey(slotId: string, lane: EngineLane): string {
  return `${slotId}|${lane}`;
}

export function parseLaneKey(key: string): { slotId: string; lane: EngineLane } {
  const [slotId, lane] = key.split("|");
  return { slotId, lane: lane === "final" ? "final" : "prototype" };
}

/**
 * Where a lane's export fingerprint is recorded. The prototype lane keeps the
 * bare slot id it always had.
 */
export function laneFingerprintKey(slotId: string, lane: EngineLane): string {
  return lane === "final" ? `${slotId}|final` : slotId;
}
