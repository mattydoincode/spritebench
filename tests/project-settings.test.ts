import { describe, expect, it } from "vitest";
import { DIMETRIC_PITCH, MAX_ISO_PITCH, MIN_ISO_PITCH } from "@/core/iso";
import { DEFAULT_ISO_LIGHT } from "@/core/isoTemplate";
import { DEFAULT_PROCESSING, withDefaults } from "@/core/settings";
import {
  DEFAULT_PROJECT_CUTOUT,
  DEFAULT_PROJECT_SETTINGS,
  applyProjectCutout,
  cutoutProcessingPatch,
  processingForNewAsset,
  withProjectCutout,
  withProjectSettings
} from "@/shared/projectSettings";
import { isoPitchForRepeater } from "@/shared/model";

describe("withProjectCutout", () => {
  it("returns the defaults for null and undefined", () => {
    expect(withProjectCutout()).toEqual(DEFAULT_PROJECT_CUTOUT);
    expect(withProjectCutout(null)).toEqual(DEFAULT_PROJECT_CUTOUT);
    expect(withProjectCutout({})).toEqual(DEFAULT_PROJECT_CUTOUT);
  });

  it("does not mutate the shared defaults", () => {
    const snapshot = JSON.stringify(DEFAULT_PROJECT_CUTOUT);

    const result = withProjectCutout({ chromaKey: { chromaKeys: ["#00ff00"] } });
    result.chromaKey.chromaKeys.push("#0000ff");
    result.edgeFloodFill.cutoutTolerance = 0.99;

    expect(JSON.stringify(DEFAULT_PROJECT_CUTOUT)).toBe(snapshot);
    expect(DEFAULT_PROJECT_SETTINGS.cutout.chromaKey.chromaKeys).toEqual(["#ff00ff"]);
  });

  it("keeps an empty chroma key list", () => {
    expect(withProjectCutout({ chromaKey: { chromaKeys: [] } }).chromaKey.chromaKeys).toEqual([]);
  });

  it("clamps unit intervals and drops unknown modes", () => {
    const result = withProjectCutout({
      mode: "laser" as never,
      alphaThreshold: 1.4,
      edgeFloodFill: { cutoutTolerance: -0.2, cutoutLocalTolerance: 2 }
    });

    expect(result.mode).toBe(DEFAULT_PROJECT_CUTOUT.mode);
    expect(result.alphaThreshold).toBe(1);
    expect(result.edgeFloodFill.cutoutTolerance).toBe(0);
    expect(result.edgeFloodFill.cutoutLocalTolerance).toBe(1);
  });

  it("stores flood-fill and chroma tolerances separately", () => {
    const result = withProjectCutout({
      edgeFloodFill: { cutoutTolerance: 0.11 },
      chromaKey: { cutoutTolerance: 0.44 }
    });

    expect(result.edgeFloodFill.cutoutTolerance).toBe(0.11);
    expect(result.chromaKey.cutoutTolerance).toBe(0.44);
  });
});

describe("cutoutProcessingPatch", () => {
  it("applies only flood-fill knobs when that is the default method", () => {
    const patch = cutoutProcessingPatch(
      withProjectCutout({
        mode: "edgeFloodFill",
        edgeFloodFill: { cutoutTolerance: 0.2, sampleCornersOnly: true },
        chromaKey: { chromaKeys: ["#00ff00"], cutoutTolerance: 0.5 }
      })
    );

    expect(patch.cutout).toBe("edgeFloodFill");
    expect(patch.cutoutTolerance).toBe(0.2);
    expect(patch.sampleCornersOnly).toBe(true);
    expect(patch.chromaKeys).toBeUndefined();
  });

  it("applies chroma keys and chroma tolerance for chroma key", () => {
    const patch = cutoutProcessingPatch(
      withProjectCutout({
        mode: "chromaKey",
        chromaKey: { chromaKeys: ["#112233", "#445566"], cutoutTolerance: 0.3 },
        edgeFloodFill: { cutoutTolerance: 0.05 }
      })
    );

    expect(patch).toMatchObject({
      cutout: "chromaKey",
      chromaKeys: ["#112233", "#445566"],
      cutoutTolerance: 0.3
    });
  });

  it("leaves method-specific fields off when the method is none", () => {
    const patch = cutoutProcessingPatch(withProjectCutout({ mode: "none" }));

    expect(patch.cutout).toBe("none");
    expect(patch.cutoutTolerance).toBeUndefined();
    expect(patch.chromaKeys).toBeUndefined();
    expect(patch.cutoutLuminanceThreshold).toBeUndefined();
  });
});

