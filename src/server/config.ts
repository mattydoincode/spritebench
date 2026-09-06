function optionalNumber(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) throw new Error(`${name} must be a number, got "${raw}"`);
  return parsed;
}

/**
 * The single seeded user the app runs as until auth exists. Every query is
 * already scoped by this, so adding real sessions means replacing one function.
 */
export const SINGLE_USER_EMAIL = "local@art-studio.invalid";

export function singleUserId(): string | null {
  return process.env.SINGLE_USER_ID?.trim() || null;
}

/** Provider calls in flight at once, per worker process. */
export function workerConcurrency(): number {
  return Math.max(1, Math.floor(optionalNumber("WORKER_CONCURRENCY", 4)));
}

/** Images a free account may keep before generation is refused. */
export function freeAssetLimit(): number {
  return Math.max(1, Math.floor(optionalNumber("FREE_ASSET_LIMIT", 100)));
}

/** Days a full-resolution source is kept before roll-off. */
export function assetRetentionDays(): number {
  return Math.max(1, Math.floor(optionalNumber("ASSET_RETENTION_DAYS", 30)));
}

/** Hard ceiling on batches x imageCount for one generate request. */
export function maxImagesPerRequest(): number {
  return Math.max(1, Math.floor(optionalNumber("MAX_IMAGES_PER_REQUEST", 40)));
}

export function encryptionKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY?.trim();
  if (!raw) {
    throw new Error(
      "ENCRYPTION_KEY is required to store provider keys. Generate one with: openssl rand -base64 32"
    );
  }

  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(`ENCRYPTION_KEY must decode to 32 bytes, got ${key.length}`);
  }

  return key;
}

export function hasEncryptionKey(): boolean {
  try {
    encryptionKey();
    return true;
  } catch {
    return false;
  }
}
