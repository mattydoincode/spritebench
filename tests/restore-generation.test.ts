import { describe, expect, it } from "vitest";
import { ISO_DIAMOND_TEMPLATE_ID } from "@/core/isoMask";
import { DEFAULT_PROCESSING } from "@/core/settings";
import { planAnimation } from "@/shared/animationPrompt";
import { DEFAULT_GENERATION, type PromptSpec } from "@/shared/model";
import { cellSizeFromPlan, defaultGenerateSetup, restoreGeneration } from "@/shared/restoreGeneration";

const prompt: PromptSpec = {
  prefix: "top down",
  body: "a knight",
  suffix: "transparent",
  extra: "Draw a 4 by 2 sprite sheet."
};

const isoMask = {
  source: { kind: "template" as const, templateId: ISO_DIAMOND_TEMPLATE_ID },
  maskSource: "keepInsideShape" as const,
  dilatePixels: 0,
  fit: "contain" as const
};

const reference = {
  source: { kind: "asset" as const, assetId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" },
  fit: "contain" as const,
  matchAspect: true
};

describe("restoreGeneration", () => {
  it("joins a split prompt into one box", () => {
    const restored = restoreGeneration({
      prompt,
      generation: DEFAULT_GENERATION,
      generatedWith: DEFAULT_PROCESSING,
      inputs: null,
      sequencePlan: null
    });

    expect(restored.promptBody).toBe("top down\n\na knight\n\nDraw a 4 by 2 sprite sheet.\n\ntransparent");
    expect(restored.animation.enabled).toBe(false);
    expect(restored.itemGrid.enabled).toBe(false);
    expect(restored.loop.enabled).toBe(false);
    expect(restored.chunk.enabled).toBe(false);
    expect(restored.each.enabled).toBe(false);
  });

  it("restores an animation sheet and cell size from the canvas", () => {
    const planned = planAnimation({
      subject: "",
      actions: [
        { name: "idle", frames: 4 },
        { name: "walk", frames: 6 }
      ],
      cellSize: 64
    });

    const restored = restoreGeneration({
      prompt: { prefix: "", body: "a knight", suffix: "" },
      generation: { ...DEFAULT_GENERATION, size: planned.sheet.size },
      generatedWith: DEFAULT_PROCESSING,
      inputs: null,
      sequencePlan: planned.plan
    });

    expect(restored.animation.enabled).toBe(true);
    expect(restored.animation.actions).toEqual([
      { name: "idle", frames: 4 },
      { name: "walk", frames: 6 }
    ]);
    expect(restored.animation.cellSize).toBe(64);
    expect(restored.itemGrid.enabled).toBe(false);
    expect(cellSizeFromPlan(planned.plan, { size: planned.sheet.size })).toBe(64);
  });

  it("prefers the plate sprite size when present", () => {
    expect(
      cellSizeFromPlan(
        {
          columns: 4,
          rows: 2,
          fps: 8,
          actions: [{ name: "walk", frames: 4 }],
          plate: {
            canvas: { width: 1024, height: 512 },
            origin: { x: 0, y: 0 },
            cell: { width: 256, height: 256 },
            sprite: { width: 32, height: 48 }
          }
        },
        { size: { width: 1024, height: 512 } }
      )
    ).toBe(32);
  });

  it("restores an item grid from a set plan", () => {
    const restored = restoreGeneration({
      prompt: { prefix: "", body: "potion", suffix: "" },
      generation: { ...DEFAULT_GENERATION, size: { width: 1024, height: 1024 } },
      generatedWith: DEFAULT_PROCESSING,
      inputs: null,
      sequencePlan: {
        kind: "set",
        columns: 4,
        rows: 4,
        fps: 1,
        actions: Array.from({ length: 16 }, (_, index) => ({ name: `item ${index + 1}`, frames: 1 }))
      }
    });

    expect(restored.itemGrid.enabled).toBe(true);
    expect(restored.itemGrid.columns).toBe(4);
    expect(restored.itemGrid.rows).toBe(4);
    expect(restored.animation.enabled).toBe(false);
  });

  it("restores a loop and its start image", () => {
    const restored = restoreGeneration({
      prompt: { prefix: "", body: "weather the sign", suffix: "" },
      generation: DEFAULT_GENERATION,
      generatedWith: { ...DEFAULT_PROCESSING, downsample: true },
      inputs: {
        start: reference,
        base: {
          source: { kind: "asset", assetId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" },
          fit: "contain",
          matchAspect: true
        },
        loop: { steps: 6, index: 3, sendStart: true, includeStart: true }
      },
      sequencePlan: null,
      folder: "loops"
    });

    expect(restored.loop).toEqual({
      enabled: true,
      steps: 6,
      sendStart: true,
      includeStart: true
    });
    expect(restored.bases).toEqual([reference]);
    expect(restored.folder).toBe("loops");
    expect(restored.processing.downsample).toBe(true);
    expect(restored.animation.enabled).toBe(false);
  });

  it("restores each mode from a revise job", () => {
    const restored = restoreGeneration({
      prompt: { prefix: "", body: "clean the edges", suffix: "" },
      generation: DEFAULT_GENERATION,
      generatedWith: DEFAULT_PROCESSING,
      inputs: { base: reference, each: true },
      sequencePlan: null,
      folder: "batch"
    });

    expect(restored.each.enabled).toBe(true);
    expect(restored.bases).toEqual([reference]);
    expect(restored.folder).toBe("batch");
    expect(restored.loop.enabled).toBe(false);
    expect(restored.chunk.enabled).toBe(false);
  });

  it("restores mask and base", () => {
    const restored = restoreGeneration({
      prompt: { prefix: "", body: "a crate", suffix: "" },
      generation: { ...DEFAULT_GENERATION, model: "gemini-3.1-flash-image" },
      generatedWith: DEFAULT_PROCESSING,
      inputs: { base: reference, mask: isoMask },
      sequencePlan: null
    });

    expect(restored.mask).toEqual(isoMask);
    expect(restored.bases).toEqual([reference]);
    expect(restored.generation.model).toBe("gemini-3.1-flash-image");
  });
});

describe("defaultGenerateSetup", () => {
  it("keeps the model and restores everything else", () => {
    const setup = defaultGenerateSetup("gemini-3.1-flash-image");

    expect(setup.generation.model).toBe("gemini-3.1-flash-image");
    expect(setup.generation).toEqual({
      ...DEFAULT_GENERATION,
      model: "gemini-3.1-flash-image"
    });
    expect(setup.processing).toEqual(DEFAULT_PROCESSING);
    expect(setup.promptBody).toBe("");
    expect(setup.folder).toBe("");
    expect(setup.bases).toEqual([]);
    expect(setup.mask).toBeNull();
    expect(setup.animateExpansions).toBe(false);
    expect(setup.animation.enabled).toBe(false);
    expect(setup.itemGrid.enabled).toBe(false);
    expect(setup.loop.enabled).toBe(false);
    expect(setup.chunk.enabled).toBe(false);
    expect(setup.each.enabled).toBe(false);
  });
});
