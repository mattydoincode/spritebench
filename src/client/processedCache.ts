import type { ProcessedPreview, SourceVariant } from "@/client/processor";

export const PROCESSED_CACHE_MAX_BYTES = 64 * 1024 * 1024;
export const PROCESSED_PERSIST_MS = 400;
export const PROCESSED_PERSIST_MAX_EDGE = 512;

const DB_NAME = "spritebench-processed";
const STORE = "previews";

export interface StoredProcessed {
  key: string;
  bytes: number;
  lastAccess: number;
}

export interface ProcessedCacheRecord {
  key: string;
  projectId: string;
  cacheKey: string;
  assetId: string;
  variant: SourceVariant;
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
  description: string;
  blob: Blob;
  bytes: number;
  lastAccess: number;
}

export function processedStoreKey(projectId: string, cacheKey: string): string {
  return `${projectId}/${cacheKey}`;
}

export function shouldPersistProcessed(
  variant: SourceVariant,
  width: number,
  height: number
): boolean {
  return variant === "thumb" || Math.max(width, height) <= PROCESSED_PERSIST_MAX_EDGE;
}

export function assetIdFromCacheKey(cacheKey: string): string {
  const at = cacheKey.indexOf(":");
  return at === -1 ? cacheKey : cacheKey.slice(0, at);
}

export function planEviction(
  entries: StoredProcessed[],
  incomingBytes: number,
  maxBytes: number
): string[] {
  let remaining = entries.reduce((sum, entry) => sum + entry.bytes, 0) + incomingBytes;
  if (remaining <= maxBytes) return [];

  const drop: string[] = [];
  const ordered = [...entries].sort((a, b) => a.lastAccess - b.lastAccess || a.key.localeCompare(b.key));

  for (const entry of ordered) {
    if (remaining <= maxBytes) break;
    drop.push(entry.key);
    remaining -= entry.bytes;
  }

  return drop;
}

const persistTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function schedulePersistProcessed(
  projectId: string,
  cacheKey: string,
  variant: SourceVariant,
  preview: ProcessedPreview
): void {
  if (!shouldPersistProcessed(variant, preview.width, preview.height)) return;
  if (typeof window === "undefined") return;

  const key = processedStoreKey(projectId, cacheKey);
  const existing = persistTimers.get(key);
  if (existing) clearTimeout(existing);

  persistTimers.set(
    key,
    setTimeout(() => {
      persistTimers.delete(key);
      void writeProcessedPreview(projectId, cacheKey, variant, preview);
    }, PROCESSED_PERSIST_MS)
  );
}

export function cancelPersistForAsset(projectId: string, assetId: string): void {
  const prefix = `${projectId}/${assetId}:`;
  for (const [key, timer] of persistTimers) {
    if (!key.startsWith(prefix)) continue;
    clearTimeout(timer);
    persistTimers.delete(key);
  }
}

export async function readProcessedPreview(
  projectId: string,
  cacheKey: string
): Promise<ProcessedPreview | null> {
  try {
    const db = await openProcessedDb();
    if (!db) return null;

    const record = await idbRequest<ProcessedCacheRecord | undefined>(
      db.transaction(STORE, "readonly").objectStore(STORE).get(processedStoreKey(projectId, cacheKey))
    );
    if (!record?.blob) return null;

    void touchProcessed(db, record);

    const processed = await createImageBitmap(record.blob, { premultiplyAlpha: "none" });
    if (!processedLive(processed)) {
      processed.close();
      return null;
    }

    return {
      processed,
      width: record.width,
      height: record.height,
      sourceWidth: record.sourceWidth,
      sourceHeight: record.sourceHeight,
      description: record.description
    };
  } catch {
    return null;
  }
}

export async function writeProcessedPreview(
  projectId: string,
  cacheKey: string,
  variant: SourceVariant,
  preview: ProcessedPreview
): Promise<void> {
  try {
    if (!shouldPersistProcessed(variant, preview.width, preview.height)) return;
    if (!processedLive(preview.processed)) return;

    const blob = await encodeProcessedPng(preview.processed, preview.width, preview.height);
    const bytes = blob.size;
    const key = processedStoreKey(projectId, cacheKey);
    const db = await openProcessedDb();
    if (!db) return;

    const store = db.transaction(STORE, "readwrite").objectStore(STORE);
    const existing = await idbAll<ProcessedCacheRecord>(store);
    const others = existing.filter((entry) => entry.key !== key);
    const evict = planEviction(
      others.map((entry) => ({ key: entry.key, bytes: entry.bytes, lastAccess: entry.lastAccess })),
      bytes,
      PROCESSED_CACHE_MAX_BYTES
    );

    const write = db.transaction(STORE, "readwrite").objectStore(STORE);
    for (const drop of evict) write.delete(drop);

    const record: ProcessedCacheRecord = {
      key,
      projectId,
      cacheKey,
      assetId: assetIdFromCacheKey(cacheKey),
      variant,
      width: preview.width,
      height: preview.height,
      sourceWidth: preview.sourceWidth,
      sourceHeight: preview.sourceHeight,
      description: preview.description,
      blob,
      bytes,
      lastAccess: Date.now()
    };
    write.put(record);
  } catch {
    // Quota, private mode, or a detached bitmap. Treat as a miss next time.
  }
}

export async function deleteProcessedForAsset(projectId: string, assetId: string): Promise<void> {
  cancelPersistForAsset(projectId, assetId);

  try {
    const db = await openProcessedDb();
    if (!db) return;

    const prefix = `${projectId}/${assetId}:`;
    const keys = await idbRequest<IDBValidKey[]>(
      db.transaction(STORE, "readonly").objectStore(STORE).getAllKeys()
    );
    const write = db.transaction(STORE, "readwrite").objectStore(STORE);
    for (const key of keys) {
      if (typeof key === "string" && key.startsWith(prefix)) write.delete(key);
    }
  } catch {
    // nothing to drop
  }
}

async function encodeProcessedPng(
  bitmap: ImageBitmap,
  width: number,
  height: number
): Promise<Blob> {
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("no 2d context available");
  context.drawImage(bitmap, 0, 0);
  return canvas.convertToBlob({ type: "image/png" });
}

async function touchProcessed(db: IDBDatabase, record: ProcessedCacheRecord): Promise<void> {
  try {
    record.lastAccess = Date.now();
    db.transaction(STORE, "readwrite").objectStore(STORE).put(record);
  } catch {
    // a failed touch leaves LRU a little stale
  }
}

function processedLive(bitmap: { width: number; height: number } | null | undefined): boolean {
  if (!bitmap) return false;
  try {
    return bitmap.width > 0 && bitmap.height > 0;
  } catch {
    return false;
  }
}

function openProcessedDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);

  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }).catch(() => null);
}

function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function idbAll<T>(store: IDBObjectStore): Promise<T[]> {
  return idbRequest(store.getAll()) as Promise<T[]>;
}
