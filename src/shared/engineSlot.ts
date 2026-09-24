export const ENGINE_SLOT_KINDS = ["node", "set_item", "set_bag"] as const;
export type EngineSlotKind = (typeof ENGINE_SLOT_KINDS)[number];

export const ENGINE_SLOT_INTENTS = ["texture", "sprite_frames", "textures"] as const;
export type EngineSlotIntent = (typeof ENGINE_SLOT_INTENTS)[number];

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
  assignedAssetIds: string[];
  localHash: string | null;
  lastPushedHash: string | null;
  remoteHash: string | null;
  status: EngineSlotStatus;
  lastSeenAt: string;
  tombstonedAt: string | null;
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
