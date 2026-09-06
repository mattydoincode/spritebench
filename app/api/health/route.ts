import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { GENERATE_QUEUE, boss } from "@/queue/boss";
import { storage, storageDriver } from "@/storage";

export const dynamic = "force-dynamic";

/** A probe that hangs is a failed probe; the platform should not wait on it. */
const TIMEOUT_MS = 5000;

type CheckState = "ok" | "failed";

interface CheckResult {
  state: CheckState;
  detail?: string;
  ms: number;
}

/**
 * SDK errors are not always readable: some arrive with an empty message and
 * only a name, which reports as a blank failure and tells nobody anything.
 */
function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error) || "unknown failure";

  // A failed connection arrives as an AggregateError with one entry per
  // address tried, and its own message is empty.
  if (error instanceof AggregateError) {
    const [first] = error.errors;
    if (first) return `${error.name}: ${describeError(first)}`;
  }

  // The bare name only helps when it says something the message does not.
  const named = error.name && error.name !== "Error" ? error.name : "";
  const parts = [error.message, named].filter((part) => part.length > 0);

  // Always follow the cause. Drizzle reports "Failed query: select 1" and hangs
  // the actual driver error off `cause`, so stopping at a non-empty message
  // turns every database fault into the same uninformative line.
  if (error.cause instanceof Error) parts.push(describeError(error.cause));

  return parts.join(": ") || "unknown failure";
}

async function timed(check: () => Promise<string | undefined>): Promise<CheckResult> {
  const started = Date.now();

  try {
    const detail = await Promise.race([
      check(),
      new Promise<never>((_resolve, reject) =>
        setTimeout(() => reject(new Error(`timed out after ${TIMEOUT_MS}ms`)), TIMEOUT_MS)
      )
    ]);

    return { state: "ok", ...(detail ? { detail } : {}), ms: Date.now() - started };
  } catch (error) {
    return { state: "failed", detail: describeError(error), ms: Date.now() - started };
  }
}

/**
 * Reports on the three things this app cannot run without: Postgres, object
 * storage, and the queue.
 *
 * Each is exercised for real rather than inferred from configuration -- a
 * bucket name in an env var says nothing about whether the credentials work.
 * The storage check writes and deletes a probe object, which is the only way
 * to catch a read-only token.
 */
export async function GET() {
  const [database, objects, queue] = await Promise.all([
    timed(async () => {
      const result = await db().execute(sql`select 1 as ok`);
      const rows = Array.isArray(result) ? result : result.rows;
      if (rows.length !== 1) throw new Error("unexpected response from Postgres");

      return undefined;
    }),

    timed(async () => {
      const key = `health/probe-${process.pid}-${Date.now()}.txt`;
      const payload = Buffer.from("ok");

      await storage().put(key, payload, { contentType: "text/plain" });

      const read = await storage().get(key);
      await storage().delete(key);

      if (Buffer.from(read).toString() !== "ok") {
        throw new Error("storage returned different bytes than were written");
      }

      return storageDriver();
    }),

    timed(async () => {
      const instance = await boss();
      const queue = await instance.getQueue(GENERATE_QUEUE);

      // A missing queue means pg-boss never finished installing its schema,
      // which looks like a working app that silently never generates anything.
      if (!queue) throw new Error(`the ${GENERATE_QUEUE} queue does not exist`);

      return `${GENERATE_QUEUE} ready`;
    })
  ]);

  const checks = { database, storage: objects, queue };
  const healthy = Object.values(checks).every((check) => check.state === "ok");

  return NextResponse.json(
    {
      status: healthy ? "ok" : "degraded",
      version: process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev",
      checks
    },
    {
      status: healthy ? 200 : 503,
      headers: { "Cache-Control": "no-store" }
    }
  );
}
