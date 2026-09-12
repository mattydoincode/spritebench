import { sourceUrl } from "@/client/api";
import { hashSettings, type ProcessingSettings } from "@/core/settings";
import type { Rgb } from "@/core/types";

export interface ProcessedPreview {
  processed: ImageBitmap;
  sourceBitmap?: ImageBitmap;
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
  description: string;
}

interface Pending {
  resolve: (value: ProcessedPreview) => void;
  reject: (reason: Error) => void;
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
 * business downloading multi-megabyte sources to do it.
 */
export type SourceVariant = "source" | "thumb";

class Processor {
  private worker: Worker | null = null;
  private nextRequestId = 1;
  private pending = new Map<number, Pending>();
  private cache = new Map<string, ProcessedPreview>();
  private inFlight = new Map<string, Promise<ProcessedPreview>>();

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;

    const worker = new Worker(new URL("../workers/process.worker.ts", import.meta.url), {
      type: "module"
    });

    worker.onmessage = (event: MessageEvent) => {
      const message = event.data;
      const entry = this.pending.get(message.requestId);
      if (!entry) return;

      this.pending.delete(message.requestId);

      if (message.type === "error") {
        entry.reject(new Error(message.message));
        return;
      }

      entry.resolve({
        processed: message.processed,
        sourceBitmap: message.sourceBitmap,
        width: message.width,
        height: message.height,
        sourceWidth: message.sourceWidth,
        sourceHeight: message.sourceHeight,
        description: message.description
      });
    };

    this.worker = worker;
    return worker;
  }

  cacheKeyFor(
    assetId: string,
    settings: ProcessingSettings,
    paletteLength: number,
    variant: SourceVariant = "source"
  ): string {
    return `${assetId}:${variant}:${hashSettings(settings)}:${paletteLength}`;
  }

  peek(cacheKey: string): ProcessedPreview | undefined {
    return this.cache.get(cacheKey);
  }

  async process(
    projectId: string,
    assetId: string,
    settings: ProcessingSettings,
    palette: Rgb[],
    wantSource = false,
    variant: SourceVariant = "source"
  ): Promise<ProcessedPreview> {
    const cacheKey = this.cacheKeyFor(assetId, settings, palette.length, variant);
    const url = sourceUrl(projectId, assetId, variant);

    const cached = this.cache.get(cacheKey);
    if (cached && (!wantSource || cached.sourceBitmap)) return cached;

    const existing = this.inFlight.get(cacheKey);
    if (existing) return existing;

    const worker = this.ensureWorker();
    const requestId = this.nextRequestId++;

    const promise = new Promise<ProcessedPreview>((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      worker.postMessage({
        type: "process",
        requestId,
        cacheKey,
        sourceUrl: url,
        settings,
        palette,
        wantSource
      });
    })
      .then((result) => {
        if (this.cache.size >= MAX_CACHED) {
          const oldest = this.cache.keys().next().value;
          if (oldest !== undefined) {
            this.cache.get(oldest)?.processed.close();
            this.cache.delete(oldest);
          }
        }
        this.cache.set(cacheKey, result);
        return result;
      })
      .finally(() => {
        this.inFlight.delete(cacheKey);
      });

    this.inFlight.set(cacheKey, promise);
    return promise;
  }

  /** Drops both variants of an asset, in the worker and in the bitmap cache. */
  evictAsset(projectId: string, assetId: string): void {
    for (const variant of ["source", "thumb"] as const) {
      this.worker?.postMessage({
        type: "evict",
        cacheKey: sourceUrl(projectId, assetId, variant)
      });
    }

    for (const key of [...this.cache.keys()]) {
      if (!key.startsWith(`${assetId}:`)) continue;

      this.cache.get(key)?.processed.close();
      this.cache.delete(key);
    }
  }
}

export const processor = new Processor();
