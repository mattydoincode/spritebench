import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { buildArchive, planZipEntries, zipFilename, type PlannedEntry } from "@/client/export";
import { planSheet } from "@/core/sheet";
import { DEFAULT_PROCESSING } from "@/core/settings";
import { buildFramesManifest, buildSheetManifest } from "@/shared/manifest";
import type { ResolvedAsset } from "@/shared/model";
import type { Sequence, SequenceFrame } from "@/shared/sequence";

const CONTEXT = { projectId: "p1", projectName: "mygame" };

function frame(index: number, hold = 1): SequenceFrame {
  return {
    id: `f${index}`,
    sourceAssetId: "a",
    rect: { x: index * 32, y: 0, width: 32, height: 32 },
    edits: [],
    hold
  };
}

function sequence(overrides: Partial<Sequence> = {}): Sequence {
  return {
    id: "seq-1",
    name: "walk",
    fps: 12,
    playback: "loop",
    inset: { top: 0, right: 0, bottom: 0, left: 0 },
    frames: [frame(0), frame(1), frame(2), frame(3)],
    ...overrides
  };
}

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
    sourceWidth: 128,
    sourceHeight: 32,
    prompt: { prefix: "", body: "a knight", suffix: "" },
    composedPrompt: "a knight",
    generation: {
      model: "gpt-image-2",
      quality: "low",
      background: "transparent",
      size: "1024x1024",
      imageCount: 1
    },
    generatedWith: { ...DEFAULT_PROCESSING },
    processing: { ...DEFAULT_PROCESSING },
    sequences: [],
    exported: false,
    rerunOf: null,
    jobId: null,
    inputs: null,
    sequencePlan: null,
    usage: null,
    elapsedSeconds: null,
    expiresAt: null,
    ...overrides
  } as unknown as ResolvedAsset;
}

const paths = (entries: { path: string }[]) => entries.map((entry) => entry.path);

describe("planZipEntries for animations", () => {
  const animated = asset({ id: "a", seq: 1, sequences: [sequence()] });

  it("packs a sheet and its manifest side by side", () => {
    const plan = planZipEntries(CONTEXT, [animated], "sequenceSheet");

    expect(paths(plan)).toEqual(["mygame_001_walk.png", "mygame_001_walk.json"]);
  });

  it("puts individual frames in their own folder, zero padded and in order", () => {
    const plan = planZipEntries(CONTEXT, [animated], "sequenceFrames");

    expect(paths(plan)).toEqual([
      "mygame_001_walk/000.png",
      "mygame_001_walk/001.png",
      "mygame_001_walk/002.png",
      "mygame_001_walk/003.png",
      "mygame_001_walk/animation.json"
    ]);
  });

  it("keeps two animations on one sheet apart", () => {
    const multi = asset({
      id: "a",
      seq: 1,
      sequences: [sequence(), sequence({ id: "seq-2", name: "idle", frames: [frame(0)] })]
    });

    expect(paths(planZipEntries(CONTEXT, [multi], "sequenceSheet"))).toEqual([
      "mygame_001_walk.png",
      "mygame_001_walk.json",
      "mygame_001_idle.png",
      "mygame_001_idle.json"
    ]);
  });

  it("skips assets that have no animation rather than failing the export", () => {
    const plan = planZipEntries(
      CONTEXT,
      [asset({ id: "a", seq: 1 }), animated, asset({ id: "c", seq: 3 })],
      "sequenceSheet"
    );

    expect(paths(plan)).toEqual(["mygame_001_walk.png", "mygame_001_walk.json"]);
  });

  it("skips an animation that has been created but not yet sliced", () => {
    const empty = asset({ id: "a", seq: 1, sequences: [sequence({ frames: [] })] });

    expect(planZipEntries(CONTEXT, [empty], "sequenceFrames")).toEqual([]);
  });

  it("does not let two animations with the same name collide", () => {
    const clashing = asset({
      id: "a",
      seq: 1,
      sequences: [sequence(), sequence({ id: "seq-2", frames: [frame(0)] })]
    });

    const plan = planZipEntries(CONTEXT, [clashing], "sequenceSheet");

    expect(new Set(paths(plan)).size).toBe(plan.length);
  });

  it("falls back to the asset name for an animation with a blank name", () => {
    const unnamed = asset({ id: "a", seq: 1, sequences: [sequence({ name: "  " })] });

    expect(paths(planZipEntries(CONTEXT, [unnamed], "sequenceSheet"))).toEqual([
      "mygame_001.png",
      "mygame_001.json"
    ]);
  });

  it("carries the sequence and frame ids the builder needs", () => {
    const plan = planZipEntries(CONTEXT, [animated], "sequenceFrames");
    const frames = plan.filter((entry) => entry.variant === "sequenceFrame");

    expect(frames.map((entry) => entry.frameIndex)).toEqual([0, 1, 2, 3]);
    expect(frames.every((entry) => entry.sequenceId === "seq-1")).toBe(true);
  });
});

