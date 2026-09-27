/**
 * Batches: the images one Generate click made, when it made more than one.
 *
 * Named `batch-001`, `batch-002`, … per project unless you type a name first,
 * and drawn in the library as one tinted group. Sheets and lone images are
 * not batches. Loop and chunk jobs become sets instead.
 *
 * Stored as the job's `folder` column and each image's `batch` field -- the
 * column predates real folders, which are a separate thing (see `Folder`).
 */

/** Whether a Generate click is a batch: several images, not a loop or chunk set. */
export function isBatch(input: { images: number; loop?: boolean; chunk?: boolean }): boolean {
  return input.images > 1 && !input.loop && !input.chunk;
}

const AUTO = /^batch-(\d+)$/;

/** The next free `batch-NNN`, after the highest one already used. */
export function nextBatchName(existing: Iterable<string>): string {
  let highest = 0;
  for (const name of existing) {
    const match = AUTO.exec(name.trim());
    if (match) highest = Math.max(highest, Number.parseInt(match[1], 10));
  }
  return `batch-${String(highest + 1).padStart(3, "0")}`;
}

export function batchesByJobId(jobs: Array<{ id: string; folder: string }>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const job of jobs) {
    const batch = job.folder.trim();
    if (batch) result[job.id] = batch;
  }
  return result;
}

export interface BatchGroup<T> {
  batch: string;
  items: T[];
}

export interface BatchSwatch {
  fill: string;
  stroke: string;
  label: string;
}

/** Muted tints that sit on the ink background without fighting the accent. */
export const BATCH_SWATCHES: BatchSwatch[] = [
  { fill: "rgba(56, 189, 248, 0.14)", stroke: "rgba(56, 189, 248, 0.42)", label: "#7dd3fc" },
  { fill: "rgba(167, 139, 250, 0.16)", stroke: "rgba(167, 139, 250, 0.45)", label: "#c4b5fd" },
  { fill: "rgba(251, 191, 36, 0.12)", stroke: "rgba(251, 191, 36, 0.42)", label: "#fcd34d" },
  { fill: "rgba(251, 113, 133, 0.14)", stroke: "rgba(244, 63, 94, 0.42)", label: "#fda4af" },
  { fill: "rgba(45, 212, 191, 0.12)", stroke: "rgba(45, 212, 191, 0.42)", label: "#5eead4" },
  { fill: "rgba(163, 230, 53, 0.12)", stroke: "rgba(163, 230, 53, 0.4)", label: "#bef264" },
  { fill: "rgba(251, 146, 60, 0.12)", stroke: "rgba(251, 146, 60, 0.42)", label: "#fdba74" },
  { fill: "rgba(129, 140, 248, 0.16)", stroke: "rgba(129, 140, 248, 0.45)", label: "#a5b4fc" }
];

export function batchSwatch(name: string): BatchSwatch {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return BATCH_SWATCHES[hash % BATCH_SWATCHES.length];
}

/**
 * Batches first (newest asset in the batch first), then the loose images.
 * Within a group, items stay in the order they arrived.
 */
export function groupByBatch<T extends { batch: string }>(items: T[]): BatchGroup<T>[] {
  const grouped = new Map<string, T[]>();

  for (const item of items) {
    const key = item.batch.trim();
    const existing = grouped.get(key);
    if (existing) existing.push(item);
    else grouped.set(key, [item]);
  }

  const batches = [...grouped.entries()]
    .filter(([batch]) => batch.length > 0)
    .map(([batch, groupItems]) => ({ batch, items: groupItems }));

  const loose = grouped.get("") ?? [];

  return loose.length > 0 ? [...batches, { batch: "", items: loose }] : batches;
}
