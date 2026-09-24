import { absoluteUrl, sourceUrl } from "@/client/api";
import {
  deleteProcessedForAsset,
  readProcessedPreview,
  schedulePersistProcessed
} from "@/client/processedCache";
import {
  cancelPending,
  emptyProcessQueue,
  enqueueProcess,
  finishProcessJob,
  clampProcessWorkers,
  DEFAULT_PROCESS_WORKERS,
  PROCESS_PRIORITY,
  startProcessJobs,
  toProcessSnapshot,
  upgradeProcess,
  type ProcessJob,
  type ProcessQueueSnapshot,
  type ProcessQueueState
} from "@/client/processQueue";
import { hashPalette, hashSettings, type ProcessingSettings } from "@/core/settings";
import type { Rgb, Size } from "@/core/types";

export { PROCESS_PRIORITY } from "@/client/processQueue";

export interface ProcessedPreview {
  processed: ImageBitmap;
  sourceBitmap?: ImageBitmap;
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
  description: string;
}

/**
 * ImageBitmap.close() zeroes width/height; some engines throw instead.
 * A transferred bitmap also goes dead if the worker that minted it is torn
 * down, which can happen when leaving the project page.
 */
export function bitmapLive(
  bitmap: { width: number; height: number } | null | undefined
): boolean {
  if (!bitmap) return false;

  try {
    return bitmap.width > 0 && bitmap.height > 0;
  } catch {
    return false;
  }
}

export function previewUsable(
  preview: ProcessedPreview | null | undefined,
  wantSource: boolean
): preview is ProcessedPreview {
  if (!preview || !bitmapLive(preview.processed)) return false;
  return !wantSource || bitmapLive(preview.sourceBitmap);
}

export class ProcessCancelledError extends Error {
  constructor() {
    super("process cancelled");
    this.name = "ProcessCancelledError";
  }
}

export function isProcessCancelled(error: unknown): boolean {
  return error instanceof ProcessCancelledError;
}

function closeBitmap(bitmap: ImageBitmap | undefined): void {
  if (!bitmap) return;

  try {
    bitmap.close();
  } catch {
    // already detached
  }
}

interface Pending {
  resolve: (value: ProcessedPreview) => void;
  reject: (reason: Error) => void;
}

interface JobPayload {
  sourceUrl: string;
  settings: ProcessingSettings;
  palette: Rgb[];
  sourceSize?: Size;
}

/**
 * Bitmaps to keep. Sized for a library page plus a couple of open sequences:
 * a sixteen-frame animation is sixteen entries, and at sixty the inspector
 * would evict the library grid every time you scrubbed.
 */
const MAX_CACHED = 180;

/**
 * Which stored image to run the pipeline over. `thumb` is a small WebP
 * generated on ingest; the library grid draws 96-pixel squares and has no
 * business downloading multi-megabyte sources to do it. Crops and erode stay
 * in source pixels; the worker maps them onto the decoded size.
 */
export type SourceVariant = "source" | "thumb";

class Processor {
  private workers: Worker[] = [];
  private busy = new Set<Worker>();
  private assigned = new Map<number, Worker>();
  private workerCount = DEFAULT_PROCESS_WORKERS;
  private nextRequestId = 1;
  private pending = new Map<number, Pending>();
  private payloads = new Map<number, JobPayload>();
  private cache = new Map<string, ProcessedPreview>();
  private inFlight = new Map<string, Promise<ProcessedPreview>>();
  private queue: ProcessQueueState = emptyProcessQueue();
  private queueSnapshot: ProcessQueueSnapshot = toProcessSnapshot(this.queue);
  private queueListeners = new Set<() => void>();
  private keyListeners = new Map<string, Set<(preview: ProcessedPreview) => void>>();
  private aborts = new Map<string, AbortController>();
  private pumpScheduled = false;

  subscribeQueue = (listener: () => void): (() => void) => {
    this.queueListeners.add(listener);
    return () => {
      this.queueListeners.delete(listener);
    };
  };

