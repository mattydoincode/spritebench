import { describe, expect, it } from "vitest";
import { applyPipeline } from "@/core/pipeline";
import { DEFAULT_PROCESSING, withDefaults, type ProcessingSettings } from "@/core/settings";
import type { Rgb } from "@/core/types";
import { fingerprint, loadFixture } from "./helpers";

/**
 * These pin the observable output of the image pipeline on real model output.
 * If a change here is intentional, update the snapshot; if it is not, the
 * pipeline just silently changed what every user's sprites look like.
 */

const FIXTURES = ["sprite-1.png", "sprite-2.png", "sprite-3.png"] as const;

const PALETTE: Rgb[] = [
  { r: 0, g: 0, b: 0 },
  { r: 255, g: 255, b: 255 },
  { r: 155, g: 76, b: 44 },
  { r: 70, g: 92, b: 56 },
  { r: 48, g: 62, b: 105 },
  { r: 214, g: 176, b: 108 }
];

const CASES: Array<{ name: string; settings: Partial<ProcessingSettings>; palette: Rgb[] }> = [
  {
    name: "defaults",
    settings: {},
    palette: []
  },
  {
    name: "no processing at all",
    settings: {
      cutout: "none",
      trimToContent: false,
      snapAlpha: false,
      targetSize: { width: 0, height: 0 }
    },
    palette: []
  },
  {
    name: "cutout then 32px sprite",
    settings: {
      cutout: "edgeFloodFill",
      skipCutoutTransparentBorder: 1,
      targetSize: { width: 0, height: 32 },
      pixelate: "dominantColor"
    },
    palette: []
  },
  {
    name: "cutout, despeckle, erode, trim",
    settings: {
      cutout: "edgeFloodFill",
      skipCutoutTransparentBorder: 1,
      despeckleMinimumNeighbors: 3,
      fillHoles: true,
      erodePixels: 1,
      trimToContent: true,
      trimPadding: 2,
      targetSize: { width: 0, height: 0 }
    },
    palette: []
  },
  {
    name: "palette quantize, no dither",
    settings: {
      targetSize: { width: 0, height: 48 },
      dither: "none",
      distanceMode: "oklab"
    },
    palette: PALETTE
  },
  {
    name: "palette quantize, floyd-steinberg",
    settings: {
      targetSize: { width: 0, height: 48 },
      dither: "floydSteinberg",
      ditherStrength: 1,
      distanceMode: "oklab"
    },
    palette: PALETTE
  },
  {
    name: "palette quantize, bayer4x4, weighted rgb",
    settings: {
      targetSize: { width: 0, height: 48 },
      dither: "bayer4x4",
      ditherStrength: 0.5,
      distanceMode: "weightedRgb"
    },
    palette: PALETTE
  },
  {
    name: "orientation and flips",
    settings: {
      orientation: "rotate90cw",
      flipHorizontal: true,
      flipVertical: true,
      targetSize: { width: 0, height: 0 },
      trimToContent: false
    },
    palette: []
  },
  {
    name: "nearest neighbour downsample",
    settings: {
      targetSize: { width: 24, height: 24 },
      pixelate: "nearest"
    },
    palette: []
  },
  {
    name: "chroma key cutout",
    settings: {
      cutout: "chromaKey",
      chromaKey: "#ffffff",
      cutoutTolerance: 0.3,
      targetSize: { width: 0, height: 0 }
    },
    palette: []
  },
  {
    name: "luminance cutout",
    settings: {
      cutout: "luminanceAbove",
      cutoutLuminanceThreshold: 0.8,
      targetSize: { width: 0, height: 0 }
    },
    palette: []
  }
];

describe("applyPipeline golden output", () => {
  for (const fixture of FIXTURES) {
    describe(fixture, () => {
      for (const testCase of CASES) {
        it(testCase.name, () => {
          const source = loadFixture(fixture);
          const settings = withDefaults({ ...DEFAULT_PROCESSING, ...testCase.settings });
          const { image, description } = applyPipeline(source, settings, testCase.palette);

          expect(fingerprint(image, description)).toMatchSnapshot();
        });
      }
    });
  }

  it("never mutates the source image", () => {
    const source = loadFixture("sprite-1.png");
    const before = Uint8Array.from(source.data);

    applyPipeline(source, withDefaults({}), PALETTE);

    expect(Uint8Array.from(source.data)).toEqual(before);
  });

  it("returns a detached copy when no stage does work", () => {
    const source = loadFixture("sprite-1.png");
    const settings = withDefaults({
      cutout: "none",
      trimToContent: false,
      snapAlpha: false,
      targetSize: { width: 0, height: 0 }
    });

    const { image, description } = applyPipeline(source, settings, []);

    expect(description).toBe("");
    expect(image.data).not.toBe(source.data);
    expect(Uint8Array.from(image.data)).toEqual(Uint8Array.from(source.data));
  });

  it("is deterministic across runs", () => {
    const source = loadFixture("sprite-2.png");
    const settings = withDefaults({ targetSize: { width: 0, height: 40 }, dither: "atkinson" });

    const first = applyPipeline(source, settings, PALETTE);
    const second = applyPipeline(source, settings, PALETTE);

    expect(fingerprint(first.image, first.description)).toEqual(
      fingerprint(second.image, second.description)
    );
  });
});
