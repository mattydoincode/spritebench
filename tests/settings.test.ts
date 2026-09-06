import { describe, expect, it } from "vitest";
import { DEFAULT_PROCESSING, hashSettings, withDefaults } from "@/core/settings";

describe("withDefaults", () => {
  it("returns the defaults for null and undefined", () => {
    expect(withDefaults()).toEqual(DEFAULT_PROCESSING);
    expect(withDefaults(null)).toEqual(DEFAULT_PROCESSING);
    expect(withDefaults({})).toEqual(DEFAULT_PROCESSING);
  });

  it("does not mutate the shared defaults object", () => {
    const snapshot = JSON.stringify(DEFAULT_PROCESSING);

    const result = withDefaults({ erodePixels: 5 });
    result.edits.push({ kind: "crop", x: 0, y: 0, width: 8, height: 8 });

    expect(JSON.stringify(DEFAULT_PROCESSING)).toBe(snapshot);
    expect(DEFAULT_PROCESSING.erodePixels).toBe(0);
  });

  it("keeps explicit falsy values instead of replacing them with defaults", () => {
    const result = withDefaults({ trimToContent: false, snapAlpha: false, ditherStrength: 0 });

    expect(result.trimToContent).toBe(false);
    expect(result.snapAlpha).toBe(false);
    expect(result.ditherStrength).toBe(0);
  });

  it("floors and clamps targetSize", () => {
    expect(withDefaults({ targetSize: { width: 33.9, height: 64.2 } }).targetSize).toEqual({
      width: 33,
      height: 64
    });

    expect(withDefaults({ targetSize: { width: -10, height: -1 } }).targetSize).toEqual({
      width: 0,
      height: 0
    });
  });

  it("survives a missing targetSize", () => {
    expect(withDefaults({ targetSize: undefined }).targetSize).toEqual({
      width: 0,
      height: 0
    });

    expect(withDefaults({ targetSize: {} as never }).targetSize).toEqual({
      width: 0,
      height: 0
    });
  });

  it("normalizes a missing edits array to empty", () => {
    expect(withDefaults({ edits: undefined }).edits).toEqual([]);
    expect(withDefaults({ edits: null as never }).edits).toEqual([]);
  });

  // Historical shapes that have been persisted to disk over the life of the tool.
  // withDefaults() is the only migration path these records get.
  const historicalShapes: Array<[string, Record<string, unknown>]> = [
    ["earliest known shape", { cutout: "edgeFloodFill", targetSize: { width: 0, height: 64 } }],
    ["before edits existed", { cutout: "none", trimToContent: true, snapAlpha: true }],
    ["before orientation existed", { flipHorizontal: true, paletteFile: "apollo-1x.png" }],
    ["before despeckle existed", { erodePixels: 2, alphaThreshold: 0.5 }],
    ["with unknown future keys", { somethingNew: 42, cutout: "chromaKey" }],
    ["fully populated", { ...DEFAULT_PROCESSING }]
  ];

  for (const [label, shape] of historicalShapes) {
    it(`fills in a complete settings object for the ${label}`, () => {
      const result = withDefaults(shape as never);

      for (const key of Object.keys(DEFAULT_PROCESSING)) {
        expect(result[key as keyof typeof result]).toBeDefined();
      }

      expect(Array.isArray(result.edits)).toBe(true);
      expect(result.targetSize.width).toBeGreaterThanOrEqual(0);
      expect(result.targetSize.height).toBeGreaterThanOrEqual(0);
    });
  }

  it("is idempotent", () => {
    for (const [, shape] of historicalShapes) {
      const once = withDefaults(shape as never);
      expect(withDefaults(once)).toEqual(once);
    }
  });
});

describe("hashSettings", () => {
  it("is stable for equal settings", () => {
    expect(hashSettings(withDefaults({}))).toBe(hashSettings(withDefaults({})));
  });

  it("ignores key insertion order", () => {
    const a = withDefaults({ erodePixels: 3, trimPadding: 2 });
    const b = withDefaults({ trimPadding: 2, erodePixels: 3 });

    expect(hashSettings(a)).toBe(hashSettings(b));
  });

  it("changes when any meaningful field changes", () => {
    const base = withDefaults({});
    const baseHash = hashSettings(base);

    expect(hashSettings({ ...base, erodePixels: 1 })).not.toBe(baseHash);
    expect(hashSettings({ ...base, paletteFile: "apollo-1x.png" })).not.toBe(baseHash);
    expect(hashSettings({ ...base, targetSize: { width: 0, height: 32 } })).not.toBe(baseHash);
    expect(hashSettings({ ...base, dither: "atkinson" })).not.toBe(baseHash);
  });

  it("distinguishes nested size objects", () => {
    const base = withDefaults({});

    expect(hashSettings({ ...base, targetSize: { width: 32, height: 0 } })).not.toBe(
      hashSettings({ ...base, targetSize: { width: 0, height: 32 } })
    );
  });
});
