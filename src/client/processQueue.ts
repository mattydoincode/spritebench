export type ProcessVariant = "source" | "thumb";

export type ProcessJobStatus = "pending" | "running" | "done" | "error";

export const PROCESS_CONCURRENCY = 2;
export const DEFAULT_PROCESS_WORKERS = PROCESS_CONCURRENCY;
export const MIN_PROCESS_WORKERS = 1;
export const MAX_PROCESS_WORKERS = 8;
export const PROCESS_RECENT = 16;

export function clampProcessWorkers(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_PROCESS_WORKERS;
  return Math.min(MAX_PROCESS_WORKERS, Math.max(MIN_PROCESS_WORKERS, Math.round(parsed)));
}

export const PROCESS_PRIORITY = {
  background: 0,
  visible: 1,
  selected: 2
} as const;

export interface ProcessJob {
  id: number;
  cacheKey: string;
  assetId: string;
  variant: ProcessVariant;
  wantSource: boolean;
  priority: number;
  status: ProcessJobStatus;
  queuedAt: number;
  startedAt?: number;
  finishedAt?: number;
  error?: string;
}

export interface ProcessQueueState {
  pending: ProcessJob[];
  active: ProcessJob[];
  recent: ProcessJob[];
}

export interface ProcessQueueSnapshot {
  pending: ProcessJob[];
  active: ProcessJob[];
  recent: ProcessJob[];
}

export function emptyProcessQueue(): ProcessQueueState {
  return { pending: [], active: [], recent: [] };
}

export function toProcessSnapshot(state: ProcessQueueState): ProcessQueueSnapshot {
  return {
    pending: state.pending,
    active: state.active,
    recent: state.recent
  };
}

export function processQueueCount(snapshot: ProcessQueueSnapshot): number {
  return snapshot.pending.length + snapshot.active.length;
}

export function describeProcessQueue(snapshot: ProcessQueueSnapshot): string {
  const active = snapshot.active.length;
  const pending = snapshot.pending.length;
  const total = active + pending;
  if (total === 0) return "idle";
  if (active > 0 && pending > 0) return `${active} processing · ${pending} queued`;
  return total === 1 ? "1 processing" : `${total} processing`;
}

export function sortPending(pending: ProcessJob[]): ProcessJob[] {
  return [...pending].sort((a, b) => b.priority - a.priority || a.id - b.id);
}

export function enqueueProcess(state: ProcessQueueState, job: ProcessJob): ProcessQueueState {
  return {
    ...state,
    pending: sortPending([...state.pending, { ...job, status: "pending" }])
  };
}

export function cancelPending(state: ProcessQueueState, cacheKeys: string[]): ProcessQueueState {
  if (cacheKeys.length === 0) return state;
  const drop = new Set(cacheKeys);
  const pending = state.pending.filter((job) => !drop.has(job.cacheKey));
  if (pending.length === state.pending.length) return state;
  return { ...state, pending };
}

export function upgradeProcess(
  state: ProcessQueueState,
  cacheKey: string,
  wantSource: boolean,
  priority: number
): ProcessQueueState {
  let changed = false;
  const pending = state.pending.map((job) => {
    if (job.cacheKey !== cacheKey) return job;
    const nextWant = job.wantSource || wantSource;
    const nextPriority = Math.max(job.priority, priority);
    if (nextWant === job.wantSource && nextPriority === job.priority) return job;
    changed = true;
    return { ...job, wantSource: nextWant, priority: nextPriority };
  });

  return changed ? { ...state, pending: sortPending(pending) } : state;
}

export function startProcessJobs(
  state: ProcessQueueState,
  concurrency = PROCESS_CONCURRENCY,
  now = 0
): { state: ProcessQueueState; started: ProcessJob[] } {
  const pending = [...state.pending];
  const active = [...state.active];
  const started: ProcessJob[] = [];

  while (active.length < concurrency && pending.length > 0) {
    const job = pending.shift();
    if (!job) break;
    const running: ProcessJob = { ...job, status: "running", startedAt: now };
    active.push(running);
    started.push(running);
  }

  return { state: { ...state, pending, active }, started };
}

export function finishProcessJob(
  state: ProcessQueueState,
  id: number,
  result: "done" | "error",
  now = 0,
  error?: string
): ProcessQueueState {
  const job =
    state.active.find((entry) => entry.id === id) ?? state.pending.find((entry) => entry.id === id);
  if (!job) return state;

  const finished: ProcessJob = {
    ...job,
    status: result,
    finishedAt: now,
    error
  };

  return {
    pending: state.pending.filter((entry) => entry.id !== id),
    active: state.active.filter((entry) => entry.id !== id),
    recent: [finished, ...state.recent].slice(0, PROCESS_RECENT)
  };
}

export function processJobElapsed(job: ProcessJob, now: number): number | null {
  const start = job.startedAt;
  if (start === undefined) return null;
  const end = job.finishedAt ?? now;
  return Math.max(0, (end - start) / 1000);
}

export function describeProcessElapsed(seconds: number | null): string {
  if (seconds === null) return "";
  if (seconds < 1) return "<1s";
  return `${Math.round(seconds)}s`;
}
