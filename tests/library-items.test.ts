import { describe, expect, it } from "vitest";
import { DEFAULT_PROCESSING } from "@/core/settings";
import { groupByFolder } from "@/shared/folder";
import {
  FOLDER_PEEK,
  columnCount,
  flattenLibrary,
  folderIsCollapsed,
  isFailedJob,
  libraryItemMatches,
  libraryItems,
  remapSelection,
  type LibraryAsset
} from "@/shared/libraryItems";
import { DEFAULT_GENERATION, type JobRecord } from "@/shared/model";

function asset(overrides: Partial<LibraryAsset> = {}): LibraryAsset {
  return {
    id: "a1",
    folder: "",
    createdAt: "2026-09-19T12:00:00.000Z",
    seq: 1,
    label: "001",
    prompt: { body: "a tree" },
    tags: [],
    ...overrides
  };
}

function job(overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    id: "j1",
    status: "queued",
    label: "tree",
    batchId: null,
    batchIndex: 1,
    batchSize: 1,
    createdAt: "2026-09-19T12:01:00.000Z",
    startedAt: null,
    finishedAt: null,
    userId: null,
    providerKeyId: null,
    prompt: { prefix: "", body: "a tree", suffix: "" },
    composedPrompt: "a tree",
    generation: DEFAULT_GENERATION,
    processing: DEFAULT_PROCESSING,
    folder: "",
    inputs: null,
    sequencePlan: null,
    rerunOf: null,
    assetIds: [],
    resolvedSize: null,
    error: null,
    ...overrides
  };
}

describe("libraryItems", () => {
  it("drops done jobs and keeps failed ones", () => {
    const items = libraryItems(
      [asset()],
      [
        job({ id: "done", status: "done", assetIds: ["a1"] }),
        job({ id: "fail", status: "error", error: "nope" })
      ]
    );

    expect(items.map((entry) => entry.id)).toEqual(["fail", "a1"]);
    expect(items[0]).toMatchObject({ kind: "job", id: "fail" });
  });

  it("sorts newest first so a just-queued job lands at the top", () => {
    const items = libraryItems(
      [asset({ id: "old", createdAt: "2026-09-19T11:00:00.000Z", seq: 1 })],
      [job({ id: "new", createdAt: "2026-09-19T12:00:00.000Z" })]
    );

    expect(items.map((entry) => entry.id)).toEqual(["new", "old"]);
  });

  it("keeps a failed job even when it somehow has asset ids", () => {
    const items = libraryItems(
      [asset({ id: "a1" })],
      [job({ id: "fail", status: "cancelled", assetIds: ["a1"] })]
    );

    expect(items.map((entry) => `${entry.kind}:${entry.id}`)).toEqual([
      "job:fail",
      "asset:a1"
    ]);
  });
});

describe("libraryItemMatches", () => {
  it("searches assets by label, prompt, and tags", () => {
    const entry = libraryItems([asset({ label: "hero", tags: ["npc"] })], [])[0];
    expect(libraryItemMatches(entry, "hero")).toBe(true);
    expect(libraryItemMatches(entry, "tree")).toBe(true);
    expect(libraryItemMatches(entry, "npc")).toBe(true);
    expect(libraryItemMatches(entry, "castle")).toBe(false);
  });

  it("searches jobs by label, prompt, status, and error", () => {
    const entry = libraryItems(
      [],
      [job({ label: "walk", status: "error", error: "rate limited" })]
    )[0];
    expect(libraryItemMatches(entry, "walk")).toBe(true);
    expect(libraryItemMatches(entry, "error")).toBe(true);
    expect(libraryItemMatches(entry, "rate")).toBe(true);
    expect(libraryItemMatches(entry, "idle")).toBe(false);
  });
});

describe("columnCount", () => {
  it("fits as many thumbs as the row can hold", () => {
    expect(columnCount(280, 88, 8)).toBe(3);
    expect(columnCount(279, 88, 8)).toBe(2);
    expect(columnCount(88, 88, 8)).toBe(1);
  });

  it("does not collapse before the row is measured", () => {
    expect(columnCount(0, 88, 8)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("folderIsCollapsed", () => {
  it("stays open when everything fits in the peek", () => {
    expect(folderIsCollapsed("anim", FOLDER_PEEK, FOLDER_PEEK, {})).toBe(false);
  });

  it("defaults overflow folders to collapsed unless explicitly opened", () => {
    expect(folderIsCollapsed("anim", 10, FOLDER_PEEK, {})).toBe(true);
    expect(folderIsCollapsed("anim", 10, FOLDER_PEEK, { anim: false })).toBe(false);
    expect(folderIsCollapsed("anim", 10, FOLDER_PEEK, { anim: true })).toBe(true);
  });
});

describe("flattenLibrary", () => {
  it("emits a chip then thumbs, and lets the next group continue", () => {
    const groups = groupByFolder([
      { id: "1", folder: "anim" },
      { id: "2", folder: "anim" },
      { id: "3", folder: "" }
    ]);

    const cells = flattenLibrary(groups, { anim: false }, 4);

    expect(cells).toEqual([
      { type: "folder", folder: "anim", count: 2, collapsed: false, overflow: false },
      { type: "item", item: { id: "1", folder: "anim" } },
      { type: "item", item: { id: "2", folder: "anim" } },
      { type: "item", item: { id: "3", folder: "" } }
    ]);
  });

  it("peeks three thumbs of an overflow folder", () => {
    const groups = groupByFolder([
      { id: "1", folder: "batch" },
      { id: "2", folder: "batch" },
      { id: "3", folder: "batch" },
      { id: "4", folder: "batch" },
      { id: "5", folder: "batch" }
    ]);

    const cells = flattenLibrary(groups, {}, FOLDER_PEEK);

    expect(cells.map((cell) => (cell.type === "folder" ? cell.folder : cell.item.id))).toEqual([
      "batch",
      "1",
      "2",
      "3"
    ]);
    expect(cells[0]).toMatchObject({ type: "folder", collapsed: true, overflow: true, count: 5 });
  });
});

describe("remapSelection", () => {
  it("follows a finished job to its first asset", () => {
    expect(
      remapSelection(
        ["j1", "a-old"],
        [job({ id: "j1", status: "running" })],
        [job({ id: "j1", status: "done", assetIds: ["a-new", "a-extra"] })]
      )
    ).toEqual(["a-new", "a-old"]);
  });

  it("drops a dismissed job", () => {
    expect(
      remapSelection(["j1", "a1"], [job({ id: "j1", status: "error" })], [])
    ).toEqual(["a1"]);
  });

  it("leaves a still-pending job alone", () => {
    expect(
      remapSelection(
        ["j1"],
        [job({ id: "j1", status: "queued" })],
        [job({ id: "j1", status: "running" })]
      )
    ).toEqual(["j1"]);
  });
});

describe("isFailedJob", () => {
  it("treats error and cancelled as failed", () => {
    expect(isFailedJob("error")).toBe(true);
    expect(isFailedJob("cancelled")).toBe(true);
    expect(isFailedJob("queued")).toBe(false);
  });
});
