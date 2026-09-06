import { describe, expect, it } from "vitest";
import {
  cut,
  despeckle,
  erodeAlpha,
  sampleBackgroundColor,
  snapAlpha,
  transparentBorderFraction,
  trimToContent
} from "@/core/cutout";
import { createImage } from "@/core/pixels";
import type { Rgb } from "@/core/types";
import { alphaAt, countOpaque, framed, solid } from "./helpers";

const MAGENTA: Rgb = { r: 255, g: 0, b: 255 };
const WHITE: Rgb = { r: 255, g: 255, b: 255 };
const BLACK: Rgb = { r: 0, g: 0, b: 0 };

describe("cut, edgeFloodFill", () => {
  it("clears a uniform background and keeps the centre", () => {
    const image = framed(16, WHITE, BLACK, 4);
    const result = cut(image, "edgeFloodFill", MAGENTA, 0.2, 0.1, 0.85, false);

    expect(alphaAt(result, 0, 0)).toBe(0);
    expect(alphaAt(result, 15, 15)).toBe(0);
    expect(alphaAt(result, 8, 8)).toBe(255);
  });

  it("clears everything when the whole image is one colour", () => {
    const result = cut(solid(12, 12, WHITE), "edgeFloodFill", MAGENTA, 0.2, 0.1, 0.85, false);
    expect(countOpaque(result)).toBe(0);
  });

  it("is a no-op on a fully transparent image", () => {
    const image = createImage(12, 12);
    const result = cut(image, "edgeFloodFill", MAGENTA, 0.2, 0.1, 0.85, false);

    expect(countOpaque(result)).toBe(0);
    expect(result.width).toBe(12);
    expect(result.height).toBe(12);
  });

  it("does not reach an interior region enclosed by the subject", () => {
    // White border, black ring, white hole in the middle. The hole is the same
    // colour as the background but is not reachable from the edge.
    const image = framed(20, WHITE, BLACK, 4);
    for (let y = 8; y < 12; y++) {
      for (let x = 8; x < 12; x++) {
        const i = (y * 20 + x) * 4;
        image.data[i] = WHITE.r;
        image.data[i + 1] = WHITE.g;
        image.data[i + 2] = WHITE.b;
      }
    }

    const result = cut(image, "edgeFloodFill", MAGENTA, 0.2, 0.1, 0.85, false);

    expect(alphaAt(result, 0, 0)).toBe(0);
    expect(alphaAt(result, 9, 9)).toBe(255);
  });

  it("does not mutate the input", () => {
    const image = framed(16, WHITE, BLACK, 4);
    const before = Uint8Array.from(image.data);

    cut(image, "edgeFloodFill", MAGENTA, 0.2, 0.1, 0.85, false);

    expect(Uint8Array.from(image.data)).toEqual(before);
  });

  it("respects sampleCornersOnly", () => {
    const image = framed(16, WHITE, BLACK, 4);

    const corners = cut(image, "edgeFloodFill", MAGENTA, 0.2, 0.1, 0.85, true);
    const wholeEdge = cut(image, "edgeFloodFill", MAGENTA, 0.2, 0.1, 0.85, false);

    expect(countOpaque(corners)).toBe(countOpaque(wholeEdge));
  });
});

describe("cut, other modes", () => {
  it("returns the same object for mode none", () => {
    const image = solid(8, 8, WHITE);
    expect(cut(image, "none", MAGENTA, 0.2, 0.1, 0.85, false)).toBe(image);
  });

  it("chromaKey clears pixels near the key colour", () => {
    const image = framed(12, MAGENTA, BLACK, 3);
    const result = cut(image, "chromaKey", MAGENTA, 0.1, 0.1, 0.85, false);

    expect(alphaAt(result, 0, 0)).toBe(0);
    expect(alphaAt(result, 6, 6)).toBe(255);
  });

  it("chromaKey with zero tolerance still clears an exact match", () => {
    const result = cut(solid(4, 4, MAGENTA), "chromaKey", MAGENTA, 0, 0.1, 0.85, false);
    expect(countOpaque(result)).toBe(0);
  });

  it("luminanceAbove clears bright pixels", () => {
    const image = framed(12, WHITE, BLACK, 3);
    const result = cut(image, "luminanceAbove", MAGENTA, 0.2, 0.1, 0.5, false);

    expect(alphaAt(result, 0, 0)).toBe(0);
    expect(alphaAt(result, 6, 6)).toBe(255);
  });

  it("luminanceBelow clears dark pixels", () => {
    const image = framed(12, WHITE, BLACK, 3);
    const result = cut(image, "luminanceBelow", MAGENTA, 0.2, 0.1, 0.5, false);

    expect(alphaAt(result, 0, 0)).toBe(255);
    expect(alphaAt(result, 6, 6)).toBe(0);
  });

  it("skips already transparent pixels", () => {
    const image = solid(4, 4, WHITE, 0);
    const result = cut(image, "luminanceAbove", MAGENTA, 0.2, 0.1, 0.1, false);
    expect(countOpaque(result)).toBe(0);
  });
});

