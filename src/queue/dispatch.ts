import { sql } from "drizzle-orm";
import { fromDrizzle } from "pg-boss";
import type { Database } from "@/db";
import { GENERATE_QUEUE, boss } from "./boss";

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
      ...(transaction ? { db: fromDrizzle(transaction, sql) } : {})
    }
  );
}