  getQueueSnapshot = (): ProcessQueueSnapshot => this.queueSnapshot;

  subscribe(cacheKey: string, listener: (preview: ProcessedPreview) => void): () => void {
    let listeners = this.keyListeners.get(cacheKey);
    if (!listeners) {
      listeners = new Set();
      this.keyListeners.set(cacheKey, listeners);
    }
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.keyListeners.delete(cacheKey);
    };
  }

  private setQueue(queue: ProcessQueueState): void {
    this.queue = queue;
    this.queueSnapshot = toProcessSnapshot(queue);
    for (const listener of this.queueListeners) listener();
  }

  private notifyKey(cacheKey: string, preview: ProcessedPreview): void {
    const listeners = this.keyListeners.get(cacheKey);
    if (!listeners) return;
    for (const listener of listeners) listener(preview);
  }

  setWorkers(count: number): void {
    this.workerCount = clampProcessWorkers(count);
    this.resizePool();
    this.schedulePump();
  }

  private spawnWorker(): Worker {
    const worker = new Worker(new URL("../workers/process.worker.ts", import.meta.url), {
      type: "module"
    });

    worker.onmessage = (event: MessageEvent) => {
      const message = event.data;
      this.assigned.delete(message.requestId);
      this.busy.delete(worker);

      const entry = this.pending.get(message.requestId);
      if (!entry) {
        this.resizePool();
        this.schedulePump();
        return;
      }

      this.pending.delete(message.requestId);
      this.payloads.delete(message.requestId);

      if (message.type === "error") {
        this.setQueue(finishProcessJob(this.queue, message.requestId, "error", Date.now(), message.message));
        entry.reject(new Error(message.message));
        this.resizePool();
        this.schedulePump();
        return;
      }

      this.setQueue(finishProcessJob(this.queue, message.requestId, "done", Date.now()));
      entry.resolve({
        processed: message.processed,
        sourceBitmap: message.sourceBitmap,
        width: message.width,
        height: message.height,
        sourceWidth: message.sourceWidth,
        sourceHeight: message.sourceHeight,
        description: message.description
      });
      this.resizePool();
      this.schedulePump();
    };

    worker.onerror = () => this.failWorker(worker, new Error("processor worker failed"));
    return worker;
  }

  private resizePool(): void {
    while (this.workers.length < this.workerCount) {
      this.workers.push(this.spawnWorker());
    }

    for (let index = this.workers.length - 1; index >= 0 && this.workers.length > this.workerCount; index--) {
      const worker = this.workers[index];
      if (!worker || this.busy.has(worker)) continue;
      this.terminateWorker(worker);
    }
  }

  private terminateWorker(worker: Worker): void {
    this.workers = this.workers.filter((entry) => entry !== worker);
    this.busy.delete(worker);
    try {
      worker.terminate();
    } catch {
      // already dead
    }
  }

  private failWorker(worker: Worker, error: Error): void {
    const ids = [...this.assigned.entries()]
      .filter(([, assigned]) => assigned === worker)
      .map(([id]) => id);

    this.terminateWorker(worker);

    for (const id of ids) {
      this.assigned.delete(id);
      const entry = this.pending.get(id);
      this.pending.delete(id);
      this.payloads.delete(id);
      this.setQueue(finishProcessJob(this.queue, id, "error", Date.now(), error.message));
      entry?.reject(error);
    }

    this.resizePool();
    this.schedulePump();
  }

  cacheKeyFor(
    assetId: string,
    settings: ProcessingSettings,
    palette: ReadonlyArray<Rgb>,
    variant: SourceVariant = "source"
  ): string {
    return `${assetId}:${variant}:${hashSettings(settings)}:${hashPalette(palette)}`;
  }

  peek(cacheKey: string): ProcessedPreview | undefined {
    const cached = this.cache.get(cacheKey);
    if (!cached) return undefined;

    if (!bitmapLive(cached.processed)) {
      this.cache.delete(cacheKey);
      return undefined;
    }

    if (cached.sourceBitmap && !bitmapLive(cached.sourceBitmap)) {
      delete cached.sourceBitmap;
    }

    return cached;
  }

  async process(
    projectId: string,
    assetId: string,
    settings: ProcessingSettings,
    palette: Rgb[],
    wantSource = false,
    variant: SourceVariant = "source",
    sourceSize?: Size,
    priority: number = PROCESS_PRIORITY.background
  ): Promise<ProcessedPreview> {
    return this.request(
      projectId,
      assetId,
      settings,
      palette,
      wantSource,
      variant,
      sourceSize,
      priority,
      true
    );
  }

  cancel(cacheKey: string): void {
    const running = this.queue.active.some((job) => job.cacheKey === cacheKey);
    if (!running) this.aborts.get(cacheKey)?.abort();

    const pendingJobs = this.queue.pending.filter((job) => job.cacheKey === cacheKey);
    if (pendingJobs.length === 0) return;

    for (const job of pendingJobs) {
      const entry = this.pending.get(job.id);
      this.pending.delete(job.id);
      this.payloads.delete(job.id);
      entry?.reject(new ProcessCancelledError());
    }

    this.inFlight.delete(cacheKey);
    this.setQueue(cancelPending(this.queue, [cacheKey]));
  }

  private request(
    projectId: string,
    assetId: string,
    settings: ProcessingSettings,
    palette: Rgb[],
    wantSource: boolean,
    variant: SourceVariant,
    sourceSize: Size | undefined,
    priority: number,
    allowRetry: boolean
  ): Promise<ProcessedPreview> {
    const cacheKey = this.cacheKeyFor(assetId, settings, palette, variant);

    const cached = this.peek(cacheKey);
    if (previewUsable(cached, wantSource)) return Promise.resolve(cached);

    const existing = this.inFlight.get(cacheKey);
    if (existing) {
      this.setQueue(upgradeProcess(this.queue, cacheKey, wantSource, priority));
      return existing.then((result) => {
        if (previewUsable(result, wantSource) || !allowRetry) return result;
        return this.request(
          projectId,
          assetId,
          settings,
          palette,
          wantSource,
          variant,
          sourceSize,
          priority,
          false
        );
      });
    }

    const promise = this.runRequest(
      projectId,
      assetId,
      cacheKey,
      settings,
      palette,
      wantSource,
      variant,
      sourceSize,
      priority
    );
    this.inFlight.set(cacheKey, promise);
    void promise.finally(() => {
      if (this.inFlight.get(cacheKey) === promise) this.inFlight.delete(cacheKey);
    });
    return promise;
  }

  private async runRequest(
    projectId: string,
    assetId: string,
    cacheKey: string,
    settings: ProcessingSettings,
    palette: Rgb[],
    wantSource: boolean,
    variant: SourceVariant,
    sourceSize: Size | undefined,
    priority: number
  ): Promise<ProcessedPreview> {
    const abort = new AbortController();
    this.aborts.set(cacheKey, abort);

    try {
      const hydrated = await readProcessedPreview(projectId, cacheKey);
      if (abort.signal.aborted) throw new ProcessCancelledError();

      if (hydrated && bitmapLive(hydrated.processed)) {
        this.remember(cacheKey, hydrated);
        this.notifyKey(cacheKey, hydrated);
        if (previewUsable(hydrated, wantSource)) return hydrated;
      }

      if (abort.signal.aborted) throw new ProcessCancelledError();

      return await this.enqueueWorker(
        projectId,
        assetId,
        cacheKey,
        settings,
        palette,
        wantSource,
        variant,
        sourceSize,
        priority,
        Boolean(hydrated)
      );
    } finally {
      if (this.aborts.get(cacheKey) === abort) this.aborts.delete(cacheKey);
    }
  }

  private remember(cacheKey: string, result: ProcessedPreview): void {
    // Drop the lookup, not the bitmap. React still draws entries that
    // just fell out of the cache; close() would detach them and the
    // next canvas paint — typically a remount after leaving the project
    // page — throws InvalidStateError.
    if (this.cache.size >= MAX_CACHED && !this.cache.has(cacheKey)) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }

    this.cache.set(cacheKey, result);
  }

  private enqueueWorker(
    projectId: string,
    assetId: string,
    cacheKey: string,
    settings: ProcessingSettings,
    palette: Rgb[],
    wantSource: boolean,
    variant: SourceVariant,
    sourceSize: Size | undefined,
    priority: number,
    skipPersist: boolean
  ): Promise<ProcessedPreview> {
    const requestId = this.nextRequestId++;
    const url = absoluteUrl(sourceUrl(projectId, assetId, variant), window.location.origin);
    const job: ProcessJob = {
      id: requestId,
      cacheKey,
      assetId,
      variant,
      wantSource,
      priority,
      status: "pending",
      queuedAt: Date.now()
    };

    const promise = new Promise<ProcessedPreview>((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      this.payloads.set(requestId, { sourceUrl: url, settings, palette, sourceSize });
    })
      .then((result) => {
        if (!bitmapLive(result.processed)) {
          throw new Error("processor returned a detached bitmap");
        }

        this.remember(cacheKey, result);
        this.notifyKey(cacheKey, result);
        if (!skipPersist) schedulePersistProcessed(projectId, cacheKey, variant, result);
        return result;
      })
      .catch((error) => {
        if (this.pending.has(requestId)) {
          this.pending.delete(requestId);
          this.payloads.delete(requestId);
          this.setQueue(finishProcessJob(this.queue, requestId, "error", Date.now(), error.message));
          this.schedulePump();
        }
        throw error;
      });

    this.setQueue(enqueueProcess(this.queue, job));
    this.schedulePump();
    return promise;
  }

  private schedulePump(): void {
    if (this.pumpScheduled) return;
    this.pumpScheduled = true;
    queueMicrotask(() => {
      this.pumpScheduled = false;
      this.pump();
    });
  }

  private pump(): void {
    this.resizePool();
    const free = this.workers.filter((worker) => !this.busy.has(worker));
    const { state, started } = startProcessJobs(
      this.queue,
      this.queue.active.length + free.length,
      Date.now()
    );
    if (started.length === 0) return;

    this.setQueue(state);

    for (const [index, job] of started.entries()) {
      const worker = free[index];
      const payload = this.payloads.get(job.id);
      const entry = this.pending.get(job.id);
      if (!worker || !payload || !entry) continue;

      this.busy.add(worker);
      this.assigned.set(job.id, worker);

      try {
        worker.postMessage({
          type: "process",
          requestId: job.id,
          cacheKey: job.cacheKey,
          sourceUrl: payload.sourceUrl,
          settings: payload.settings,
          palette: payload.palette,
          wantSource: job.wantSource,
          sourceSize: payload.sourceSize
        });
      } catch (error) {
        this.failWorker(worker, error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  /** Drops both variants of an asset, in the workers, RAM, and IndexedDB. */
  evictAsset(projectId: string, assetId: string): void {
    for (const variant of ["source", "thumb"] as const) {
      const cacheKey = absoluteUrl(sourceUrl(projectId, assetId, variant), window.location.origin);
      for (const worker of [...this.workers]) {
        try {
          worker.postMessage({ type: "evict", cacheKey });
        } catch {
          this.failWorker(worker, new Error("processor worker failed"));
        }
      }
    }

    for (const key of [...this.cache.keys()]) {
      if (!key.startsWith(`${assetId}:`)) continue;

      const entry = this.cache.get(key);
      closeBitmap(entry?.processed);
      closeBitmap(entry?.sourceBitmap);
      this.cache.delete(key);
    }

    void deleteProcessedForAsset(projectId, assetId);
  }
}

export const processor = new Processor();
