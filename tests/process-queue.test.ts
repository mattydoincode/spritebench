import { describe, expect, it } from "vitest";
import {
  cancelPending,
  clampProcessWorkers,
  DEFAULT_PROCESS_WORKERS,
  describeProcessElapsed,
  describeProcessQueue,
  emptyProcessQueue,
  enqueueProcess,
  finishProcessJob,
  MAX_PROCESS_WORKERS,
  MIN_PROCESS_WORKERS,
  processJobElapsed,
  processQueueCount,
  PROCESS_PRIORITY,
  startProcessJobs,
  upgradeProcess,
  type ProcessJob
} from "@/client/processQueue";

function job(patch: Partial<ProcessJob> & Pick<ProcessJob, "id" | "cacheKey">): ProcessJob {
  return {
    assetId: "asset",
    variant: "thumb",
    wantSource: false,
    priority: PROCESS_PRIORITY.background,
    status: "pending",
    queuedAt: 0,
    ...patch
  };
}

describe("process queue", () => {
  it("starts higher priority jobs first and respects concurrency", () => {
    let state = emptyProcessQueue();
    state = enqueueProcess(state, job({ id: 1, cacheKey: "a:thumb:1:0" }));
    state = enqueueProcess(
      state,
      job({
        id: 2,
        cacheKey: "b:source:1:0",
        assetId: "b",
        variant: "source",
        priority: PROCESS_PRIORITY.selected
      })
    );
    state = enqueueProcess(state, job({ id: 3, cacheKey: "c:thumb:1:0", assetId: "c" }));

    const first = startProcessJobs(state, 2, 10);
    expect(first.started.map((entry) => entry.id)).toEqual([2, 1]);
    expect(first.state.pending.map((entry) => entry.id)).toEqual([3]);
    expect(processQueueCount(first.state)).toBe(3);
    expect(describeProcessQueue(first.state)).toBe("2 processing · 1 queued");

    const after = finishProcessJob(first.state, 2, "done", 40);
    const second = startProcessJobs(after, 2, 40);
    expect(second.started.map((entry) => entry.id)).toEqual([3]);
    expect(second.state.active.map((entry) => entry.id).sort()).toEqual([1, 3]);
  });

  it("upgrades a pending job to include the source bitmap and jump the line", () => {
    let state = emptyProcessQueue();
    state = enqueueProcess(state, job({ id: 1, cacheKey: "a:source:1:0", variant: "source" }));
    state = enqueueProcess(state, job({ id: 2, cacheKey: "b:thumb:1:0", assetId: "b" }));
    state = upgradeProcess(state, "a:source:1:0", true, PROCESS_PRIORITY.selected);

    expect(state.pending[0]).toMatchObject({
      id: 1,
      wantSource: true,
      priority: PROCESS_PRIORITY.selected
    });

    const started = startProcessJobs(state, 1, 5);
    expect(started.started[0]?.wantSource).toBe(true);
    expect(started.started[0]?.id).toBe(1);
  });

  it("keeps recent finishes and names an idle queue", () => {
    let state = emptyProcessQueue();
    state = enqueueProcess(state, job({ id: 1, cacheKey: "a:thumb:1:0" }));
    state = startProcessJobs(state, 1, 0).state;
    state = finishProcessJob(state, 1, "error", 1200, "could not load source (404)");

    expect(describeProcessQueue(state)).toBe("idle");
    expect(state.recent[0]).toMatchObject({
      id: 1,
      status: "error",
      error: "could not load source (404)"
    });
    expect(processJobElapsed(state.recent[0]!, 1200)).toBe(1.2);
    expect(describeProcessElapsed(1.2)).toBe("1s");
    expect(describeProcessElapsed(0.2)).toBe("<1s");
  });

  it("drops pending jobs by cache key and leaves running ones alone", () => {
    let state = emptyProcessQueue();
    state = enqueueProcess(state, job({ id: 1, cacheKey: "old:thumb:1:a" }));
    state = enqueueProcess(state, job({ id: 2, cacheKey: "keep:thumb:1:a", assetId: "keep" }));
    state = enqueueProcess(state, job({ id: 3, cacheKey: "old:thumb:1:a" }));
    state = startProcessJobs(state, 1, 10).state;

    expect(state.active[0]?.id).toBe(1);
    state = cancelPending(state, ["old:thumb:1:a"]);

    expect(state.active.map((entry) => entry.id)).toEqual([1]);
    expect(state.pending.map((entry) => entry.id)).toEqual([2]);
    expect(state.recent).toEqual([]);
    expect(describeProcessQueue(state)).toBe("1 processing · 1 queued");
  });
});

describe("clampProcessWorkers", () => {
  it("defaults garbage and clamps to the allowed range", () => {
    expect(clampProcessWorkers(undefined)).toBe(DEFAULT_PROCESS_WORKERS);
    expect(clampProcessWorkers("nope")).toBe(DEFAULT_PROCESS_WORKERS);
    expect(clampProcessWorkers(0)).toBe(MIN_PROCESS_WORKERS);
    expect(clampProcessWorkers(99)).toBe(MAX_PROCESS_WORKERS);
    expect(clampProcessWorkers(4.6)).toBe(5);
  });
});
