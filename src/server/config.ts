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

/**
 * Configuration that is missing or malformed, described by name only. Values
 * never appear, so this is safe to log and to serve from `/api/health`.
 *
 * Everything else here is validated lazily, at first use. That is fine for a
 * value needed on every request and quietly fatal for one needed rarely: with
 * no ENCRYPTION_KEY the app boots, serves pages and answers a naive health
 * check, then fails the first time a user saves a provider key -- long after
 * the deploy that caused it looked successful.
 */
export function configProblems(): string[] {
  const problems: string[] = [];

  const require = (name: string, hint?: string): void => {
    if (!process.env[name]?.trim()) {
      problems.push(hint ? `${name} is not set (${hint})` : `${name} is not set`);
    }
  };

  require("DATABASE_URL", "a Postgres connection string");

  const key = process.env.ENCRYPTION_KEY?.trim();
  if (!key) {
    problems.push("ENCRYPTION_KEY is not set (generate with: openssl rand -base64 32)");
  } else if (Buffer.from(key, "base64").length !== 32) {
    problems.push("ENCRYPTION_KEY does not decode to 32 bytes");
  }

  // Only the selected driver's credentials matter: local development should
  // not be asked for R2 keys it has no use for.
  if ((process.env.STORAGE_DRIVER?.trim().toLowerCase() || "local") === "r2") {
    for (const name of ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"]) {
      require(name, "required when STORAGE_DRIVER=r2");
    }
  }

  return problems;
}
