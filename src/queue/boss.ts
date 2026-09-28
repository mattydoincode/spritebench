import { PgBoss } from "pg-boss";
import { poolConnectionString, sslConfig } from "@/db";
import { count, num } from "@/server/env";

export const GENERATE_QUEUE = "generate";
export const GENERATE_DLQ = "generate-dlq";
export const PRUNE_QUEUE = "prune-sources";
/** Browser uploads waiting to be checked and turned into assets. */
export const INGEST_QUEUE = "ingest-upload";

/** A generation can legitimately take minutes before the monitor reclaims it. */
const JOB_EXPIRE_SECONDS = 900;

/**
 * How long a generate job may go without its worker checking in before the
 * queue decides that worker is gone and retries the job elsewhere. The worker
 * checks in every half of this, so two missed check-ins in a row.
 */
export const GENERATE_HEARTBEAT_SECONDS = 120;

/** Attempts after the first, for transient provider and network failures. */
export const GENERATE_RETRY_LIMIT = 3;

let instance: PgBoss | null = null;
let starting: Promise<PgBoss> | null = null;

export interface BossOptions {
  /**
   * Hold a LISTEN connection so workers wake the moment a generate job is
   * sent. pg-boss runs one poller per concurrency slot, so a worker with 128
   * slots polling every 2s would be 64 fetches a second against an idle
   * queue; with the listener up they only poll every 30s as a backstop. Costs
   * one dedicated connection, so only the worker asks for it.
   */
  listen?: boolean;
}

async function start(options: BossOptions): Promise<PgBoss> {
  const next = new PgBoss({
    connectionString: poolConnectionString(),
    // pg-boss owns its own schema, well away from the domain tables.
    schema: "pgboss",
    max: count("QUEUE_POOL_MAX"),
    ssl: sslConfig(),
    useListenNotify: Boolean(options.listen)
  });

  next.on("error", (error: unknown) => console.error("[queue] error", error));
  // Includes the listener failing to start, which silently means polling.
  next.on("warning", (warning: unknown) => console.warn("[queue] warning", warning));

  await next.start();

  // The dead-letter queue has to exist before the queue that names it.
  await next.createQueue(GENERATE_DLQ);
  await next.createQueue(GENERATE_QUEUE, {
    policy: "standard",
    retryLimit: GENERATE_RETRY_LIMIT,
    retryDelay: 15,
    retryBackoff: true,
    expireInSeconds: JOB_EXPIRE_SECONDS,
    deadLetter: GENERATE_DLQ,
    notify: true
  });
  // createQueue leaves an existing queue as it was, so the flag is set here too.
  await next.updateQueue(GENERATE_QUEUE, { notify: true });
  await next.createQueue(PRUNE_QUEUE, { retryLimit: 1 });
  await next.createQueue(INGEST_QUEUE, { retryLimit: 3, retryDelay: 5, retryBackoff: true });

  instance = next;
  return next;
}

/** Options apply only to the call that starts the instance. */
export async function boss(options: BossOptions = {}): Promise<PgBoss> {
  if (instance) return instance;
  if (!starting) {
    starting = start(options).finally(() => {
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
    timeout: num("QUEUE_DRAIN_TIMEOUT_MS")
  });
}
