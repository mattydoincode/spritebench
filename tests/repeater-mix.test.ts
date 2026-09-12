import { describe, expect, it } from "vitest";
import { DEFAULT_PROCESSING } from "@/core/settings";
import { DEFAULT_GENERATION, type ResolvedAsset } from "@/shared/model";
import { expandRepeaterMix, isSetAsset } from "@/shared/repeaterMix";
import type { Sequence } from "@/shared/sequence";

function asset(id: string, sequences: Sequence[]): ResolvedAsset {
  return {
    id,
    seq: 1,
    createdAt: "",
    createdByUserId: null,
    sourceWidth: 64,
    sourceHeight: 64,
    prompt: { prefix: "", body: "", suffix: "" },
    composedPrompt: "",
    generation: DEFAULT_GENERATION,
    generatedWith: DEFAULT_PROCESSING,
    exportPath: null,
    rerunOf: null,
    jobId: null,
    inputs: null,
    sequencePlan: null,
    usage: null,
    elapsedSeconds: null,
    hasSource: true,
    expiresAt: null,
    label: id,
    name: id,
    folder: "",
    tags: [],
    processing: DEFAULT_PROCESSING,
    sequences,
    hidden: false,
    set: null
  };
}

function frame(id: string, assetId: string) {
  return {
    id,
    sourceAssetId: assetId,
    rect: { x: 0, y: 0, width: 16, height: 16 },
    edits: [],
    hold: 1
  };
}

function walk(): Sequence {
  return {
    id: "walk",
    name: "walk",
    kind: "animation",
    fps: 12,
    playback: "loop",
    inset: { top: 0, right: 0, bottom: 0, left: 0 },
    frames: [frame("w0", "anim"), frame("w1", "anim"), frame("w2", "anim")]
  };
}

function items(): Sequence {
  return {
    id: "items",
    name: "items",
    kind: "set",
    fps: 4,
    playback: "loop",
    inset: { top: 0, right: 0, bottom: 0, left: 0 },
    frames: [frame("i0", "set"), frame("i1", "set"), frame("i2", "set"), frame("i3", "set")]
  };
}

describe("expandRepeaterMix", () => {
  it("keeps an animation asset as one mix entry", () => {
    const mix = expandRepeaterMix([asset("anim", [walk()])]);

    expect(mix).toHaveLength(1);
    expect(mix[0].asset.id).toBe("anim");
    expect(mix[0].frame).toBeNull();
  });

  it("expands a set into one entry per cell", () => {
    const mix = expandRepeaterMix([asset("set", [items()])]);

    expect(mix.map((entry) => entry.frame?.id)).toEqual(["i0", "i1", "i2", "i3"]);
  });

  it("concatenates two sets and leaves a still as one entry", () => {
    const mix = expandRepeaterMix([
      asset("set", [items()]),
      asset("bin", []),
      asset("set-b", [items()])
    ]);

    expect(mix).toHaveLength(9);
    expect(mix[4].asset.id).toBe("bin");
    expect(mix[4].frame).toBeNull();
  });
});

describe("isSetAsset", () => {
  it("reads the sequence kind or the plan", () => {
    expect(isSetAsset(asset("set", [items()]))).toBe(true);
    expect(isSetAsset(asset("anim", [walk()]))).toBe(false);
    expect(isSetAsset({ sequences: [], sequencePlan: { kind: "set" } })).toBe(true);
  });
});
