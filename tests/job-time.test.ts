import { describe, expect, it } from "vitest";
import { DEFAULT_PROCESSING } from "@/core/settings";
import { batchElapsedSeconds, formatElapsed, jobElapsedSeconds } from "@/shared/jobTime";
import type { JobRecord } from "@/shared/model";

const T0 = Date.parse("2026-09-07T21:00:00.000Z");

function job(overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    id: "j",
    status: "running",
    label: "walk",
    batchId: null,
    batchIndex: 1,
    batchSize: 1,
    createdAt: "2026-09-07T21:00:00.000Z",
    startedAt: "2026-09-07T21:00:00.000Z",
    finishedAt: null,
    userId: null,
    prompt: { prefix: "", body: "", suffix: "" },
    composedPrompt: "",
    generation: {
      model: "gpt-image-2",
      quality: "low",
      background: "transparent",
      moderation: "auto",
      size: { width: 1024, height: 1024 },
      useAutoSize: false,
      imageCount: 1
    },
    processing: DEFAULT_PROCESSING,
    folder: "",
    inputs: null,
    sequencePlan: null,
    rerunOf: null,
    assetIds: [],
    resolvedSize: null,
    error: null,
    ...overrides
  } as JobRecord;
}

describe("jobElapsedSeconds", () => {
  it("is silent while the job is still queued", () => {
    expect(jobElapsedSeconds(job({ status: "queued", startedAt: null }), T0)).toBeNull();
  });

  it("counts from startedAt to now while running", () => {
    expect(jobElapsedSeconds(job(), T0 + 12_400)).toBe(12.4);
  });

  it("freezes on finishedAt once the job is done", () => {
    const done = job({
      status: "done",
      finishedAt: "2026-09-07T21:00:47.000Z"
    });

    expect(jobElapsedSeconds(done, T0 + 120_000)).toBe(47);
  });

  it("does the same for an error, so a failed run still has a duration", () => {
    const failed = job({
      status: "error",
      finishedAt: "2026-09-07T21:00:09.000Z"
    });

    expect(jobElapsedSeconds(failed, T0 + 60_000)).toBe(9);
  });
});

describe("batchElapsedSeconds", () => {
  it("spans the first start to now while anything is still running", () => {
    const seconds = batchElapsedSeconds(
      [
        job({ startedAt: "2026-09-07T21:00:00.000Z", status: "done", finishedAt: "2026-09-07T21:00:10.000Z" }),
        job({ startedAt: "2026-09-07T21:00:05.000Z", status: "running", finishedAt: null })
      ],
      T0 + 20_000
    );

    expect(seconds).toBe(20);
  });

  it("freezes from first start to last finish when the batch is done", () => {
    const seconds = batchElapsedSeconds(
      [
        job({ startedAt: "2026-09-07T21:00:00.000Z", status: "done", finishedAt: "2026-09-07T21:00:10.000Z" }),
        job({ startedAt: "2026-09-07T21:00:08.000Z", status: "done", finishedAt: "2026-09-07T21:00:30.000Z" })
      ],
      T0 + 90_000
    );

    expect(seconds).toBe(30);
  });
});

describe("formatElapsed", () => {
  it("stays in whole seconds so a one-second tick is visible", () => {
    expect(formatElapsed(0)).toBe("0s");
    expect(formatElapsed(12.9)).toBe("12s");
    expect(formatElapsed(63)).toBe("1m 03s");
  });
});
