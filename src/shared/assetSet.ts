import { isChunkSpec, isLoopSpec, type JobInputs, type ResolvedAsset } from "./model";
import { DEFAULT_FPS, NO_INSET, SET_FPS, type Sequence } from "./sequence";

/**
 * A loop or chunk job's outputs, grouped as one library object.
 *
 * Members stay real assets. The set is the thing you animate or lay back
 * onto the source grid. Batches are folders, not this.
 */

export type AssetSetKind = "animation" | "grid";
export type AssetSetView = "animate" | "grid";

export interface AssetSetMember {
  assetId: string;
  index: number;
  col: number;
  row: number;
}

export interface AssetSet {
  id: string;
  kind: AssetSetKind;
  columns: number;
  rows: number;
  view: AssetSetView;
  members: AssetSetMember[];
}

export function defaultSetView(kind: AssetSetKind): AssetSetView {
  return kind === "grid" ? "grid" : "animate";
}

export function slotFromIndex(index: number, columns: number): { col: number; row: number } {
  const cols = Math.max(1, Math.floor(columns) || 1);
  const cell = Math.max(0, Math.floor(index));
  return { col: cell % cols, row: Math.floor(cell / cols) };
}

export function faceId(set: Pick<AssetSet, "members">): string | null {
  if (set.members.length === 0) return null;
  return [...set.members].sort((left, right) => left.index - right.index)[0].assetId;
}

/** Face is always shown. Other members stay hidden until extracted. */
export function isLibraryVisible(
  assetId: string,
  hidden: boolean,
  set: Pick<AssetSet, "members"> | null
): boolean {
  if (!set) return true;
  if (faceId(set) === assetId) return true;
  return !hidden;
}

export function upsertMember(set: AssetSet, member: AssetSetMember): AssetSet {
  const existing = set.members.findIndex((entry) => entry.assetId === member.assetId);
  const members =
    existing >= 0
      ? set.members.map((entry, index) => (index === existing ? member : entry))
      : [...set.members, member];

  return {
    ...set,
    members: [...members].sort((left, right) => left.index - right.index)
  };
}

export function removeMember(set: AssetSet, assetId: string): AssetSet {
  return { ...set, members: set.members.filter((entry) => entry.assetId !== assetId) };
}

export function setByAssetId(sets: AssetSet[], assetId: string): AssetSet | null {
  return sets.find((entry) => entry.members.some((member) => member.assetId === assetId)) ?? null;
}

export interface SetSpec {
  kind: AssetSetKind;
  columns: number;
  rows: number;
  index: number;
  col: number;
  row: number;
}

/** Concrete loop/chunk job inputs become a set slot. Expanding requests do not. */
export function setSpecFromInputs(inputs: JobInputs | null | undefined): SetSpec | null {
  if (isLoopSpec(inputs?.loop)) {
    const columns = Math.max(1, Math.floor(inputs.loop.steps));
    const index = Math.max(0, Math.floor(inputs.loop.index) - 1);
    const slot = slotFromIndex(index, columns);
    return { kind: "animation", columns, rows: 1, index, ...slot };
  }

  if (isChunkSpec(inputs?.chunk)) {
    const columns = Math.max(1, Math.floor(inputs.chunk.columns));
    const rows = Math.max(1, Math.floor(inputs.chunk.rows));
    const index = Math.max(0, Math.floor(inputs.chunk.index));
    const slot = slotFromIndex(index, columns);
    return { kind: "grid", columns, rows, index, ...slot };
  }

  return null;
}

export function setIdForJob(job: { id: string; batchId: string | null }): string {
  return job.batchId ?? job.id;
}

export function sequenceFromSet(
  set: AssetSet,
  sizes: Record<string, { width: number; height: number }>
): Sequence {
  const ordered =
    set.view === "grid"
      ? [...set.members].sort((left, right) => left.row - right.row || left.col - right.col)
      : [...set.members].sort((left, right) => left.index - right.index);

  return {
    id: `set:${set.id}`,
    name: set.view === "grid" ? "tiles" : "loop",
    kind: set.view === "grid" ? "set" : "animation",
    fps: set.view === "grid" ? SET_FPS : DEFAULT_FPS,
    playback: "loop",
    inset: { ...NO_INSET },
    frames: ordered.map((member) => {
      const size = sizes[member.assetId];
      return {
        id: `set:${set.id}:${member.assetId}`,
        sourceAssetId: member.assetId,
        rect: {
          x: 0,
          y: 0,
          width: Math.max(1, size?.width ?? 1),
          height: Math.max(1, size?.height ?? 1)
        },
        edits: [],
        hold: 1
      };
    })
  };
}

export function setBadge(set: Pick<AssetSet, "kind" | "columns" | "rows" | "members">): string {
  if (set.kind === "grid") return `${set.columns}×${set.rows}`;
  return String(Math.max(set.members.length, set.columns));
}

/** Face gets the derived sequence. Other members keep their own. */
export function attachSet(
  asset: ResolvedAsset,
  set: AssetSet | null,
  sizes: Record<string, { width: number; height: number }>
): ResolvedAsset {
  if (!set) return asset;
  if (faceId(set) !== asset.id) return { ...asset, set };

  const derived = sequenceFromSet(set, sizes);
  return {
    ...asset,
    set,
    sequences: [derived, ...asset.sequences.filter((entry) => entry.id !== derived.id)]
  };
}
