/**
 * Byte payloads crossing the storage boundary. Pinned to `ArrayBuffer` rather
 * than the default `ArrayBufferLike` so the results drop straight into `File`,
 * `Blob`, and `NextResponse` without a copy.
 */
export type Bytes = Uint8Array<ArrayBuffer>;

/** Node and the S3 SDK never hand back shared buffers. */
export function asBytes(input: Uint8Array): Bytes {
  return input as Bytes;
}

export interface StoredObject {
  key: string;
  size: number;
  modifiedAt: Date;
}

export interface PutOptions {
  contentType?: string;
  /** Passed through to the object store so reads can be cached at the edge. */
  cacheControl?: string;
}

/**
 * Every byte the app persists goes through this. Implementations must treat
 * keys as opaque, forward-slash separated paths and must never let a key
 * escape their own root.
 */
export interface Storage {
  put(key: string, bytes: Uint8Array, options?: PutOptions): Promise<void>;
  get(key: string): Promise<Bytes>;
  head(key: string): Promise<StoredObject | null>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
  list(prefix: string): Promise<StoredObject[]>;
  /** A URL the browser can fetch directly, valid for `ttlSeconds`. */
  signedUrl(key: string, ttlSeconds: number): Promise<string>;
}

export class ObjectNotFoundError extends Error {
  constructor(key: string) {
    super(`no object at ${key}`);
    this.name = "ObjectNotFoundError";
  }
}

/** Rejects absolute paths, traversal segments, and empty keys. */
export function assertSafeKey(key: string): string {
  if (!key || key.length === 0) throw new Error("storage key is required");
  if (key.startsWith("/") || key.includes("\\")) throw new Error(`unsafe storage key: ${key}`);

  const segments = key.split("/");
  for (const segment of segments) {
    if (segment === "" || segment === "." || segment === "..") {
      throw new Error(`unsafe storage key: ${key}`);
    }
  }

  return key;
}
