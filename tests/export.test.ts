import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { buildArchive, planZipEntries, zipFilename, type PlannedEntry } from "@/client/export";
import { DEFAULT_PROCESSING } from "@/core/settings";
import type { ResolvedAsset } from "@/shared/model";

const CONTEXT = { projectId: "p1", projectName: "mygame" };

function asset(
  overrides: Partial<ResolvedAsset> & { id: string; seq: number }
): ResolvedAsset {
  return {
    name: "",
    label: String(overrides.seq).padStart(3, "0"),
    folder: "props",
    tags: [],
    createdAt: "2026-09-05T00:00:00.000Z",
    createdByUserId: null,
    hasSource: true,
    sourceWidth: 1024,
    sourceHeight: 1024,
    prompt: { prefix: "", body: "a crate", suffix: "" },
    composedPrompt: "a crate",
    generation: {
      model: "gpt-image-1",
      quality: "low",
      background: "transparent",
      size: "1024x1024",
      imageCount: 1
    },
    generatedWith: { ...DEFAULT_PROCESSING },
    processing: { ...DEFAULT_PROCESSING },
    sequences: [],
    edits: [],
    exported: false,
    rerunOf: null,
    jobId: null,
    inputs: null,
    usage: null,
    elapsedSeconds: null,
    expiresAt: null,
    ...overrides
  } as ResolvedAsset;
}

const paths = (entries: { path: string }[]) => entries.map((entry) => entry.path);

describe("planZipEntries", () => {
  it("names entries after the project and the asset number", () => {
    const plan = planZipEntries(
      CONTEXT,
      [asset({ id: "a", seq: 1 }), asset({ id: "b", seq: 2 })],
      "processed"
    );

    expect(paths(plan)).toEqual(["mygame_001.png", "mygame_002.png"]);
    expect(plan.every((entry) => entry.variant === "processed")).toBe(true);
  });

  it("separates the two kinds into folders so they do not collide", () => {
    const plan = planZipEntries(CONTEXT, [asset({ id: "a", seq: 1 })], "both");

    expect(paths(plan)).toEqual(["original/mygame_001.png", "processed/mygame_001.png"]);
  });

  it("emits one entry per asset per requested kind", () => {
    const three = [
      asset({ id: "a", seq: 1 }),
      asset({ id: "b", seq: 2 }),
      asset({ id: "c", seq: 3 })
    ];

    expect(planZipEntries(CONTEXT, three, "original")).toHaveLength(3);
    expect(planZipEntries(CONTEXT, three, "processed")).toHaveLength(3);
    expect(planZipEntries(CONTEXT, three, "both")).toHaveLength(6);
  });

  it("prefers a rename over the number", () => {
    const plan = planZipEntries(
      CONTEXT,
      [asset({ id: "a", seq: 7, name: "rusty crate" })],
      "original"
    );

    expect(paths(plan)).toEqual(["mygame_rusty_crate.png"]);
  });

  it("falls back to the number when a rename is cleared", () => {
    const plan = planZipEntries(CONTEXT, [asset({ id: "a", seq: 7, name: "  " })], "original");

    expect(paths(plan)).toEqual(["mygame_007.png"]);
  });

  /**
   * Two assets can legitimately carry the same rename, and a ZIP with
   * duplicate entries is malformed -- unpacking silently loses one.
   */
  it("suffixes duplicate names rather than emitting a broken archive", () => {
    const plan = planZipEntries(
      CONTEXT,
      [
        asset({ id: "one", seq: 1, name: "crate" }),
        asset({ id: "two", seq: 2, name: "crate" }),
        asset({ id: "three", seq: 3, name: "crate" })
      ],
      "processed"
    );

    expect(paths(plan)).toEqual([
      "mygame_crate.png",
      "mygame_crate_2.png",
      "mygame_crate_3.png"
    ]);
    expect(new Set(paths(plan)).size).toBe(3);
  });

  it("keeps the suffix before the extension", () => {
    const plan = planZipEntries(
      CONTEXT,
      [asset({ id: "one", seq: 1, name: "crate" }), asset({ id: "two", seq: 2, name: "crate" })],
      "processed"
    );

    expect(plan[1].path.endsWith(".png")).toBe(true);
  });

  it("deduplicates within a folder, not across folders", () => {
    const plan = planZipEntries(
      CONTEXT,
      [asset({ id: "one", seq: 1, name: "crate" }), asset({ id: "two", seq: 2, name: "crate" })],
      "both"
    );

    expect(paths(plan)).toEqual([
      "original/mygame_crate.png",
      "processed/mygame_crate.png",
      "original/mygame_crate_2.png",
      "processed/mygame_crate_2.png"
    ]);
  });

  /**
   * These names reach a ZIP central directory and then a filesystem, so a
   * path separator or a leading dot-dot decides where the archive unpacks.
   */
  it("strips characters that would let a name escape the archive", () => {
    const stems = (name: string) =>
      paths(planZipEntries(CONTEXT, [asset({ id: "a", seq: 1, name })], "original"));

    expect(stems("../../etc/passwd")).toEqual(["mygame_etc_passwd.png"]);
    expect(stems("/abs/path")).toEqual(["mygame_abs_path.png"]);
    expect(stems("a/b")).toEqual(["mygame_a_b.png"]);
  });

  it("sanitizes a project name containing a slash", () => {
    const plan = planZipEntries(
      { projectId: "p1", projectName: "my/../game" },
      [asset({ id: "a", seq: 1 })],
      "original"
    );

    expect(paths(plan)).toEqual(["my_game_001.png"]);
  });

  it("falls back to the number when a rename sanitizes away entirely", () => {
    const plan = planZipEntries(
      CONTEXT,
      [asset({ id: "a", seq: 4, name: "///" })],
      "original"
    );

    expect(paths(plan)).toEqual(["mygame_004.png"]);
  });

  it("applies a name override only when exporting one asset", () => {
    expect(
      paths(planZipEntries(CONTEXT, [asset({ id: "a", seq: 1 })], "original", "chosen"))
    ).toEqual(["chosen.png"]);

    // Across a batch the override would collide on every entry.
    expect(
      paths(
        planZipEntries(
          CONTEXT,
          [asset({ id: "a", seq: 1 }), asset({ id: "b", seq: 2 })],
          "original",
          "chosen"
        )
      )
    ).toEqual(["mygame_001.png", "mygame_002.png"]);
  });

  it("drops a trailing .png from an override rather than doubling it", () => {
    const plan = planZipEntries(
      CONTEXT,
      [asset({ id: "a", seq: 1 })],
      "original",
      "crate.png"
    );

    expect(paths(plan)).toEqual(["crate.png"]);
  });

  it("returns nothing for an empty selection", () => {
    expect(planZipEntries(CONTEXT, [], "both")).toEqual([]);
  });
});

