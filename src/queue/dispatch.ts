import { sql } from "drizzle-orm";
import { fromDrizzle } from "pg-boss";
import type { Database } from "@/db";
import type { IngestPayload } from "@/server/uploads";
import { GENERATE_HEARTBEAT_SECONDS, GENERATE_QUEUE, INGEST_QUEUE, boss } from "./boss";

export interface GenerateJobPayload {
  jobId: string;
}

/**
 * Hands a job row to the queue.
 *
 * The payload is deliberately just the row id. The prompt and settings live in
 * Postgres, so the queue never holds a stale copy and never needs migrating
 * when the job shape changes.
 *
 * Pass `transaction` to enqueue inside the same transaction that inserts the
 * row: either both land or neither does, so there is no window where a job
 * exists but nothing will ever run it.
 */
export async function dispatchJob(
  jobId: string,
  /** Who asked for it. Jobs are grouped by user so no one person takes every worker. */
  userId: string | null,
  transaction?: Parameters<Parameters<Database["transaction"]>[0]>[0]
): Promise<string | null> {
  const instance = await boss();

  return instance.send(
    GENERATE_QUEUE,
    { jobId } satisfies GenerateJobPayload,
    {
      // A duplicate send for the same row is a no-op rather than a second
      // paid generation.
      singletonKey: jobId,
      // Set per job because pg-boss cannot add a heartbeat to a queue that
      // already exists. A worker that dies has its jobs retried after this,
      // instead of after the 15-minute expiry.
      heartbeatSeconds: GENERATE_HEARTBEAT_SECONDS,
      // The worker caps how many jobs of one group run at once (see
      // WORKER_USER_CONCURRENCY), so a 40-image request queues behind itself
      // rather than in front of everyone else. A job with no user is ungrouped.
      ...(userId ? { group: { id: userId } } : {}),
      ...(transaction ? { db: fromDrizzle(transaction, sql) } : {})
    }
  );
}

/** Queues a staged upload for the worker. Sending the same upload twice is a no-op. */
export async function dispatchIngest(payload: IngestPayload): Promise<string | null> {
  const instance = await boss();
  return instance.send(INGEST_QUEUE, payload, { singletonKey: payload.uploadId });
}
