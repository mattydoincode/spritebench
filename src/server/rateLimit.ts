import { createHash } from "node:crypto";

/**
 * Per-caller request limits, enforced in middleware.
 *
 * Token buckets held in this process's memory. That is only correct because
 * production runs one web instance (`instance_count: 1` in infra/do-app.yaml);
 * a second instance would give every caller twice the budget, and scaling out
 * means moving the buckets to Postgres or Redis.
 *
 * The numbers are sized from the heaviest real project ("Exploration", ~170
 * images): a cold open is ~350 requests in a few seconds, almost all of them
 * `/source` redirects, and a drag in the scene flushes the doc up to 4 times a
 * second while polling it every 800ms. Everyday use should never come close;
 * these exist to stop a script, not a person.
 */

export interface Policy {
  name: string;
  /** Requests allowed in one burst. */
  capacity: number;
  /** Requests regained per second, up to `capacity`. */
  refillPerSecond: number;
}

/** Page loads, polls, image redirects. A cold Exploration open is ~350. */
const READ: Policy = { name: "read", capacity: 1500, refillPerSecond: 25 };

/** Doc flushes, edits, deletes. Deleting a folder is one DELETE per image. */
const WRITE: Policy = { name: "write", capacity: 600, refillPerSecond: 10 };

/** Uploads land one request per file, so a dropped folder is a burst. */
const UPLOAD: Policy = { name: "upload", capacity: 100, refillPerSecond: 1 };

/** Each one fans out to provider calls and worker time. */
const GENERATE: Policy = { name: "generate", capacity: 20, refillPerSecond: 1 / 3 };

/** Things a person does a handful of times: projects, tokens, share links, feedback. */
const CREATE: Policy = { name: "create", capacity: 20, refillPerSecond: 1 / 6 };

/** Sign-in and sign-out POSTs, keyed by IP since there is no session yet. */
const AUTH: Policy = { name: "auth", capacity: 20, refillPerSecond: 1 / 10 };

/**
 * Everything from one address, whoever it claims to be. Catches a client that
 * rotates made-up session cookies to get fresh buckets. Loose, because an
 * office or a household shares one address.
 */
export const PER_IP: Policy = { name: "ip", capacity: 4000, refillPerSecond: 60 };

const GENERATE_PATH = /^\/api\/projects\/[^/]+\/(generate|rerun)$/;
const UPLOAD_PATH = /^\/api\/projects\/[^/]+\/(assets\/upload|palettes|templates)$/;
const CREATE_PATH =
  /^\/api\/(projects|tokens|feedback|provider-keys|projects\/[^/]+\/share-links)$/;

/** Which bucket a request draws from. */
export function policyFor(method: string, pathname: string): Policy {
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return READ;
  if (pathname.startsWith("/api/auth/")) return AUTH;

  if (method === "POST") {
    if (GENERATE_PATH.test(pathname)) return GENERATE;
    if (UPLOAD_PATH.test(pathname)) return UPLOAD;
    if (CREATE_PATH.test(pathname)) return CREATE;
  }

  return WRITE;
}

interface Bucket {
  tokens: number;
  updatedAt: number;
}

/** Idle this long, a bucket is full again and can be forgotten. */
const IDLE_MS = 10 * 60 * 1000;
const SWEEP_EVERY = 1000;

export class RateLimiter {
  private buckets = new Map<string, Bucket>();
  private calls = 0;

  constructor(private readonly now: () => number = Date.now) {}

  /** Takes one token. Returns 0 if allowed, or seconds until one is free. */
  take(key: string, policy: Policy): number {
    const now = this.now();
    if (++this.calls % SWEEP_EVERY === 0) this.sweep(now);

    const id = `${policy.name}:${key}`;
    const bucket = this.buckets.get(id) ?? { tokens: policy.capacity, updatedAt: now };
    const elapsed = Math.max(0, now - bucket.updatedAt) / 1000;

    bucket.tokens = Math.min(policy.capacity, bucket.tokens + elapsed * policy.refillPerSecond);
    bucket.updatedAt = now;
    this.buckets.set(id, bucket);

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return 0;
    }

    return Math.ceil((1 - bucket.tokens) / policy.refillPerSecond);
  }

  get size(): number {
    return this.buckets.size;
  }

  private sweep(now: number): void {
    for (const [id, bucket] of this.buckets) {
      if (now - bucket.updatedAt > IDLE_MS) this.buckets.delete(id);
    }
  }
}

/**
 * Hashed so the map never holds a live session token or PAT, only something
 * that identifies one.
 */
export function callerKey(secret: string): string {
  return createHash("sha256").update(secret).digest("base64url").slice(0, 22);
}

/**
 * The client's address. App Platform puts it in `do-connecting-ip`; the
 * first `x-forwarded-for` hop is the fallback for anything else in front.
 */
export function clientIp(headers: Headers): string {
  return (
    headers.get("do-connecting-ip") ??
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    headers.get("x-real-ip") ??
    "unknown"
  );
}
