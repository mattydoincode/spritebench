import { describe, expect, it } from "vitest";
import {
  EDGE_MULTIPLE,
  LEGACY_SIZES,
  MAX_ASPECT,
  MAX_EDGE,
  MAX_TOTAL_PIXELS,
  MIN_TOTAL_PIXELS,
  fitToAspect,
  isValidFlexibleSize,
  snapFlexibleSize,
  snapLegacySize
} from "@/core/size";
import { MODEL_REGISTRY, snapRequestSize } from "@/providers/models";

describe("snapFlexibleSize", () => {
  const inputs = [
    { width: 1024, height: 1024 },
    { width: 1, height: 1 },
    { width: 10000, height: 10000 },
    { width: 100, height: 4000 },
    { width: 4000, height: 100 },
    { width: 1920, height: 1080 },
    { width: 1080, height: 1920 },
    { width: 777, height: 333 },
    { width: 3840, height: 3840 },
    { width: 0, height: 0 },
    { width: -50, height: 900 },
    { width: 512, height: 512 },
    { width: 1023, height: 1025 }
  ];

  for (const input of inputs) {
    it(`produces a valid size for ${input.width}x${input.height}`, () => {
      const snapped = snapFlexibleSize(input);

      expect(isValidFlexibleSize(snapped)).toBe(true);
      expect(snapped.width % EDGE_MULTIPLE).toBe(0);
      expect(snapped.height % EDGE_MULTIPLE).toBe(0);
      expect(snapped.width).toBeLessThanOrEqual(MAX_EDGE);
      expect(snapped.height).toBeLessThanOrEqual(MAX_EDGE);
      expect(snapped.width * snapped.height).toBeGreaterThanOrEqual(MIN_TOTAL_PIXELS);
      expect(snapped.width * snapped.height).toBeLessThanOrEqual(MAX_TOTAL_PIXELS);

      const longest = Math.max(snapped.width, snapped.height);
      const shortest = Math.min(snapped.width, snapped.height);
      expect(longest).toBeLessThanOrEqual(shortest * MAX_ASPECT);
    });
  }

  it("is idempotent", () => {
    for (const input of inputs) {
      const once = snapFlexibleSize(input);
      expect(snapFlexibleSize(once)).toEqual(once);
    }
  });

  it("preserves landscape and portrait intent", () => {
    expect(snapFlexibleSize({ width: 1920, height: 1080 }).width).toBeGreaterThan(
      snapFlexibleSize({ width: 1920, height: 1080 }).height
    );
    expect(snapFlexibleSize({ width: 1080, height: 1920 }).height).toBeGreaterThan(
      snapFlexibleSize({ width: 1080, height: 1920 }).width
    );
  });

  it("leaves an already valid square alone", () => {
    expect(snapFlexibleSize({ width: 1024, height: 1024 })).toEqual({
      width: 1024,
      height: 1024
    });
  });
});

describe("isValidFlexibleSize", () => {
  it("rejects non-positive dimensions", () => {
    expect(isValidFlexibleSize({ width: 0, height: 1024 })).toBe(false);
    expect(isValidFlexibleSize({ width: 1024, height: -16 })).toBe(false);
  });

  it("rejects sizes off the edge multiple", () => {
    expect(isValidFlexibleSize({ width: 1020, height: 1024 })).toBe(false);
  });

  it("rejects sizes below the minimum pixel budget", () => {
    expect(isValidFlexibleSize({ width: 512, height: 512 })).toBe(false);
  });

  it("rejects sizes above the maximum pixel budget", () => {
    expect(isValidFlexibleSize({ width: 3840, height: 3840 })).toBe(false);
  });

  it("rejects sizes beyond the aspect limit", () => {
    expect(isValidFlexibleSize({ width: 3840, height: 176 })).toBe(false);
  });

  it("accepts a known good size", () => {
    expect(isValidFlexibleSize({ width: 1024, height: 1024 })).toBe(true);
  });
});

describe("snapLegacySize", () => {
  it("only ever returns one of the three legacy sizes", () => {
    const candidates = [
      { width: 1, height: 1 },
      { width: 4000, height: 10 },
      { width: 10, height: 4000 },
      { width: 1024, height: 1024 },
      { width: 1600, height: 900 }
    ];

    for (const candidate of candidates) {
      expect(LEGACY_SIZES).toContainEqual(snapLegacySize(candidate));
    }
  });

  it("picks the closest aspect ratio", () => {
    expect(snapLegacySize({ width: 1000, height: 1000 })).toEqual({ width: 1024, height: 1024 });
    expect(snapLegacySize({ width: 1600, height: 900 })).toEqual({ width: 1536, height: 1024 });
    expect(snapLegacySize({ width: 900, height: 1600 })).toEqual({ width: 1024, height: 1536 });
  });
});

describe("snapRequestSize", () => {
  const requested = { width: 1920, height: 1088 };

  it("routes each model through the snapper its sizing mode calls for", () => {
    for (const model of MODEL_REGISTRY) {
      const expected =
        model.sizing === "flexible" ? snapFlexibleSize(requested) : snapLegacySize(requested);

      expect(snapRequestSize(requested, model.id)).toEqual(expected);
    }
  });

  it("falls back to the default model for an unknown id", () => {
    expect(snapRequestSize(requested, "not-a-real-model")).toEqual(
      snapRequestSize(requested, "gpt-image-2")
    );
  });
});

describe("fitToAspect", () => {
  it("keeps the template aspect ratio within the budget's pixel count", () => {
    const budget = { width: 1024, height: 1024 };
    const fitted = fitToAspect({ width: 200, height: 100 }, budget);

    expect(fitted.width / fitted.height).toBeCloseTo(2, 1);
    expect(fitted.width * fitted.height).toBeCloseTo(budget.width * budget.height, -4);
  });

  it("never returns a zero dimension", () => {
    expect(fitToAspect({ width: 0, height: 0 }, { width: 1024, height: 1024 }).width).toBeGreaterThan(0);
    expect(fitToAspect({ width: 1, height: 10000 }, { width: 16, height: 16 }).width).toBeGreaterThan(0);
  });
});
