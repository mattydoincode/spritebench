/**
 * Where a generation's assets land in the library.
 *
 * The typed value wins. Batches and sheets get a fallback so they do not
 * dump a pile of untitled images into the loose grid. Loop and chunk jobs
 * become sets, not folders.
 */

export function suggestedFolder(input: {
  animation?: boolean;
  itemGrid?: boolean;
  many?: boolean;
}): string {
  if (input.animation) return "anim";
  if (input.itemGrid) return "grid";
  if (input.many) return "batch";
  return "";
}

export function resolveJobFolder(typed: string, suggested: string): string {
  return typed.trim() || suggested;
}

export function foldersByJobId(jobs: Array<{ id: string; folder: string }>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const job of jobs) {
    const folder = job.folder.trim();
    if (folder) result[job.id] = folder;
  }
  return result;
}

export interface FolderGroup<T> {
  folder: string;
  items: T[];
}

export interface FolderSwatch {
  fill: string;
  stroke: string;
  label: string;
}

/** Muted tints that sit on the ink background without fighting the accent. */
export const FOLDER_SWATCHES: FolderSwatch[] = [
  { fill: "rgba(56, 189, 248, 0.14)", stroke: "rgba(56, 189, 248, 0.42)", label: "#7dd3fc" },
  { fill: "rgba(167, 139, 250, 0.16)", stroke: "rgba(167, 139, 250, 0.45)", label: "#c4b5fd" },
  { fill: "rgba(251, 191, 36, 0.12)", stroke: "rgba(251, 191, 36, 0.42)", label: "#fcd34d" },
  { fill: "rgba(251, 113, 133, 0.14)", stroke: "rgba(244, 63, 94, 0.42)", label: "#fda4af" },
  { fill: "rgba(45, 212, 191, 0.12)", stroke: "rgba(45, 212, 191, 0.42)", label: "#5eead4" },
  { fill: "rgba(163, 230, 53, 0.12)", stroke: "rgba(163, 230, 53, 0.4)", label: "#bef264" },
  { fill: "rgba(251, 146, 60, 0.12)", stroke: "rgba(251, 146, 60, 0.42)", label: "#fdba74" },
  { fill: "rgba(129, 140, 248, 0.16)", stroke: "rgba(129, 140, 248, 0.45)", label: "#a5b4fc" }
];

export function folderSwatch(name: string): FolderSwatch {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return FOLDER_SWATCHES[hash % FOLDER_SWATCHES.length];
}

/**
 * Folders first (newest asset in the folder first), then the ungrouped pile.
 * Within a group, items stay in the order they arrived.
 */
export function groupByFolder<T extends { folder: string }>(items: T[]): FolderGroup<T>[] {
  const grouped = new Map<string, T[]>();

  for (const item of items) {
    const key = item.folder.trim();
    const existing = grouped.get(key);
    if (existing) existing.push(item);
    else grouped.set(key, [item]);
  }

  const folders = [...grouped.entries()]
    .filter(([folder]) => folder.length > 0)
    .map(([folder, groupItems]) => ({ folder, items: groupItems }));

  const loose = grouped.get("") ?? [];

  return loose.length > 0 ? [...folders, { folder: "", items: loose }] : folders;
}
