import { describe, expect, it } from "vitest";
import { ISO_DIAMOND_TEMPLATE_ID } from "@/core/isoMask";
import { PIXEL_CONSTRAINT_TEMPLATE_ID } from "@/core/pixelMask";
import {
  GEMINI_GUIDE_INSTRUCTIONS,
  GEMINI_REFERENCE_INSTRUCTIONS,
  ISO_DIAMOND_INSTRUCTIONS,
  PIXEL_CONSTRAINT_INSTRUCTIONS,
  activeFeaturePrompts,
  composeFeatureSlots,
  normalizeLayoutGuideInputs,
  resolveFeatureText,
  workingPrompt
} from "@/shared/featurePrompt";
import { composePrompt } from "@/shared/model";

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

  it("surfaces the Gemini reference guide for an unmasked base", () => {
    const extras = activeFeaturePrompts({
      model: "gemini-3.1-flash-image",
      base: reference
    });

    expect(extras.map((entry) => entry.id)).toEqual(["reference"]);
    expect(extras[0]?.defaultText).toBe(GEMINI_REFERENCE_INSTRUCTIONS);
  });

  it("uses an override until it is cleared", () => {
    const extra = activeFeaturePrompts({
      model: "gpt-image-2",
      mask: pixelMask
    })[0];
    if (!extra) throw new Error("expected pixel-constraint extra");

    expect(resolveFeatureText(extra, { "pixel-constraint": "fill the white" })).toBe(
      "fill the white"
    );
    expect(resolveFeatureText(extra, {})).toBe(PIXEL_CONSTRAINT_INSTRUCTIONS);
  });

  it("puts plate instructions after the subject when there is no generic guide", () => {
    const extras = activeFeaturePrompts({
      model: "gemini-3.1-flash-image",
      mask: pixelMask
    });
    const slots = composeFeatureSlots(extras, {
      "pixel-constraint": "fill in the white"
    });
    const sent = composePrompt(
      workingPrompt({
        prefix: "house style",
        body: "a crate",
        suffix: "transparent",
        model: "gemini-3.1-flash-image",
        mask: pixelMask,
        overrides: { "pixel-constraint": "fill in the white" }
      })
    );

    expect(slots.guide).toBe("");
    expect(slots.extra).toBe("fill in the white");
    expect(sent.startsWith("house style")).toBe(true);
    expect(sent).toContain("a crate");
    expect(sent).toContain("fill in the white");
    expect(sent.endsWith("transparent")).toBe(true);
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

  it("keeps the generic mask guide on a Gemini sheet", () => {
    const extras = activeFeaturePrompts({
      model: "gemini-3.1-flash-image",
      animation: {
        enabled: true,
        actions: [{ name: "walk", frames: 4 }],
        cellSize: 64
      }
    });

    expect(extras.map((entry) => entry.id)).toEqual(["guide", "animation"]);
  });
});
