import fs from "node:fs/promises";
import path from "node:path";
import {
  ObjectNotFoundError,
  asBytes,
  assertSafeKey,
  type Bytes,
  type PutOptions,
  type Storage,
  type StoredObject
} from "./types";

function isMissing(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === "ENOENT";
}

/**
 * Filesystem-backed storage, used for local development and self-hosting.
 * Signed URLs point at the app's own storage route rather than an object store.
 */
export class LocalFsStorage implements Storage {
  constructor(private readonly root: string) {}

  private resolve(key: string): string {
    const full = path.resolve(this.root, assertSafeKey(key));

    // Defence in depth: assertSafeKey already rejects traversal, but a symlink
    // inside the root could still point out of it.
    if (full !== this.root && !full.startsWith(this.root + path.sep)) {
      throw new Error(`storage key escapes the data directory: ${key}`);
    }

    return full;
  }

  async put(key: string, bytes: Uint8Array, _options?: PutOptions): Promise<void> {
    const full = this.resolve(key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, bytes);
  }

  async get(key: string): Promise<Bytes> {
    try {
      return asBytes(await fs.readFile(this.resolve(key)));
    } catch (error) {
      if (isMissing(error)) throw new ObjectNotFoundError(key);
      throw error;
    }
  }

  async head(key: string): Promise<StoredObject | null> {
    try {
      const stat = await fs.stat(this.resolve(key));
      if (!stat.isFile()) return null;

      return { key, size: stat.size, modifiedAt: stat.mtime };
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }

  async exists(key: string): Promise<boolean> {
    return (await this.head(key)) !== null;
  }

  async delete(key: string): Promise<void> {
    try {
      await fs.unlink(this.resolve(key));
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
  }

  async list(prefix: string): Promise<StoredObject[]> {
    // Prefixes are directory-shaped in practice, so walk the directory the
    // prefix names and filter on the way out.
    const normalized = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
    const base = normalized.length > 0 ? this.resolve(normalized) : this.root;
    const out: StoredObject[] = [];

    const walk = async (dir: string, keyPrefix: string): Promise<void> => {
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch (error) {
        if (isMissing(error)) return;
        throw error;
      }

      for (const entry of entries) {
        const childKey = keyPrefix.length > 0 ? `${keyPrefix}/${entry.name}` : entry.name;

        if (entry.isDirectory()) {
          await walk(path.join(dir, entry.name), childKey);
          continue;
        }
        if (!entry.isFile()) continue;

        const stat = await fs.stat(path.join(dir, entry.name));
        out.push({ key: childKey, size: stat.size, modifiedAt: stat.mtime });
      }
    };

    await walk(base, normalized);
    return out.sort((a, b) => a.key.localeCompare(b.key));
  }

  async signedUrl(key: string, _ttlSeconds: number): Promise<string> {
    assertSafeKey(key);
    return `/api/storage/${key.split("/").map(encodeURIComponent).join("/")}`;
  }
}
