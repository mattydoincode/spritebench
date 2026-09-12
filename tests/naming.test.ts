import { describe, expect, it } from "vitest";
import {
  displayName,
  exportStem,
  formatSeq,
  nextSceneName,
  sanitizeName
} from "@/shared/naming";

describe("formatSeq", () => {
  /**
   * Padding stops at three digits rather than widening forever, so a project
   * reads 001 early and 1000 later without renumbering anything.
   */
  it("pads to three digits and then grows", () => {
    expect(formatSeq(1)).toBe("001");
    expect(formatSeq(9)).toBe("009");
    expect(formatSeq(99)).toBe("099");
    expect(formatSeq(999)).toBe("999");
    expect(formatSeq(1000)).toBe("1000");
    expect(formatSeq(10001)).toBe("10001");
  });

  it("does not produce a negative or fractional number", () => {
    expect(formatSeq(-5)).toBe("000");
    expect(formatSeq(2.7)).toBe("002");
  });
});

describe("displayName", () => {
  it("falls back to the number when there is no rename", () => {
    expect(displayName(3)).toBe("003");
    expect(displayName(3, null)).toBe("003");
    expect(displayName(3, "")).toBe("003");
  });

  it("prefers a rename", () => {
    expect(displayName(3, "hero idle")).toBe("hero idle");
  });

  /**
   * Clearing the rename field has to give the number back rather than leaving
   * the asset nameless, which is why the name is computed and never stored.
   */
  it("falls back when a rename is cleared to whitespace", () => {
    expect(displayName(42, "   ")).toBe("042");
  });

  it("keeps a rename verbatim, including characters a filename could not hold", () => {
    expect(displayName(1, "hero/idle (v2)")).toBe("hero/idle (v2)");
  });
});

describe("sanitizeName", () => {
  it("collapses anything unsafe to underscores", () => {
    expect(sanitizeName("Hero Idle", "x")).toBe("hero_idle");
    expect(sanitizeName("a/b", "x")).toBe("a_b");
    expect(sanitizeName("../../etc/passwd", "x")).toBe("etc_passwd");
  });

  it("trims leading and trailing underscores", () => {
    expect(sanitizeName("  spaced  ", "x")).toBe("spaced");
    expect(sanitizeName("__odd__", "x")).toBe("odd");
  });

  it("uses the fallback when nothing survives", () => {
    expect(sanitizeName("///", "007")).toBe("007");
    expect(sanitizeName("", "007")).toBe("007");
  });
});

describe("exportStem", () => {
  it("joins the project name and the asset number", () => {
    expect(exportStem("mygame", 1)).toBe("mygame_001");
    expect(exportStem("mygame", 1000)).toBe("mygame_1000");
  });

  it("uses a rename in place of the number", () => {
    expect(exportStem("mygame", 1, "hero idle")).toBe("mygame_hero_idle");
  });

  it("falls back to the number when a rename sanitizes away", () => {
    expect(exportStem("mygame", 5, "///")).toBe("mygame_005");
  });

  /**
   * The stem reaches a ZIP central directory and an object key, so a project
   * name carrying a slash decides where an archive unpacks.
   */
  it("sanitizes a project name containing a slash", () => {
    expect(exportStem("my/game", 1)).toBe("my_game_001");
    expect(exportStem("../../etc", 1)).toBe("etc_001");
  });

  it("uses a placeholder when a project name sanitizes away entirely", () => {
    expect(exportStem("///", 1)).toBe("project_001");
  });

  /**
   * Renaming a project changes future exports and leaves past ones alone,
   * which is why the name is sanitized at export time rather than stored.
   */
  it("tracks a project rename", () => {
    expect(exportStem("Before", 1)).toBe("before_001");
    expect(exportStem("After", 1)).toBe("after_001");
  });
});

describe("nextSceneName", () => {
  it("numbers from the count, so the first added is 2", () => {
    expect(nextSceneName([{ name: "scene" }])).toBe("scene 2");
    expect(nextSceneName([])).toBe("scene 1");
  });

  /**
   * Deleting from the middle leaves a gap, and reusing the count would collide
   * with a name that is still there.
   */
  it("skips names already taken", () => {
    const gapped = [{ name: "scene 3" }, { name: "scene 4" }];
    expect(nextSceneName(gapped)).toBe("scene 5");

    const clustered = [{ name: "a" }, { name: "scene 3" }, { name: "scene 4" }];
    expect(nextSceneName(clustered)).toBe("scene 5");
  });

  it("ignores renamed scenes when picking a number", () => {
    const existing = [{ name: "town" }, { name: "dungeon" }];
    expect(nextSceneName(existing)).toBe("scene 3");
  });
});
