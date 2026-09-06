import { describe, expect, it } from "vitest";
import { describeSettings, expectedSize } from "@/core/describe";
import { applyPipeline } from "@/core/pipeline";
import { DEFAULT_PROCESSING, withDefaults, type ProcessingSettings } from "@/core/settings";
import type { Rgb } from "@/core/types";
import { loadFixture } from "./helpers";

const PALETTE: Rgb[] = [
  { r: 0, g: 0, b: 0 },
  { r: 255, g: 255, b: 255 },
  { r: 155, g: 76, b: 44 },
  { r: 70, g: 92, b: 56 }
];

/**
 * The worker used to run the whole pipeline just to read `description` off the
 * result, then throw the pixels away. These cases pin that the pixel-free
 * version produces the same label, which is what makes deleting that run safe.
 *
 * `edgeFloodFill` and `trimToContent` are excluded because they genuinely
 * depend on the image contents, and `describeSettings` documents that.
 */
const AGREEING_CASES: Array<{ name: string; settings: Partial<ProcessingSettings> }> = [
  { name: "no processing", settings: { cutout: "none", trimToContent: false, snapAlpha: false, targetSize: { width: 0, height: 0 } } },
  { name: "downsample only", settings: { cutout: "none", trimToContent: false, targetSize: { width: 0, height: 32 } } },
  {
    name: "chroma key and despeckle",
    settings: {
      cutout: "chromaKey",
      chromaKey: "#ffffff",
      despeckleMinimumNeighbors: 3,
      fillHoles: true,
      trimToContent: false,
      targetSize: { width: 0, height: 48 }
    }
  },
  {
    name: "erode and snap alpha",
    settings: {
      cutout: "luminanceAbove",
      cutoutLuminanceThreshold: 0.8,
      erodePixels: 2,
      snapAlpha: true,
      trimToContent: false,
      targetSize: { width: 24, height: 24 }
    }
  },
  {
    name: "orientation and flips",
    settings: {
      cutout: "none",
      orientation: "rotate90cw",
      flipHorizontal: true,
      flipVertical: true,
      trimToContent: false,
      targetSize: { width: 0, height: 0 }
    }
  },
  {
    name: "crop edit",
    settings: {
      cutout: "none",
      edits: [{ kind: "crop", x: 10, y: 10, width: 200, height: 200 }],
      trimToContent: false,
      targetSize: { width: 0, height: 0 }
    }
  }
];

describe("describeSettings", () => {
  for (const testCase of AGREEING_CASES) {
    it(`matches the pipeline's own label: ${testCase.name}`, () => {
      const source = loadFixture("sprite-1.png");
      const settings = withDefaults({ ...DEFAULT_PROCESSING, ...testCase.settings });

      const { description } = applyPipeline(source, settings, PALETTE);

      expect(describeSettings(settings, { width: source.width, height: source.height }, PALETTE)).toBe(
        description
      );
    });
  }

  it("needs no pixels", () => {
    const settings = withDefaults({ cutout: "chromaKey", targetSize: { width: 0, height: 32 } });

    expect(describeSettings(settings, { width: 1024, height: 1024 }, PALETTE)).toContain(
      "chromaKey"
    );
  });

  it("mentions the palette only when there is one", () => {
    const settings = withDefaults({ dither: "floydSteinberg" });
    const size = { width: 1024, height: 1024 };

    expect(describeSettings(settings, size, PALETTE)).toContain("palette 4 colors");
    expect(describeSettings(settings, size, [])).not.toContain("palette");
  });

  it("names the dither mode alongside the palette", () => {
    const size = { width: 1024, height: 1024 };

    expect(describeSettings(withDefaults({ dither: "none" }), size, PALETTE)).toContain(
      "palette 4 colors"
    );
    expect(describeSettings(withDefaults({ dither: "atkinson" }), size, PALETTE)).toContain(
      "atkinson"
    );
  });
});

describe("expectedSize", () => {
  const source = { width: 1024, height: 512 };

  it("returns the source when no target is set", () => {
    expect(expectedSize(withDefaults({ targetSize: { width: 0, height: 0 } }), source)).toEqual(
      source
    );
  });

  it("derives the missing edge from the aspect ratio", () => {
    expect(expectedSize(withDefaults({ targetSize: { width: 0, height: 64 } }), source)).toEqual({
      width: 128,
      height: 64
    });
  });

  it("accounts for a quarter turn swapping the edges", () => {
    expect(
      expectedSize(
        withDefaults({ orientation: "rotate90cw", targetSize: { width: 0, height: 64 } }),
        source
      )
    ).toEqual({ width: 32, height: 64 });
  });

  it("agrees with what the pipeline actually produces", () => {
    const image = loadFixture("sprite-1.png");
    const settings = withDefaults({
      cutout: "none",
      trimToContent: false,
      targetSize: { width: 0, height: 40 }
    });

    const { image: processed } = applyPipeline(image, settings, []);
    const predicted = expectedSize(settings, { width: image.width, height: image.height });

    expect({ width: processed.width, height: processed.height }).toEqual(predicted);
  });
});
