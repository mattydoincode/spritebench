import { describe, expect, it } from "vitest";
import {
  foldersByJobId,
  groupByFolder,
  resolveJobFolder,
  suggestedFolder
} from "@/shared/folder";

describe("suggestedFolder", () => {
  it("names sheets and batches, not loop or chunk", () => {
    expect(suggestedFolder({ animation: true, many: true })).toBe("anim");
    expect(suggestedFolder({ itemGrid: true })).toBe("grid");
    expect(suggestedFolder({ many: true })).toBe("batch");
    expect(suggestedFolder({})).toBe("");
  });
});

describe("resolveJobFolder", () => {
  it("prefers a typed name and falls back to the suggestion", () => {
    expect(resolveJobFolder("  walk  ", "loop")).toBe("walk");
    expect(resolveJobFolder("   ", "loop")).toBe("loop");
    expect(resolveJobFolder("", "")).toBe("");
  });
});

describe("foldersByJobId", () => {
  it("skips jobs with no folder", () => {
    expect(
      foldersByJobId([
        { id: "a", folder: "loop" },
        { id: "b", folder: "" },
        { id: "c", folder: "  " }
      ])
    ).toEqual({ a: "loop" });
  });
});

describe("groupByFolder", () => {
  it("keeps named folders first and the loose pile last", () => {
    const groups = groupByFolder([
      { id: "1", folder: "" },
      { id: "2", folder: "loop" },
      { id: "3", folder: "loop" },
      { id: "4", folder: " anim " },
      { id: "5", folder: "" }
    ]);

    expect(groups.map((group) => group.folder)).toEqual(["loop", "anim", ""]);
    expect(groups[0].items.map((item) => item.id)).toEqual(["2", "3"]);
    expect(groups[1].items.map((item) => item.id)).toEqual(["4"]);
    expect(groups[2].items.map((item) => item.id)).toEqual(["1", "5"]);
  });

  it("omits the loose group when everything is filed", () => {
    expect(groupByFolder([{ folder: "loop" }, { folder: "loop" }])).toEqual([
      { folder: "loop", items: [{ folder: "loop" }, { folder: "loop" }] }
    ]);
  });
});
