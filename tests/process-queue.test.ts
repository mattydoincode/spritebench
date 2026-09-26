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
  prefetchCapacity,
  PROCESS_PRIORITY,
  startProcessJobs,
  upgradeProcess,
  type ProcessJob
} from "@/client/processQueue";
import { takeNewArrivals } from "@/shared/prefetch";

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

describe("prefetch", () => {
  const prefetchJob = (id: number): ProcessJob => ({
    id,
    cacheKey: `p${id}:source:1:0`,
    assetId: `p${id}`,
    variant: "source",
    wantSource: true,
    priority: PROCESS_PRIORITY.prefetch,
    status: "pending",
    queuedAt: 0
  });

  it("never takes the last free worker", () => {
    let state = emptyProcessQueue();
    for (const id of [1, 2, 3]) state = enqueueProcess(state, prefetchJob(id));
    const { started } = startProcessJobs(state, 2, 0);
    expect(started.map((job) => job.id)).toEqual([1]);
  });

  it("lets an interactive job take the reserved worker", () => {
    let state = emptyProcessQueue();
    for (const id of [1, 2, 3]) state = enqueueProcess(state, prefetchJob(id));
    state = startProcessJobs(state, 2, 0).state;
    state = enqueueProcess(state, { ...prefetchJob(9), priority: PROCESS_PRIORITY.selected });
    const { started } = startProcessJobs(state, 2, 1);
    expect(started.map((job) => job.id)).toEqual([9]);
  });

  it("runs behind thumbnails and inspector work", () => {
    let state = emptyProcessQueue();
    state = enqueueProcess(state, prefetchJob(1));
    state = enqueueProcess(state, { ...prefetchJob(2), priority: PROCESS_PRIORITY.background });
    state = enqueueProcess(state, { ...prefetchJob(3), priority: PROCESS_PRIORITY.selected });
    expect(state.pending.map((job) => job.id)).toEqual([3, 2, 1]);
  });

  it("jumps ahead once the same image is opened", () => {
    let state = enqueueProcess(emptyProcessQueue(), prefetchJob(1));
    state = enqueueProcess(state, prefetchJob(2));
    state = upgradeProcess(state, "p2:source:1:0", true, PROCESS_PRIORITY.selected);
    expect(state.pending[0].id).toBe(2);
  });

  it("still uses a lone worker", () => {
    const state = enqueueProcess(emptyProcessQueue(), prefetchJob(1));
    expect(startProcessJobs(state, 1, 0).started).toHaveLength(1);
    expect(prefetchCapacity(4)).toBe(3);
  });
});

describe("takeNewArrivals", () => {
  it("returns unseen assets with a source, newest first, once", () => {
    const seen = new Set(["old"]);
    const assets = [
      { id: "old", hasSource: true },
      { id: "a", hasSource: true },
      { id: "gone", hasSource: false },
      { id: "b", hasSource: true }
    ];
    expect(takeNewArrivals(seen, assets)).toEqual(["b", "a"]);
    expect(takeNewArrivals(seen, assets)).toEqual([]);
  });

  it("caps a big batch to the newest", () => {
    const assets = Array.from({ length: 5 }, (_, i) => ({ id: `a${i}`, hasSource: true }));
    expect(takeNewArrivals(new Set(), assets, 2)).toEqual(["a4", "a3"]);
  });
});
