import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROCESSING,
  effectiveTargetSize,
  hashPalette,
  hashSettings,
  scaleProcessing,
  trimsToContent,
  withDefaults
} from "@/core/settings";

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
    result.chromaKeys.push("#00ff00");

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
      width: 32,
      height: 32
    });

    expect(withDefaults({ targetSize: {} as never }).targetSize).toEqual({
      width: 0,
      height: 0
    });
  });

  it("does not trim when the iso clip owns the frame", () => {
    expect(trimsToContent({ trimToContent: true, clipToIso: false })).toBe(true);
    expect(trimsToContent({ trimToContent: true, clipToIso: true })).toBe(false);
    expect(trimsToContent({ trimToContent: false, clipToIso: true })).toBe(false);
  });

  it("treats parked targetSize as unused while downsample is off", () => {
    expect(effectiveTargetSize({ downsample: false, targetSize: { width: 32, height: 32 } })).toEqual({
      width: 0,
      height: 0
    });
    expect(effectiveTargetSize({ downsample: true, targetSize: { width: 32, height: 48 } })).toEqual({
      width: 32,
      height: 48
    });
  });

  it("infers downsample from an older targetSize when the flag is missing", () => {
    expect(withDefaults({ targetSize: { width: 0, height: 64 } }).downsample).toBe(true);
    expect(withDefaults({ targetSize: { width: 0, height: 0 } }).downsample).toBe(false);
    expect(withDefaults({}).downsample).toBe(false);
  });

  it("normalizes a missing edits array to empty", () => {
    expect(withDefaults({ edits: undefined }).edits).toEqual([]);
    expect(withDefaults({ edits: null as never }).edits).toEqual([]);
  });

  it("clones and caps chromaKeys", () => {
    expect(withDefaults({ chromaKeys: undefined }).chromaKeys).toEqual(["#ff00ff"]);
    expect(withDefaults({ chromaKeys: [] }).chromaKeys).toEqual([]);
    expect(withDefaults({ chromaKeys: ["#fff", 12, "#00ff00"] as never }).chromaKeys).toEqual([
      "#fff",
      "#00ff00"
    ]);

    const tooMany = Array.from({ length: 20 }, (_, i) => `#${i.toString(16).padStart(6, "0")}`);
    expect(withDefaults({ chromaKeys: tooMany }).chromaKeys).toHaveLength(16);
  });

  // Partial shapes reach withDefaults() from the Yjs document, where a
  // collaborator on an older build writes only the fields it knows about.
  // This is the only place those get completed.
  const partialShapes: Array<[string, Record<string, unknown>]> = [
    ["a cutout and one dimension", { cutout: "edgeFloodFill", targetSize: { width: 0, height: 64 } }],
    ["flags with no edits array", { cutout: "none", trimToContent: true, snapAlpha: true }],
    ["orientation only", { flipHorizontal: true, paletteId: "7f3c" }],
    ["despeckle only", { erodePixels: 2, alphaThreshold: 0.5 }],
    ["unknown future keys", { somethingNew: 42, cutout: "chromaKey" }],
    ["fully populated", { ...DEFAULT_PROCESSING }]
  ];

  for (const [label, shape] of partialShapes) {
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
    for (const [, shape] of partialShapes) {
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
    expect(hashSettings({ ...base, paletteId: "7f3c" })).not.toBe(baseHash);
    expect(hashSettings({ ...base, downsample: true })).not.toBe(baseHash);
    expect(hashSettings({ ...base, targetSize: { width: 0, height: 32 } })).not.toBe(baseHash);
    expect(hashSettings({ ...base, dither: "atkinson" })).not.toBe(baseHash);
    expect(hashSettings({ ...base, clipToIso: true })).not.toBe(baseHash);
    expect(hashSettings({ ...base, chromaKeys: ["#00ff00"] })).not.toBe(baseHash);
    expect(hashSettings({ ...base, chromaKeys: ["#ff00ff", "#00ff00"] })).not.toBe(baseHash);
  });

  it("distinguishes nested size objects", () => {
    const base = withDefaults({});

    expect(hashSettings({ ...base, targetSize: { width: 32, height: 0 } })).not.toBe(
      hashSettings({ ...base, targetSize: { width: 0, height: 32 } })
    );
  });
});

describe("hashPalette", () => {
  it("is stable for the same colors", () => {
    const colors = [
      { r: 10, g: 20, b: 30 },
      { r: 40, g: 50, b: 60 }
    ];
    expect(hashPalette(colors)).toBe(hashPalette(colors));
  });

  it("changes when a color changes at the same length", () => {
    const a = [
      { r: 10, g: 20, b: 30 },
      { r: 40, g: 50, b: 60 }
    ];
    const b = [
      { r: 10, g: 20, b: 30 },
      { r: 40, g: 50, b: 61 }
    ];
    expect(hashPalette(a)).not.toBe(hashPalette(b));
  });

  it("hashes an empty palette stably", () => {
    expect(hashPalette([])).toBe(hashPalette([]));
  });
});

describe("scaleProcessing", () => {
  it("maps source-space crops and pixel erode onto a thumbnail", () => {
    const settings = withDefaults({
      edits: [{ kind: "crop", x: 1000, y: 500, width: 200, height: 200 }],
      erodePixels: 8,
      trimPadding: 8
    });

    const next = scaleProcessing(settings, { width: 2048, height: 1024 }, { width: 256, height: 128 });

    expect(next.edits[0]).toEqual({ kind: "crop", x: 125, y: 63, width: 25, height: 25 });
    expect(next.erodePixels).toBeCloseTo(1);
    expect(next.trimPadding).toBe(1);
  });

  it("leaves pixel-grid edits alone so the sampler can remap them", () => {
    const grid = {
      kind: "pixelGrid" as const,
      columns: 32,
      rows: 32,
      canvasWidth: 1024,
      canvasHeight: 1024,
      originX: 0,
      originY: 0,
      cell: 32
    };
    const settings = withDefaults({ edits: [grid] });

    expect(scaleProcessing(settings, { width: 1024, height: 1024 }, { width: 256, height: 256 }).edits[0]).toEqual(
      grid
    );
  });

  it("is the identity when the sizes match", () => {
    const settings = withDefaults({ erodePixels: 2 });
    const size = { width: 64, height: 64 };

    expect(scaleProcessing(settings, size, size)).toBe(settings);
  });
});