function entry(path: string, variant: PlannedEntry["variant"] = "processed"): PlannedEntry {
  return { assetId: path, path, variant };
}

/** Distinctive, incompressible-ish content so byte-identity is meaningful. */
function payload(seed: number, length = 256): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) bytes[i] = (seed * 31 + i * 17) % 256;
  return bytes;
}

/**
 * These assertions unpack the real archive with an independent reader, which
 * is the part that would otherwise only be checkable by downloading a file and
 * opening it by hand.
 */
describe("buildArchive", () => {
  it("produces an archive that unpacks with the planned names", async () => {
    const plan = [entry("original/crate.png", "original"), entry("processed/crate.png")];

    const { bytes, entries, failures } = await buildArchive(plan, async (planned) =>
      payload(planned.path.length)
    );

    expect(entries).toBe(2);
    expect(failures).toEqual([]);
    expect(Object.keys(unzipSync(bytes)).sort()).toEqual([
      "original/crate.png",
      "processed/crate.png"
    ]);
  });

  it("round-trips bytes exactly", async () => {
    const plan = [entry("a.png"), entry("b.png"), entry("c.png")];
    const given = new Map(plan.map((planned, index) => [planned.path, payload(index + 1, 1024)]));

    const { bytes } = await buildArchive(plan, async (planned) => given.get(planned.path)!);
    const unpacked = unzipSync(bytes);

    for (const [path, expected] of given) {
      expect(Array.from(unpacked[path])).toEqual(Array.from(expected));
    }
  });

  it("stores rather than deflates, since PNG is already compressed", async () => {
    // Stored entries leave the archive slightly larger than the payload; a
    // deflated archive of highly compressible input would come out far smaller.
    const compressible = new Uint8Array(4096) as Uint8Array<ArrayBuffer>;
    const { bytes } = await buildArchive([entry("flat.png")], async () => compressible);

    expect(bytes.length).toBeGreaterThan(compressible.length);
  });

  it("writes an empty file rather than dropping a zero-byte source", async () => {
    const { bytes, entries } = await buildArchive(
      [entry("empty.png")],
      async () => new Uint8Array(0) as Uint8Array<ArrayBuffer>
    );

    expect(entries).toBe(1);
    expect(unzipSync(bytes)["empty.png"].length).toBe(0);
  });

  /**
   * One rolled-off original among fifty good images should cost the user that
   * one file, not the whole export.
   */
  it("keeps going when one entry fails, and reports which", async () => {
    const plan = [entry("good.png"), entry("gone.png", "original"), entry("also-good.png")];

    const { bytes, entries, failures } = await buildArchive(plan, async (planned) => {
      if (planned.path === "gone.png") throw new Error("rolled off");
      return payload(1);
    });

    expect(entries).toBe(2);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("gone.png");
    expect(failures[0]).toContain("original");
    expect(failures[0]).toContain("rolled off");
    expect(Object.keys(unzipSync(bytes)).sort()).toEqual(["also-good.png", "good.png"]);
  });

  it("throws rather than handing over an empty archive", async () => {
    await expect(
      buildArchive([entry("a.png"), entry("b.png")], async () => {
        throw new Error("storage unreachable");
      })
    ).rejects.toThrow(/storage unreachable/);
  });

  it("reports progress once per entry and once for packaging", async () => {
    const plan = [entry("a.png"), entry("b.png")];
    const seen: string[] = [];

    await buildArchive(plan, async () => payload(2), (progress) =>
      seen.push(`${progress.done}/${progress.total}:${progress.label}`)
    );

    expect(seen).toEqual(["0/2:a.png", "1/2:b.png", "2/2:packaging"]);
  });

  it("handles a selection larger than the free quota", async () => {
    const plan = Array.from({ length: 120 }, (_, index) => entry(`asset_${index}.png`));

    const { bytes, entries } = await buildArchive(plan, async () => payload(3, 512));

    expect(entries).toBe(120);
    expect(Object.keys(unzipSync(bytes))).toHaveLength(120);
  });
});

describe("zipFilename", () => {
  it("names the archive after what it holds", () => {
    expect(zipFilename(12, "processed")).toMatch(/^spritebench-12-images-\d{4}-\d{2}-\d{2}\.zip$/);
    expect(zipFilename(1, "processed")).toContain("-1-image-");
    expect(zipFilename(3, "original")).toContain("-originals-");
    expect(zipFilename(3, "both")).toContain("-both-");
  });
});
