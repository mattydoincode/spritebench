import type { JobRecord } from "./model";

/**
 * Wall time a job has been (or was) running.
 *
 * Queued jobs have not started, so there is nothing to show. A running job
 * is measured against `now` so the chip can tick. A finished job freezes on
 * `finishedAt`, which is what you want to still see after it leaves the
 * queue.
 */
export function jobElapsedSeconds(job: JobRecord, now: number): number | null {
  if (job.status === "queued" || job.status === "blocked" || !job.startedAt) return null;

  const start = Date.parse(job.startedAt);
  if (!Number.isFinite(start)) return null;

  const end =
    job.status === "running" || !job.finishedAt ? now : Date.parse(job.finishedAt);

  if (!Number.isFinite(end)) return null;

  return Math.max(0, (end - start) / 1000);
}

/** Earliest start to latest end (or now, if anything is still running). */
export function batchElapsedSeconds(
  jobs: Array<Pick<JobRecord, "status" | "startedAt" | "finishedAt">>,
  now: number
): number | null {
  let start = Infinity;
  let end = -Infinity;
  let running = false;

  for (const job of jobs) {
    if (job.status === "queued" || job.status === "blocked" || !job.startedAt) continue;

    const begun = Date.parse(job.startedAt);
    if (!Number.isFinite(begun)) continue;

    start = Math.min(start, begun);

    if (job.status === "running" || !job.finishedAt) {
      running = true;
      continue;
    }

    const finished = Date.parse(job.finishedAt);
    if (Number.isFinite(finished)) end = Math.max(end, finished);
  }

  if (!Number.isFinite(start)) return null;

  const stop = running ? now : end;
  if (!Number.isFinite(stop)) return null;

  return Math.max(0, (stop - start) / 1000);
}

export function formatElapsed(seconds: number): string {
  const whole = Math.floor(seconds);
  if (whole < 60) return `${whole}s`;

  const minutes = Math.floor(whole / 60);
  const remainder = whole % 60;

  return `${minutes}m ${String(remainder).padStart(2, "0")}s`;
}
