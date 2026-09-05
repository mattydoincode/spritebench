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

const MAX_CACHED = 60;

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

  cacheKeyFor(assetId: string, settings: ProcessingSettings, paletteLength: number): string {
    return `${assetId}:${hashSettings(settings)}:${paletteLength}`;
  }

  peek(cacheKey: string): ProcessedPreview | undefined {
    return this.cache.get(cacheKey);
  }

  async process(
    assetId: string,
    sourceUrl: string,
    settings: ProcessingSettings,
    palette: Rgb[],
    wantSource = false
  ): Promise<ProcessedPreview> {
    const cacheKey = this.cacheKeyFor(assetId, settings, palette.length);

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
        sourceUrl,
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

  evictSource(sourceUrl: string): void {
    this.worker?.postMessage({ type: "evict", cacheKey: sourceUrl });

    for (const key of [...this.cache.keys()]) {
      if (key.startsWith(`${sourceUrl}:`)) this.cache.delete(key);
    }
  }
}

export const processor = new Processor();
