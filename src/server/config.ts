import { bool, count, optional, str } from "./env";

/**
 * Whether a signed-in user with no stored key may fall back to
 * `OPENAI_API_KEY` / `GEMINI_API_KEY`. Convenient on one machine, a standing
 * invitation to spend the operator's money once anyone can sign up, so it is
 * opt-in and off in `.env`.
 */
export function allowEnvProviderKey(): boolean {
  return bool("ALLOW_ENV_PROVIDER_KEY");
}

/** Provider calls in flight at once, per worker process. */
export function workerConcurrency(): number {
  return count("WORKER_CONCURRENCY");
}

/** Images a free account may keep before generation is refused. */
export function freeAssetLimit(): number {
  return count("FREE_ASSET_LIMIT");
}

/** Days a full-resolution source is kept before roll-off. */
export function assetRetentionDays(): number {
  return count("ASSET_RETENTION_DAYS");
}

/** Hard ceiling on batches x imageCount for one generate request. */
export function maxImagesPerRequest(): number {
  return count("MAX_IMAGES_PER_REQUEST");
}

export function encryptionKey(): Buffer {
  const key = Buffer.from(str("ENCRYPTION_KEY"), "base64");
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
 * The variables with no safe default, which therefore have to come from the
 * platform. Everything else is declared in `.env` and ships with the image;
 * these are the ones a deploy can be missing.
 */
const REQUIRED = ["DATABASE_URL", "ENCRYPTION_KEY"];
const REQUIRED_FOR_R2 = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"];

/**
 * Sign-in credentials. Only the web service needs them -- the worker never
 * serves a request -- so demanding them there would fail a deploy over
 * variables that component cannot use.
 */
const REQUIRED_FOR_WEB = ["AUTH_SECRET", "AUTH_GOOGLE_ID", "AUTH_GOOGLE_SECRET"];

/**
 * Configuration that is missing or malformed, by name only -- values never
 * appear, so this is safe to log and to serve from `/api/health`.
 *
 * Checked at startup because the alternative is checking at first use, and the
 * variables that matter most are used least: with no ENCRYPTION_KEY the app
 * boots, serves pages and passes a health check, then fails the first time
 * someone saves a provider key, long after the deploy looked successful.
 */
export function configProblems({ web = true }: { web?: boolean } = {}): string[] {
  const names = [...REQUIRED];
  if (web) names.push(...REQUIRED_FOR_WEB);
  if (optional("STORAGE_DRIVER") === "r2") names.push(...REQUIRED_FOR_R2);

  const problems = names.filter((name) => !optional(name)).map((name) => `${name} is not set`);

  const key = optional("ENCRYPTION_KEY");
  if (key && Buffer.from(key, "base64").length !== 32) {
    problems.push("ENCRYPTION_KEY does not decode to 32 bytes (openssl rand -base64 32)");
  }

  return problems;
}
