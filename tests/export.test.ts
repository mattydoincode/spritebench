import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { buildArchive, planZipEntries, zipFilename, type PlannedEntry } from "@/client/export";
import { DEFAULT_PROCESSING } from "@/core/settings";
import type { AssetRecord } from "@/shared/model";

function asset(overrides: Partial<AssetRecord> & { id: string }): AssetRecord {
  return {
    name: overrides.id,
    folder: "props",
    tags: [],
    createdAt: "2026-09-05T00:00:00.000Z",
    sourceFile: `${overrides.id}.png`,
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
    processing: { ...DEFAULT_PROCESSING },
    processingDescription: "",
    approvedPath: null,
    approvedName: null,
    rerunOf: null,
    jobId: null,
    template: null,
    usage: null,
    elapsedSeconds: null,
    hasSource: true,
    expiresAt: null,
    ...overrides
  } as AssetRecord;
}

const paths = (entries: { path: string }[]) => entries.map((entry) => entry.path);

describe("planZipEntries", () => {
  it("lays a single kind out flat", () => {
    const plan = planZipEntries([asset({ id: "crate" }), asset({ id: "barrel" })], "processed");

    expect(paths(plan)).toEqual(["crate.png", "barrel.png"]);
    expect(plan.every((entry) => entry.variant === "processed")).toBe(true);
  });

  it("separates the two kinds into folders so they do not collide", () => {
    const plan = planZipEntries([asset({ id: "crate" })], "both");

    expect(paths(plan)).toEqual(["original/crate.png", "processed/crate.png"]);
  });

  it("emits one entry per asset per requested kind", () => {
    const three = [asset({ id: "a" }), asset({ id: "b" }), asset({ id: "c" })];

    expect(planZipEntries(three, "original")).toHaveLength(3);
    expect(planZipEntries(three, "processed")).toHaveLength(3);
    expect(planZipEntries(three, "both")).toHaveLength(6);
  });

  it("prefers the approved name over the generated one", () => {
    const plan = planZipEntries(
      [asset({ id: "prop_20260905_1", approvedName: "rusty_crate" })],
      "original"
    );

    expect(paths(plan)).toEqual(["rusty_crate.png"]);
  });

  /**
   * Two assets can legitimately carry the same approved name, and a ZIP with
   * duplicate entries is malformed -- unpacking silently loses one.
   */
  it("suffixes duplicate names rather than emitting a broken archive", () => {
    const plan = planZipEntries(
      [
        asset({ id: "one", approvedName: "crate" }),
        asset({ id: "two", approvedName: "crate" }),
        asset({ id: "three", approvedName: "crate" })
      ],
      "processed"
    );

    expect(paths(plan)).toEqual(["crate.png", "crate_2.png", "crate_3.png"]);
    expect(new Set(paths(plan)).size).toBe(3);
  });

  it("keeps the suffix before the extension", () => {
    const plan = planZipEntries(
      [asset({ id: "one", approvedName: "crate" }), asset({ id: "two", approvedName: "crate" })],
      "processed"
    );

    expect(plan[1].path.endsWith(".png")).toBe(true);
  });

  it("deduplicates within a folder, not across folders", () => {
    const plan = planZipEntries(
      [asset({ id: "one", approvedName: "crate" }), asset({ id: "two", approvedName: "crate" })],
      "both"
    );

    expect(paths(plan)).toEqual([
      "original/crate.png",
      "processed/crate.png",
      "original/crate_2.png",
      "processed/crate_2.png"
    ]);
  });

  it("drops a trailing .png rather than doubling it", () => {
    const plan = planZipEntries([asset({ id: "a", approvedName: "crate.png" })], "original");

    expect(paths(plan)).toEqual(["crate.png"]);
  });

  /**
   * These names reach a ZIP central directory and then a filesystem, so a
   * path separator or a leading dot-dot decides where the archive unpacks.
   */
  it("strips characters that would let a name escape the archive", () => {
    expect(paths(planZipEntries([asset({ id: "a", approvedName: "../../etc/passwd" })], "original")))
      .toEqual(["etc_passwd.png"]);

    expect(paths(planZipEntries([asset({ id: "b", approvedName: "/abs/path" })], "original")))
      .toEqual(["abs_path.png"]);

    expect(paths(planZipEntries([asset({ id: "c", approvedName: "a/b" })], "original"))).toEqual([
      "a_b.png"
    ]);
  });

  it("falls back to the asset id when a name sanitizes away entirely", () => {
    const plan = planZipEntries([asset({ id: "abc123", approvedName: "///" })], "original");

    expect(paths(plan)).toEqual(["abc123.png"]);
  });

  it("applies a name override only when exporting one asset", () => {
    expect(paths(planZipEntries([asset({ id: "a" })], "original", "chosen"))).toEqual([
      "chosen.png"
    ]);

    // Across a batch the override would collide on every entry.
    expect(paths(planZipEntries([asset({ id: "a" }), asset({ id: "b" })], "original", "chosen")))
      .toEqual(["a.png", "b.png"]);
  });

  it("returns nothing for an empty selection", () => {
    expect(planZipEntries([], "both")).toEqual([]);
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
    expect(zipFilename(12, "processed")).toMatch(/^art-studio-12-images-\d{4}-\d{2}-\d{2}\.zip$/);
    expect(zipFilename(1, "processed")).toContain("-1-image-");
    expect(zipFilename(3, "original")).toContain("-originals-");
    expect(zipFilename(3, "both")).toContain("-both-");
  });
});
