import { describe, expect, it } from "vitest";
import { ISO_21_TEMPLATE_ID, ISO_DIAMOND_TEMPLATE_ID } from "@/core/isoMask";
import { SHEET_FRAMES_TEMPLATE_ID } from "@/core/frameMask";
import { PIXEL_CONSTRAINT_TEMPLATE_ID } from "@/core/pixelMask";
import {
  GEMINI_GUIDE_INSTRUCTIONS,
  GEMINI_REFERENCE_INSTRUCTIONS,
  GEMINI_REVISE_INSTRUCTIONS,
  ISO_21_INSTRUCTIONS,
  ISO_DIAMOND_INSTRUCTIONS,
  PIXEL_CONSTRAINT_INSTRUCTIONS,
  PIXEL_CONSTRAINT_SHEET_NOTE,
  SHEET_FRAMES_INSTRUCTIONS,
  activeFeaturePrompts,
  appendSuggestedPrompt,
  normalizeLayoutGuideInputs,
  promptWithEachGuide
} from "@/shared/featurePrompt";

const isoMask = {
  source: { kind: "template" as const, templateId: ISO_DIAMOND_TEMPLATE_ID },
  maskSource: "keepInsideShape" as const,
  dilatePixels: 0,
  fit: "contain" as const
};

const pixelMask = {
  source: { kind: "template" as const, templateId: PIXEL_CONSTRAINT_TEMPLATE_ID },
  maskSource: "transparentWhereLight" as const,
  dilatePixels: 0,
  fit: "stretch" as const,
  window: { width: 32, height: 48 }
};

const customMask = {
  source: { kind: "template" as const, templateId: "sketch-1" },
  maskSource: "keepOutsideShape" as const,
  dilatePixels: 0,
  fit: "contain" as const
};

