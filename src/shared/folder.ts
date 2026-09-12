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
