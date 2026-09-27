import { describe, expect, it } from "vitest";
import { DEFAULT_PROCESSING } from "@/core/settings";
import {
  cleanupSummary,
  modelSummary,
  modesSummary,
  paletteSummary,
  pixelArtSummary,
  templateSummary,
  transparencySummary
} from "@/shared/sectionSummary";

describe("section summaries", () => {
  it("says nothing for plain defaults", () => {
    expect(pixelArtSummary(DEFAULT_PROCESSING)).toBe("");
    expect(paletteSummary(DEFAULT_PROCESSING, "db32")).toBe("");
    expect(cleanupSummary(DEFAULT_PROCESSING)).toBe("");
    expect(modesSummary({ animation: false, each: false })).toBe("");
    expect(templateSummary({ images: 0, mask: null })).toBe("");
  });

  it("sums up what is set", () => {
    expect(pixelArtSummary({ downsample: true, targetSize: { width: 64, height: 0 } })).toBe("64 wide");
    expect(transparencySummary({ cutout: "chromaKey", chromaKeys: ["#f0f", "#0f0"], clipToIso: true })).toBe(
      "chroma key ×2 · iso clip"
    );
    expect(paletteSummary({ paletteId: "p", dither: "bayer4x4" }, "db32")).toBe("db32 · bayer 4×4");
    expect(
      cleanupSummary({ ...DEFAULT_PROCESSING, orientation: "rotate180", flipHorizontal: true, erodePixels: 2 })
    ).toBe("rotated 180° · flip x · erode 2");
    expect(modelSummary("gpt-image-2", { useAutoSize: false, size: { width: 1024, height: 1536 } })).toBe(
      "gpt-image-2 · 1024×1536"
    );
    expect(modesSummary({ animation: false, loopSteps: 4, each: false })).toBe("loop 4");
    expect(templateSummary({ images: 2, mask: "iso diamond" })).toBe("2 images · mask: iso diamond");
  });
});