describe("manifests", () => {
  it("describes where each frame sits in a packed sheet", () => {
    const seq = sequence({ frames: [frame(0), frame(1, 3), frame(2), frame(3)] });
    const plan = planSheet(Array(4).fill({ width: 32, height: 32 }));

    const manifest = buildSheetManifest(seq, plan, "mygame_001_walk.png");

    expect(manifest).toMatchObject({
      format: "spritebench.sheet/1",
      name: "walk",
      fps: 12,
      playback: "loop",
      frameCount: 4
    });

    expect(manifest.sheet).toMatchObject({
      file: "mygame_001_walk.png",
      width: 64,
      height: 64,
      columns: 2,
      rows: 2
    });

    expect(manifest.frames[0]).toMatchObject({ index: 0, x: 0, y: 0, width: 32, height: 32 });
    expect(manifest.frames[3]).toMatchObject({ index: 3, x: 32, y: 32 });
  });

  it("converts holds to milliseconds, which is what engines want", () => {
    const seq = sequence({ fps: 12, frames: [frame(0), frame(1, 3)] });
    const plan = planSheet(Array(2).fill({ width: 32, height: 32 }));

    const manifest = buildSheetManifest(seq, plan, "sheet.png");

    expect(manifest.frames[0]).toMatchObject({ hold: 1, durationMs: 83 });
    expect(manifest.frames[1]).toMatchObject({ hold: 3, durationMs: 250 });
  });

  it("lists the files for a per-frame export", () => {
    const manifest = buildFramesManifest(sequence(), [
      { file: "000.png", width: 32, height: 32 },
      { file: "001.png", width: 32, height: 32 }
    ]);

    expect(manifest.format).toBe("spritebench.frames/1");
    expect(manifest.frames.map((entry) => entry.file)).toEqual(["000.png", "001.png"]);
    expect(manifest.frameCount).toBe(2);
  });

  it("records the playback mode, since ping-pong is not inferable from the frames", () => {
    const manifest = buildFramesManifest(sequence({ playback: "pingPong" }), []);

    expect(manifest.playback).toBe("pingPong");
  });
});

describe("the archive an animation export produces", () => {
  it("unpacks with the planned names, and the manifest parses", async () => {
    const seq = sequence();
    const animated = asset({ id: "a", seq: 1, sequences: [seq] });
    const plan = planZipEntries(CONTEXT, [animated], "sequenceFrames");

    const provide = async (entry: PlannedEntry) => {
      if (entry.variant === "manifest") {
        return new TextEncoder().encode(
          JSON.stringify(
            buildFramesManifest(
              seq,
              plan
                .filter((other) => other.variant === "sequenceFrame")
                .map((other) => ({
                  file: other.path.slice(other.path.lastIndexOf("/") + 1),
                  width: 32,
                  height: 32
                }))
            )
          )
        ) as Uint8Array<ArrayBuffer>;
      }

      return new Uint8Array([1, 2, 3]) as Uint8Array<ArrayBuffer>;
    };

    const { bytes, entries, failures } = await buildArchive(plan, provide);

    expect(entries).toBe(5);
    expect(failures).toEqual([]);

    const unpacked = unzipSync(bytes);

    expect(Object.keys(unpacked).sort()).toEqual([
      "mygame_001_walk/000.png",
      "mygame_001_walk/001.png",
      "mygame_001_walk/002.png",
      "mygame_001_walk/003.png",
      "mygame_001_walk/animation.json"
    ]);

    const manifest = JSON.parse(
      new TextDecoder().decode(unpacked["mygame_001_walk/animation.json"])
    );

    expect(manifest.frames).toHaveLength(4);
    expect(manifest.frames[0].file).toBe("000.png");
  });
});

describe("zipFilename", () => {
  it("says which animation export it is", () => {
    expect(zipFilename(3, "sequenceSheet")).toMatch(/^spritebench-3-images-sheets-\d{4}-\d{2}-\d{2}\.zip$/);
    expect(zipFilename(1, "sequenceFrames")).toMatch(/^spritebench-1-image-frames-\d{4}-\d{2}-\d{2}\.zip$/);
  });
});