describe("sampleBackgroundColor", () => {
  it("returns the dominant border colour", () => {
    const sampled = sampleBackgroundColor(framed(16, WHITE, BLACK, 4), false);

    expect(sampled.r).toBeGreaterThan(200);
    expect(sampled.g).toBeGreaterThan(200);
    expect(sampled.b).toBeGreaterThan(200);
  });

  it("falls back to white for a fully transparent image", () => {
    expect(sampleBackgroundColor(createImage(8, 8), false)).toEqual(WHITE);
  });
});

describe("transparentBorderFraction", () => {
  it("is 0 for a fully opaque image", () => {
    expect(transparentBorderFraction(solid(10, 10, WHITE), 0.5)).toBe(0);
  });

  it("is 1 for a fully transparent image", () => {
    expect(transparentBorderFraction(createImage(10, 10), 0.5)).toBe(1);
  });

  it("is between 0 and 1 for a partially clear border", () => {
    const image = solid(10, 10, WHITE);
    for (let x = 0; x < 10; x++) image.data[x * 4 + 3] = 0;

    const fraction = transparentBorderFraction(image, 0.5);
    expect(fraction).toBeGreaterThan(0);
    expect(fraction).toBeLessThan(1);
  });
});

describe("snapAlpha", () => {
  it("pushes alpha to the extremes", () => {
    const image = solid(4, 4, WHITE, 200);
    image.data[3] = 10;

    const result = snapAlpha(image, 0.5);

    expect(result.data[3]).toBe(0);
    expect(result.data[7]).toBe(255);
  });

  it("treats exactly the threshold as opaque", () => {
    const image = solid(1, 1, WHITE, 128);
    expect(snapAlpha(image, 0.5).data[3]).toBe(255);
  });
});

describe("erodeAlpha", () => {
  it("returns the input for zero passes", () => {
    const image = solid(8, 8, WHITE);
    expect(erodeAlpha(image, 0, 0.5)).toBe(image);
  });

  it("shrinks an opaque block by one ring per pass", () => {
    const image = createImage(9, 9);
    for (let y = 2; y < 7; y++) {
      for (let x = 2; x < 7; x++) image.data[(y * 9 + x) * 4 + 3] = 255;
    }

    expect(countOpaque(image)).toBe(25);
    expect(countOpaque(erodeAlpha(image, 1, 0.5))).toBe(9);
    expect(countOpaque(erodeAlpha(image, 2, 0.5))).toBe(1);
  });

  it("leaves a fully opaque image untouched", () => {
    // Neighbour lookups clamp at the border, so edge pixels see themselves
    // rather than transparency and never count as exposed.
    expect(countOpaque(erodeAlpha(solid(6, 6, WHITE), 1, 0.5))).toBe(36);
  });

  it("leaves a fully transparent image empty", () => {
    expect(countOpaque(erodeAlpha(createImage(8, 8), 3, 0.5))).toBe(0);
  });
});

describe("despeckle", () => {
  it("returns the input when there is nothing to do", () => {
    const image = solid(8, 8, WHITE);
    expect(despeckle(image, 0, false, 0.5)).toBe(image);
  });

  it("removes an isolated opaque pixel", () => {
    const image = createImage(8, 8);
    image.data[(3 * 8 + 3) * 4 + 3] = 255;

    expect(countOpaque(despeckle(image, 3, false, 0.5))).toBe(0);
  });

  it("keeps a pixel with enough opaque neighbours", () => {
    const image = solid(8, 8, WHITE);
    expect(countOpaque(despeckle(image, 3, false, 0.5))).toBe(64);
  });

  it("fills a single-pixel hole when fillHoles is on", () => {
    const image = solid(8, 8, WHITE);
    image.data[(4 * 8 + 4) * 4 + 3] = 0;

    expect(alphaAt(despeckle(image, 0, true, 0.5), 4, 4)).toBe(255);
  });

  it("does not fill a large hole", () => {
    const image = solid(10, 10, WHITE);
    for (let y = 3; y < 7; y++) {
      for (let x = 3; x < 7; x++) image.data[(y * 10 + x) * 4 + 3] = 0;
    }

    expect(alphaAt(despeckle(image, 0, true, 0.5), 4, 4)).toBe(0);
  });
});

describe("trimToContent", () => {
  it("crops to the opaque bounding box", () => {
    const image = createImage(20, 20);
    for (let y = 5; y < 10; y++) {
      for (let x = 6; x < 12; x++) image.data[(y * 20 + x) * 4 + 3] = 255;
    }

    const result = trimToContent(image, 0.5, 0);
    expect(result.width).toBe(6);
    expect(result.height).toBe(5);
  });

  it("adds padding but stays inside the original bounds", () => {
    const image = createImage(20, 20);
    image.data[(0 * 20 + 0) * 4 + 3] = 255;

    const result = trimToContent(image, 0.5, 3);
    expect(result.width).toBe(4);
    expect(result.height).toBe(4);
  });

  it("returns the input when the image is fully transparent", () => {
    const image = createImage(12, 12);
    expect(trimToContent(image, 0.5, 0)).toBe(image);
  });

  it("returns the input when content already fills the frame", () => {
    const image = solid(12, 12, WHITE);
    expect(trimToContent(image, 0.5, 0)).toBe(image);
  });

  it("handles a single opaque pixel", () => {
    const image = createImage(16, 16);
    image.data[(8 * 16 + 8) * 4 + 3] = 255;

    const result = trimToContent(image, 0.5, 0);
    expect(result.width).toBe(1);
    expect(result.height).toBe(1);
  });
});