const reference = {
  source: { kind: "asset" as const, assetId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" },
  fit: "contain" as const,
  matchAspect: true
};

describe("feature prompts", () => {
  it("uses only the iso plate text, not the generic mask guide", () => {
    const extras = activeFeaturePrompts({
      model: "gemini-3.1-flash-image",
      mask: isoMask
    });

    expect(extras.map((entry) => entry.id)).toEqual(["iso-diamond"]);
    expect(extras[0]?.defaultText).toBe(ISO_DIAMOND_INSTRUCTIONS);
  });

  it("uses the 2:1 plate text for the dimetric template", () => {
    const extras = activeFeaturePrompts({
      model: "gemini-3.1-flash-image",
      mask: {
        ...isoMask,
        source: { kind: "template", templateId: ISO_21_TEMPLATE_ID }
      }
    });

    expect(extras.map((entry) => entry.id)).toEqual(["iso-diamond"]);
    expect(extras[0]?.defaultText).toBe(ISO_21_INSTRUCTIONS);
  });

  it("uses only the pixel-constraint text, not the generic mask guide", () => {
    const extras = activeFeaturePrompts({
      model: "gemini-3.1-flash-image",
      mask: pixelMask
    });

    expect(extras.map((entry) => entry.id)).toEqual(["pixel-constraint"]);
    expect(extras[0]?.defaultText).toBe(PIXEL_CONSTRAINT_INSTRUCTIONS);
  });

  it("does not treat a layout plate as a composition reference", () => {
    const extras = activeFeaturePrompts({
      model: "gemini-3.1-flash-image",
      base: {
        source: { kind: "template", templateId: PIXEL_CONSTRAINT_TEMPLATE_ID },
        fit: "contain",
        matchAspect: true
      }
    });

    expect(extras.map((entry) => entry.id)).toEqual(["pixel-constraint"]);
    expect(extras.some((entry) => entry.id === "reference" || entry.id === "guide")).toBe(false);
  });

  it("keeps the generic mask guide for a custom stencil", () => {
    const extras = activeFeaturePrompts({
      model: "gemini-3.1-flash-image",
      mask: customMask
    });

    expect(extras.map((entry) => entry.id)).toEqual(["guide"]);
    expect(extras[0]?.defaultText).toBe(GEMINI_GUIDE_INSTRUCTIONS);
  });

  it("pairs a real reference with the pixel plate, not a third guide", () => {
    const extras = activeFeaturePrompts({
      model: "gemini-3.1-flash-image",
      base: reference,
      mask: pixelMask
    });

    expect(extras.map((entry) => entry.id)).toEqual(["reference", "pixel-constraint"]);
  });

  it("surfaces the Gemini revise guide when each is on", () => {
    const extras = activeFeaturePrompts({
      model: "gemini-3.1-flash-image",
      base: reference,
      each: true
    });

    expect(extras.map((entry) => entry.id)).toEqual(["revise"]);
    expect(extras[0]?.defaultText).toBe(GEMINI_REVISE_INSTRUCTIONS);
  });

  it("attaches the revise guide on Gemini each jobs", () => {
    const prompt = { prefix: "", body: "clean the edges", suffix: "" };
    expect(promptWithEachGuide(prompt, true, "gemini-3.1-flash-image").guide).toBe(
      GEMINI_REVISE_INSTRUCTIONS
    );
    expect(promptWithEachGuide(prompt, true, "gpt-image-2").guide).toBeUndefined();
    expect(promptWithEachGuide({ ...prompt, guide: "keep this" }, true, "gemini-3.1-flash-image").guide).toBe(
      "keep this"
    );
  });

  it("surfaces the Gemini reference guide for an unmasked base", () => {
    const extras = activeFeaturePrompts({
      model: "gemini-3.1-flash-image",
      base: reference
    });

    expect(extras.map((entry) => entry.id)).toEqual(["reference"]);
    expect(extras[0]?.defaultText).toBe(GEMINI_REFERENCE_INSTRUCTIONS);
  });

  it("appends suggested text once", () => {
    expect(appendSuggestedPrompt("", "fill the diamond")).toBe("fill the diamond");
    expect(appendSuggestedPrompt("a crate", "fill the diamond")).toBe(
      "a crate\n\nfill the diamond"
    );
    expect(appendSuggestedPrompt("a crate\n\nfill the diamond", "fill the diamond")).toBe(
      "a crate\n\nfill the diamond"
    );
  });

  it("moves a layout plate from reference onto the mask", () => {
    const next = normalizeLayoutGuideInputs({
      base: {
        source: { kind: "template", templateId: PIXEL_CONSTRAINT_TEMPLATE_ID },
        fit: "contain",
        matchAspect: true
      },
      mask: null
    });

    expect(next.base).toBeNull();
    expect(next.mask?.source).toEqual({
      kind: "template",
      templateId: PIXEL_CONSTRAINT_TEMPLATE_ID
    });
  });

  it("shows sheet instructions as an editable extra", () => {
    const extras = activeFeaturePrompts({
      model: "gpt-image-2",
      animation: {
        enabled: true,
        actions: [{ name: "walk", frames: 4 }],
        cellSize: 64
      }
    });

    expect(extras.map((entry) => entry.id)).toEqual(["animation"]);
    expect(extras[0]?.defaultText).toMatch(/sprite sheet/);
  });

  it("sends only the sheet extra on a Gemini sheet", () => {
    const extras = activeFeaturePrompts({
      model: "gemini-3.1-flash-image",
      animation: {
        enabled: true,
        actions: [{ name: "walk", frames: 4 }],
        cellSize: 64
      }
    });

    expect(extras.map((entry) => entry.id)).toEqual(["animation"]);
  });

  it("pairs pixel constraint with the sheet extra, not a generic mask guide", () => {
    const extras = activeFeaturePrompts({
      model: "gemini-3.1-flash-image",
      mask: pixelMask,
      animation: {
        enabled: true,
        actions: [{ name: "walk", frames: 4 }],
        cellSize: 64
      }
    });

    expect(extras.map((entry) => entry.id)).toEqual(["pixel-constraint", "animation"]);
    expect(extras[0]?.defaultText).toContain(PIXEL_CONSTRAINT_SHEET_NOTE);
    expect(extras[1]?.defaultText).toMatch(/own pixel grid/);
    expect(extras[1]?.defaultText).not.toMatch(/Covered cells are masked/);
  });

  it("pairs the frames plate with the sheet extra, not a pixel grid", () => {
    const extras = activeFeaturePrompts({
      model: "gemini-3.1-flash-image",
      mask: {
        source: { kind: "template", templateId: SHEET_FRAMES_TEMPLATE_ID },
        maskSource: "transparentWhereLight",
        dilatePixels: 0,
        fit: "stretch"
      },
      animation: {
        enabled: true,
        actions: [{ name: "walk", frames: 4 }],
        cellSize: 64
      }
    });

    expect(extras.map((entry) => entry.id)).toEqual(["frames", "animation"]);
    expect(extras[0]?.defaultText).toBe(SHEET_FRAMES_INSTRUCTIONS);
    expect(extras[1]?.defaultText).toMatch(/white rectangle/);
    expect(extras[1]?.defaultText).not.toMatch(/pixel grid/);
    expect(extras[1]?.defaultText).not.toMatch(/Covered cells are masked/);
  });
});
