import "@/server/env-load";
import { closeDb } from "@/db";
import { failOrphanedJobs } from "@/db/repo/jobs";
import {
  GENERATE_QUEUE,
  GENERATE_RETRY_LIMIT,
  PRUNE_QUEUE,
  boss,
  stopBoss
} from "@/queue/boss";
import type { GenerateJobPayload } from "@/queue/dispatch";
import { configProblems, workerConcurrency } from "@/server/config";
import { compactProjectDocs, pruneExpiredSources } from "./prune";
import { runJob } from "./runJob";

/** Nightly, at 04:00 UTC. */
const PRUNE_SCHEDULE = "0 4 * * *";

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`[worker] ${signal} received, draining in-flight jobs`);

  try {
    // Waits for handlers to finish instead of leaving jobs stuck in `running`
    // for the monitor to reclaim, which is what "interrupted by a server
    // restart" used to mean.
    await stopBoss();
    await closeDb();
    console.log("[worker] drained cleanly");
    process.exit(0);
  } catch (error) {
    console.error("[worker] shutdown failed", error);
    process.exit(1);
  }
}

async function main(): Promise<void> {
  // Refuse to start rather than accepting jobs it cannot finish. A worker with
  // no R2 credentials would claim a job, call the provider, spend the user's
  // money and then fail to store the result.
  const problems = configProblems({ web: false });
  if (problems.length > 0) {
    for (const problem of problems) console.error(`[worker] config: ${problem}`);
    throw new Error(`${problems.length} configuration problem(s)`);
  }

  const concurrency = workerConcurrency();
  const instance = await boss();

  // Anything still marked running belongs to a process that died hard; a
  // graceful shutdown drains rather than leaving these behind.
  const orphaned = await failOrphanedJobs();
  if (orphaned > 0) console.warn(`[worker] failed ${orphaned} orphaned job(s) from a hard stop`);

  // One job per handler call, `localConcurrency` of them in flight. Each is a
  // single provider request, so this is the number of images being generated at
  // once by this process. Metadata carries the retry count, which decides
  // whether a transient failure has another attempt left.
  const generateOptions = {
    batchSize: 1,
    localConcurrency: concurrency,
    includeMetadata: true
  } as const;

  await instance.work<GenerateJobPayload, void, typeof generateOptions>(
    GENERATE_QUEUE,
    generateOptions,
    async ([job]) => {
      if (!job?.data?.jobId) throw new Error("generate job has no jobId");

      const attemptsLeft = Math.max(0, GENERATE_RETRY_LIMIT - (job.retryCount ?? 0));
      const { retry } = await runJob(job.data.jobId, attemptsLeft);

      // Throwing is what asks pg-boss for another attempt. A job that failed
      // for a reason a retry cannot change is already recorded as an error, so
      // it completes here and never reaches the dead-letter queue.
      if (retry) throw new Error(`job ${job.data.jobId} needs another attempt`);
    }
  );

  await instance.work(PRUNE_QUEUE, { batchSize: 1 }, async () => {
    const pruned = await pruneExpiredSources();
    if (pruned > 0) console.log(`[worker] rolled off ${pruned} source(s)`);

    const compacted = await compactProjectDocs();
    if (compacted > 0) console.log(`[worker] compacted ${compacted} project document(s)`);
  });

  await instance.schedule(PRUNE_QUEUE, PRUNE_SCHEDULE);

  console.log(`[worker] ready, concurrency ${concurrency}`);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

process.on("unhandledRejection", (reason) => {
  console.error("[worker] unhandled rejection", reason);
});

main().catch((error) => {
  console.error("[worker] failed to start", error);
  process.exit(1);
});
