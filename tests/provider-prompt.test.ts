import { describe, expect, it } from "vitest";
import { composePrompt, DEFAULT_GENERATION } from "@/shared/model";
import { GEMINI_GUIDE_INSTRUCTIONS } from "@/shared/featurePrompt";
import {
  composeProviderPrompt,
  providerAttachmentPlan,
  providerAuditLines,
  providerPromptSections
} from "@/shared/providerPrompt";

const grassPrompt = {
  guide: GEMINI_GUIDE_INSTRUCTIONS,
  prefix: "",
  body: "a field of grass\n\n2:1 isometric",
  extra: "",
  suffix: ""
};

const grass = {
  prompt: grassPrompt,
  composedPrompt: composePrompt(grassPrompt),
  generation: { ...DEFAULT_GENERATION, model: "gemini-3.1-flash-image" },
  inputs: {
    mask: {
      source: { kind: "template" as const, templateId: "builtin:iso-diamond" },
      maskSource: "keepInsideShape" as const,
      dilatePixels: 0,
      fit: "contain" as const
    }
  },
  sequencePlan: null
};

describe("providerPrompt", () => {
  it("puts the Gemini guide preamble in front of a masked edit", () => {
    const sent = composeProviderPrompt(grass);
    expect(sent.startsWith(GEMINI_GUIDE_INSTRUCTIONS)).toBe(true);
    expect(sent).toContain("a field of grass");
    expect(providerAttachmentPlan(grass)).toEqual([
      { id: "guide", label: "layout guide · white = draw" }
    ]);
    expect(providerPromptSections(grass).map((section) => section.id)).toEqual([
      "system",
      "body"
    ]);
  });

  it("lists both Gemini attachments when a loop has a pixel grid", () => {
    const loop = {
      prompt: { prefix: "", body: "turn left", suffix: "" },
      composedPrompt: "turn left",
      generation: { ...DEFAULT_GENERATION, model: "gemini-3.1-flash-image" },
      inputs: {
        base: {
          source: { kind: "asset" as const, assetId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" },
          fit: "contain" as const,
          matchAspect: true
        },
        mask: {
          source: { kind: "template" as const, templateId: "builtin:pixel-constraint" },
          maskSource: "transparentWhereLight" as const,
          dilatePixels: 0,
          fit: "stretch" as const,
          window: { width: 32, height: 48 }
        }
      },
      sequencePlan: null
    };

    expect(providerAttachmentPlan(loop)).toEqual([
      { id: "reference", label: "starting image" },
      { id: "guide", label: "pixel grid" }
    ]);
  });

  it("sends OpenAI the user prompt and the raw base/mask pair", () => {
    const openai = {
      ...grass,
      generation: { ...DEFAULT_GENERATION, model: "gpt-image-2" }
    };

    expect(composeProviderPrompt(openai)).toBe(openai.composedPrompt);
    expect(providerAttachmentPlan(openai)).toEqual([
      { id: "base", label: "base image" },
      { id: "mask", label: "mask · transparent = draw" }
    ]);
  });

  it("has no attachments on a plain generate", () => {
    const still = {
      prompt: { prefix: "house style", body: "a crate", suffix: "" },
      composedPrompt: "house style\n\na crate",
      generation: DEFAULT_GENERATION,
      inputs: null,
      sequencePlan: null
    };

    expect(providerAttachmentPlan(still)).toEqual([]);
    expect(composeProviderPrompt(still)).toBe("house style\n\na crate");
    expect(providerPromptSections(still).map((section) => section.id)).toEqual([
      "prefix",
      "body"
    ]);
  });

  it("logs the model, snapped Gemini size, and billed key", () => {
    const lines = providerAuditLines({
      ...grass,
      sourceSize: { width: 1376, height: 768 },
      resolvedSize: { width: 1024, height: 576 },
      key: { provider: "gemini", label: "studio", keySuffix: "...wxyz" },
      billedKeyId: "key-1"
    });
    const byLabel = Object.fromEntries(lines.map((line) => [line.label, line.value]));

    expect(byLabel.model).toMatch(/Gemini 3.1 Flash Image/);
    expect(byLabel.key).toBe("Gemini · studio · …wxyz");
    expect(byLabel.size).toBe("asked 1024×1024 · sent 1024×576 (16:9 · 1K) · got 1376×768");
    expect(byLabel.call).toBe("edit · masked");
    expect(byLabel.mask).toContain("builtin:iso-diamond");
    expect(byLabel.quality).toBeUndefined();
  });

  it("logs base, mask, loop step, and chunk cell", () => {
    const lines = providerAuditLines({
      prompt: { prefix: "", body: "detail this", suffix: "" },
      composedPrompt: "detail this",
      generation: DEFAULT_GENERATION,
      inputs: {
        base: {
          source: { kind: "asset", assetId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" },
          fit: "contain",
          matchAspect: true
        },
        mask: {
          source: { kind: "template", templateId: "builtin:iso-diamond" },
          maskSource: "keepInsideShape",
          dilatePixels: 0,
          fit: "contain"
        },
        loop: { steps: 4, index: 2 },
        chunk: { columns: 2, rows: 2, index: 3, rect: { x: 32, y: 32, width: 32, height: 32 } }
      }
    });
    const byLabel = Object.fromEntries(lines.map((line) => [line.label, line.value]));

    expect(byLabel.call).toBe("edit · masked");
    expect(byLabel.base).toContain("aaaaaaaa");
    expect(byLabel.mask).toContain("builtin:iso-diamond");
    expect(byLabel.loop).toBe("step 2 of 4");
    expect(byLabel.chunk).toBe("2×2 · cell 4");
  });
});
