import { describe, expect, it } from "vitest";
import {
  BATCH_SWATCHES,
  batchSwatch,
  batchesByJobId,
  groupByBatch,
  isBatch,
  nextBatchName
} from "@/shared/batch";

describe("isBatch", () => {
  it("is several images, but not a loop or chunk set", () => {
    expect(isBatch({ images: 4 })).toBe(true);
    expect(isBatch({ images: 1 })).toBe(false);
    expect(isBatch({ images: 4, loop: true })).toBe(false);
    expect(isBatch({ images: 4, chunk: true })).toBe(false);
  });
});

describe("nextBatchName", () => {
  it("counts up from the highest automatic name, ignoring typed ones", () => {
    expect(nextBatchName([])).toBe("batch-001");
    expect(nextBatchName(["batch-001", "knights", "batch-007", "batch-3"])).toBe("batch-008");
  });
});

describe("batchesByJobId", () => {
  it("skips jobs with no batch", () => {
    expect(
      batchesByJobId([
        { id: "a", folder: "loop" },
        { id: "b", folder: "" },
        { id: "c", folder: "  " }
      ])
    ).toEqual({ a: "loop" });
  });
});

describe("groupByBatch", () => {
  it("keeps batches first and the loose images last", () => {
    const groups = groupByBatch([
      { id: "1", batch: "" },
      { id: "2", batch: "loop" },
      { id: "3", batch: "loop" },
      { id: "4", batch: " anim " },
      { id: "5", batch: "" }
    ]);

    expect(groups.map((group) => group.batch)).toEqual(["loop", "anim", ""]);
    expect(groups[0].items.map((item) => item.id)).toEqual(["2", "3"]);
    expect(groups[1].items.map((item) => item.id)).toEqual(["4"]);
    expect(groups[2].items.map((item) => item.id)).toEqual(["1", "5"]);
  });

  it("omits the loose group when everything is batched", () => {
    expect(groupByBatch([{ batch: "loop" }, { batch: "loop" }])).toEqual([
      { batch: "loop", items: [{ batch: "loop" }, { batch: "loop" }] }
    ]);
  });
});

describe("batchSwatch", () => {
  it("picks a stable color from the name", () => {
    expect(batchSwatch("anim")).toEqual(batchSwatch("anim"));
    expect(BATCH_SWATCHES).toContainEqual(batchSwatch("anim"));
  });

  it("spreads different names across the palette", () => {
    const picked = new Set(
      ["anim", "batch", "grid", "props", "tiles", "ui", "fx", "portraits"].map(
        (name) => BATCH_SWATCHES.indexOf(batchSwatch(name))
      )
    );
    expect(picked.size).toBeGreaterThan(1);
  });
});
