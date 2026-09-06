import { PgBoss } from "pg-boss";
import { connectionString, sslConfig } from "@/db";

export const GENERATE_QUEUE = "generate";
export const GENERATE_DLQ = "generate-dlq";
export const PRUNE_QUEUE = "prune-sources";

/** A generation can legitimately take minutes before the monitor reclaims it. */
const JOB_EXPIRE_SECONDS = 900;

/** Attempts after the first, for transient provider and network failures. */
export const GENERATE_RETRY_LIMIT = 3;

let instance: PgBoss | null = null;
let starting: Promise<PgBoss> | null = null;

async function start(): Promise<PgBoss> {
  const next = new PgBoss({
    connectionString: connectionString(),
    // pg-boss owns its own schema, well away from the domain tables.
    schema: "pgboss",
    max: Number(process.env.QUEUE_POOL_MAX ?? 4),
    ssl: sslConfig()
  });

  next.on("error", (error: unknown) => console.error("[queue] error", error));

  await next.start();

  // The dead-letter queue has to exist before the queue that names it.
  await next.createQueue(GENERATE_DLQ);
  await next.createQueue(GENERATE_QUEUE, {
    policy: "standard",
    retryLimit: GENERATE_RETRY_LIMIT,
    retryDelay: 15,
    retryBackoff: true,
    expireInSeconds: JOB_EXPIRE_SECONDS,
    deadLetter: GENERATE_DLQ
  });
  await next.createQueue(PRUNE_QUEUE, { retryLimit: 1 });

  instance = next;
  return next;
}

export async function boss(): Promise<PgBoss> {
  if (instance) return instance;
  if (!starting) {
    starting = start().finally(() => {
      starting = null;
    });
  }

  return starting;
}

/**
 * Drains in-flight work rather than abandoning it. A generation that is
 * already running gets up to `timeout` to finish, so a deploy does not turn a
 * paid provider call into a failed job.
 */
export async function stopBoss(): Promise<void> {
  if (!instance) return;

  const current = instance;
  instance = null;
  await current.stop({
    graceful: true,
    close: true,
    timeout: Number(process.env.QUEUE_DRAIN_TIMEOUT_MS ?? 30_000)
  });
}
