import type { FolderGroup } from "./folder";
import type { JobRecord, JobStatus } from "./model";

export type LibraryAsset = {
  id: string;
  folder: string;
  createdAt: string;
  seq?: number;
  label: string;
  prompt: { body: string };
  tags: string[];
};

export type LibraryEntry<A extends LibraryAsset = LibraryAsset> =
  | { kind: "asset"; id: string; folder: string; createdAt: string; asset: A }
  | { kind: "job"; id: string; folder: string; createdAt: string; job: JobRecord };

/** Collapsed folders show this many thumbs, then a +N tile. */
export const FOLDER_PEEK = 3;

export type LibraryFolderCell = {
  type: "folder";
  folder: string;
  count: number;
  collapsed: boolean;
  overflow: boolean;
};

export type LibraryItemCell<T> = {
  type: "item";
  item: T;
};

export type LibraryCell<T> = LibraryFolderCell | LibraryItemCell<T>;

const FAILED: ReadonlySet<JobStatus> = new Set(["error", "cancelled"]);

export function isFailedJob(status: JobStatus): boolean {
  return FAILED.has(status);
}

export function isLibraryJob(job: Pick<JobRecord, "status">): boolean {
  return job.status !== "done";
}

/**
 * Assets plus in-flight / failed jobs. Done jobs disappear; their assets
 * take the slot.
 */
export function libraryItems<A extends LibraryAsset>(
  assets: A[],
  jobs: JobRecord[]
): LibraryEntry<A>[] {
  const entries: LibraryEntry<A>[] = [];

  for (const asset of assets) {
    entries.push({
      kind: "asset",
      id: asset.id,
      folder: asset.folder.trim(),
      createdAt: asset.createdAt,
      asset
    });
  }

  for (const job of jobs) {
    if (!isLibraryJob(job)) continue;
    entries.push({
      kind: "job",
      id: job.id,
      folder: job.folder.trim(),
      createdAt: job.createdAt,
      job
    });
  }

  return entries.sort((a, b) => {
    const byTime = b.createdAt.localeCompare(a.createdAt);
    if (byTime !== 0) return byTime;
    const seqA = a.kind === "asset" ? (a.asset.seq ?? 0) : 0;
    const seqB = b.kind === "asset" ? (b.asset.seq ?? 0) : 0;
    return seqB - seqA;
  });
}

export function libraryItemMatches(entry: LibraryEntry, needle: string): boolean {
  if (!needle) return true;

  if (entry.kind === "asset") {
    const asset = entry.asset;
    return (
      asset.label.toLowerCase().includes(needle) ||
      asset.prompt.body.toLowerCase().includes(needle) ||
      asset.tags.some((tag) => tag.toLowerCase().includes(needle))
    );
  }

  const job = entry.job;
  return (
    job.label.toLowerCase().includes(needle) ||
    job.prompt.body.toLowerCase().includes(needle) ||
    job.composedPrompt.toLowerCase().includes(needle) ||
    job.status.toLowerCase().includes(needle) ||
    (job.error ?? "").toLowerCase().includes(needle)
  );
}

/**
 * How many fixed-size thumbs fit in `width`. Unmeasured (width 0) is treated
 * as infinite so folders do not collapse to one tile on the first paint.
 */
export function columnCount(width: number, thumbSize: number, gap: number): number {
  if (width <= 0 || thumbSize <= 0) return Number.POSITIVE_INFINITY;
  return Math.max(1, Math.floor((width + gap) / (thumbSize + gap)));
}

/** Overflow folders start collapsed; a stored `false` means the user opened one. */
export function folderIsCollapsed(
  folder: string,
  itemCount: number,
  peek: number,
  collapsedFolders: Record<string, boolean>
): boolean {
  if (!folder || itemCount <= peek) return false;
  return collapsedFolders[folder] !== false;
}

/**
 * One cell stream: folder chip, then that folder's visible thumbs, then the
 * next group. Leftover cells on a row are just the next cells.
 */
export function flattenLibrary<T>(
  groups: FolderGroup<T>[],
  collapsedFolders: Record<string, boolean>,
  peek: number
): LibraryCell<T>[] {
  const cells: LibraryCell<T>[] = [];

  for (const group of groups) {
    if (group.folder) {
      const overflow = group.items.length > peek;
      const collapsed = folderIsCollapsed(
        group.folder,
        group.items.length,
        peek,
        collapsedFolders
      );
      cells.push({
        type: "folder",
        folder: group.folder,
        count: group.items.length,
        collapsed,
        overflow
      });
      const shown = collapsed ? group.items.slice(0, peek) : group.items;
      for (const item of shown) cells.push({ type: "item", item });
      continue;
    }

    for (const item of group.items) cells.push({ type: "item", item });
  }

  return cells;
}

/**
 * When a selected job lands `done`, follow it to the first asset. A dismissed
 * job drops out of the selection.
 */
export function remapSelection(
  selectedIds: string[],
  before: Array<Pick<JobRecord, "id" | "status" | "assetIds">>,
  after: Array<Pick<JobRecord, "id" | "status" | "assetIds">>
): string[] {
  const previous = new Map(before.map((job) => [job.id, job]));
  const next = new Map(after.map((job) => [job.id, job]));
  const result: string[] = [];

  const push = (id: string) => {
    if (!result.includes(id)) result.push(id);
  };

  for (const id of selectedIds) {
    const was = previous.get(id);
    const now = next.get(id);

    if (was && !now) continue;

    if (was && was.status !== "done" && now?.status === "done") {
      const assetId = now.assetIds[0];
      if (assetId) push(assetId);
      continue;
    }

    push(id);
  }

  return result;
}