describe("project iso pitch", () => {
  it("defaults to 30°", () => {
    expect(withProjectSettings().isoPitch).toBe(DIMETRIC_PITCH);
    expect(DEFAULT_PROJECT_SETTINGS.isoPitch).toBe(DIMETRIC_PITCH);
  });

  it("clamps junk and out-of-range values", () => {
    expect(withProjectSettings({ isoPitch: 45 }).isoPitch).toBe(45);
    expect(withProjectSettings({ isoPitch: 3 }).isoPitch).toBe(MIN_ISO_PITCH);
    expect(withProjectSettings({ isoPitch: 120 }).isoPitch).toBe(MAX_ISO_PITCH);
    expect(withProjectSettings({ isoPitch: Number.NaN }).isoPitch).toBe(DIMETRIC_PITCH);
  });
});

describe("project iso light", () => {
  it("defaults to northwest", () => {
    expect(withProjectSettings().isoLight).toBe(DEFAULT_ISO_LIGHT);
    expect(DEFAULT_PROJECT_SETTINGS.isoLight).toBe("nw");
  });

  it("keeps a compass direction and drops junk", () => {
    expect(withProjectSettings({ isoLight: "se" }).isoLight).toBe("se");
    expect(withProjectSettings({ isoLight: "up" as never }).isoLight).toBe(DEFAULT_ISO_LIGHT);
  });
});

describe("isoPitchForRepeater", () => {
  it("uses a stored pitch when present", () => {
    expect(isoPitchForRepeater({ placement: "iso", isoPitch: 45 })).toBe(45);
  });

  it("falls back to the placement when pitch was never stored", () => {
    expect(isoPitchForRepeater({ placement: "iso21" })).toBe(DIMETRIC_PITCH);
    expect(isoPitchForRepeater({ placement: "iso" })).toBeCloseTo(
      Math.atan(1 / Math.SQRT2) * (180 / Math.PI)
    );
  });
});

describe("processingForNewAsset", () => {
  it("lets the project cutout win over the user and the request", () => {
    const user = withDefaults({
      cutout: "none",
      downsample: true,
      targetSize: { width: 48, height: 48 },
      paletteId: "oak"
    });
    const project = withProjectSettings({
      cutout: {
        mode: "chromaKey",
        chromaKey: { chromaKeys: ["#00ff00"], cutoutTolerance: 0.25 },
        clipToIso: true
      }
    });

    const next = processingForNewAsset(user, project, {
      cutout: "luminanceAbove",
      cutoutTolerance: 0.9,
      downsample: false
    });

    expect(next.cutout).toBe("chromaKey");
    expect(next.chromaKeys).toEqual(["#00ff00"]);
    expect(next.cutoutTolerance).toBe(0.25);
    expect(next.clipToIso).toBe(true);
    expect(next.downsample).toBe(false);
    expect(next.paletteId).toBe("oak");
    expect(next.targetSize).toEqual({ width: 48, height: 48 });
  });

  it("does not rewrite an existing processing object in place", () => {
    const processing = { ...DEFAULT_PROCESSING };
    const snapshot = JSON.stringify(processing);
    const project = withProjectSettings({ cutout: { mode: "none", snapAlpha: false } });

    applyProjectCutout(processing, project);

    expect(JSON.stringify(processing)).toBe(snapshot);
  });
});
