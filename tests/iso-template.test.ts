import { describe, expect, it } from "vitest";
import {
  DIMETRIC_PITCH,
  ISO_DIAMOND_RATIO,
  TRUE_ISO_PITCH,
  clampIsoPitch,
  clampIsoTemplatePitch,
  isoDiamondHeightForPitch,
  isoDiamondRatioForPitch
} from "@/core/iso";
import { ISO_DIAMOND_SIZE, buildIsoDiamondTemplate } from "@/core/isoMask";
import {
  classifyIsoIntersection,
  clampIsoLight,
  defaultIsoTemplateSpec,
  DEFAULT_ISO_LIGHT,
  isoLightVector,
  isoTemplateFileName,
  lambertShade,
  normalizeIsoTemplateSpec,
  renderIsoTemplate
} from "@/core/isoTemplate";
import { luminance } from "@/core/pixels";
import type { RgbaImage } from "@/core/types";
import { alphaAt, countOpaque } from "./helpers";

function lumaAt(image: RgbaImage, x: number, y: number): number {
  const i = (y * image.width + x) * 4;
  return luminance(image.data[i], image.data[i + 1], image.data[i + 2]);
}

function meanOpaqueLuma(
  image: RgbaImage,
  x0: number,
  x1: number,
  y0: number,
  y1: number
): number {
  let total = 0;
  let count = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (alphaAt(image, x, y) < 128) continue;
      total += lumaAt(image, x, y);
      count++;
    }
  }
  return count === 0 ? 0 : total / count;
}

describe("iso pitch", () => {
  it("is 2:1 at 30° and √3 at true iso", () => {
    expect(isoDiamondRatioForPitch(DIMETRIC_PITCH)).toBeCloseTo(ISO_DIAMOND_RATIO.dimetric, 10);
    expect(isoDiamondRatioForPitch(TRUE_ISO_PITCH)).toBeCloseTo(ISO_DIAMOND_RATIO.true, 10);
    expect(isoDiamondHeightForPitch(64, DIMETRIC_PITCH)).toBeCloseTo(32);
    expect(isoDiamondHeightForPitch(64, TRUE_ISO_PITCH)).toBeCloseTo(64 / Math.sqrt(3));
  });

  it("clamps and treats junk as 30°", () => {
    expect(clampIsoPitch(3)).toBe(8);
    expect(clampIsoPitch(120)).toBe(80);
    expect(clampIsoPitch(Number.NaN)).toBe(DIMETRIC_PITCH);
  });

  it("lets a demonstration image look straight on or straight down", () => {
    expect(clampIsoTemplatePitch(0)).toBe(0);
    expect(clampIsoTemplatePitch(90)).toBe(90);
    expect(clampIsoTemplatePitch(-8)).toBe(0);
    expect(clampIsoTemplatePitch(140)).toBe(90);
    expect(isoDiamondRatioForPitch(90)).toBeCloseTo(1);
    expect(isoDiamondHeightForPitch(64, 90)).toBeCloseTo(64);
  });
});

describe("iso template spec", () => {
  it("picks a diamond fill when the shape changes and no fill was given", () => {
    const spec = normalizeIsoTemplateSpec({ shape: "diamond" });
    expect(spec.fill).toEqual({ r: 48, g: 58, b: 74 });
    expect(spec.pitch).toBe(DIMETRIC_PITCH);
    expect(spec.yaw).toBe(45);
  });

  it("keeps 0° and 90° on the template camera", () => {
    expect(normalizeIsoTemplateSpec({ pitch: 0, yaw: 0 })).toMatchObject({ pitch: 0, yaw: 0 });
    expect(normalizeIsoTemplateSpec({ pitch: 90 }).pitch).toBe(90);
  });

  it("names the png from the shape", () => {
    expect(isoTemplateFileName(defaultIsoTemplateSpec())).toBe("iso-prism.png");
    expect(isoTemplateFileName(normalizeIsoTemplateSpec({ shape: "intersection" }))).toBe(
      "iso-intersection.png"
    );
  });
});

describe("iso lighting", () => {
  it("treats junk as northwest", () => {
    expect(clampIsoLight("se")).toBe("se");
    expect(clampIsoLight("up")).toBe(DEFAULT_ISO_LIGHT);
    expect(clampIsoLight(undefined)).toBe("nw");
  });

  it("points −X for northwest sun", () => {
    const [x, y, z] = isoLightVector("nw");
    expect(x).toBeLessThan(0);
    expect(y).toBeCloseTo(0, 5);
    expect(z).toBeGreaterThan(0);
  });

  it("lights the south-west wall under SW sun and the south-east wall under SE", () => {
    expect(lambertShade(0, 1, 0, "sw")).toBeGreaterThan(lambertShade(1, 0, 0, "sw"));
    expect(lambertShade(1, 0, 0, "se")).toBeGreaterThan(lambertShade(0, 1, 0, "se"));
    expect(lambertShade(0, 0, 1, "nw")).toBeGreaterThan(lambertShade(1, 0, 0, "nw"));
  });
});

describe("iso template diamond", () => {
  it("matches the builtin diamond footprint at true iso 256", () => {
    const builtin = buildIsoDiamondTemplate();
    const image = renderIsoTemplate({
      shape: "diamond",
      width: ISO_DIAMOND_SIZE.width,
      pitch: TRUE_ISO_PITCH
    });

    expect(image.width).toBe(builtin.width);
    expect(image.height).toBe(builtin.height);
    expect(image.width / image.height).toBeCloseTo(ISO_DIAMOND_RATIO.true, 2);

    const at = (x: number, y: number) => alphaAt(image, x, y);
    expect(at(image.width / 2, image.height / 2)).toBe(255);
    expect(at(0, 0)).toBe(0);
    expect(at(image.width - 1, 0)).toBe(0);
    expect(at(0, image.height - 1)).toBe(0);
    expect(at(image.width - 1, image.height - 1)).toBe(0);
  });

  it("is 2:1 at 30°", () => {
    const image = renderIsoTemplate({ shape: "diamond", width: 128, pitch: DIMETRIC_PITCH });
    expect(image.width / image.height).toBe(2);
  });
});

describe("iso intersection", () => {
  it("is road at the crossing and lot at the southern block", () => {
    expect(classifyIsoIntersection(0, 0, 2, 1, 1, 0.5, 1.4, 0.7)).toBe("road");
    expect(classifyIsoIntersection(0, 0.5, 2, 1, 1, 0.5, 1.4, 0.7)).toBe("lot");
    expect(classifyIsoIntersection(3, 3, 2, 1, 1, 0.5, 1.4, 0.7)).toBe("outside");
  });

  it("paints a diamond with a dark crossing", () => {
    const image = renderIsoTemplate({ shape: "intersection", width: 96, pitch: DIMETRIC_PITCH });
    expect(image.width / image.height).toBe(2);
    expect(alphaAt(image, 0, 0)).toBe(0);
    expect(alphaAt(image, image.width / 2, image.height / 2)).toBe(255);
    expect(lumaAt(image, image.width / 2, image.height / 2)).toBeLessThan(
      lumaAt(image, image.width / 2, image.height - 2)
    );
  });
});

describe("iso volume templates", () => {
  it("draws a prism inside a transparent frame", () => {
    const image = renderIsoTemplate({ shape: "prism", width: 96, pitch: DIMETRIC_PITCH });
    expect(alphaAt(image, 2, 2)).toBe(0);
    expect(alphaAt(image, image.width / 2, image.height / 2)).toBe(255);
    expect(countOpaque(image)).toBeGreaterThan(400);
    expect(image.height).toBeGreaterThan(image.width / 2);
  });

  it("shades the left wall brighter when the sun is south-west", () => {
    const sw = renderIsoTemplate({
      shape: "prism",
      width: 120,
      pitch: DIMETRIC_PITCH,
      light: "sw",
      extentZ: 1.2
    });
    const se = renderIsoTemplate({
      shape: "prism",
      width: 120,
      pitch: DIMETRIC_PITCH,
      light: "se",
      extentZ: 1.2
    });

    const mid = Math.floor(sw.height * 0.62);
    const band = 8;
    const leftSW = meanOpaqueLuma(sw, 8, Math.floor(sw.width * 0.38), mid - band, mid + band);
    const rightSW = meanOpaqueLuma(
      sw,
      Math.floor(sw.width * 0.62),
      sw.width - 8,
      mid - band,
      mid + band
    );
    const leftSE = meanOpaqueLuma(se, 8, Math.floor(se.width * 0.38), mid - band, mid + band);
    const rightSE = meanOpaqueLuma(
      se,
      Math.floor(se.width * 0.62),
      se.width - 8,
      mid - band,
      mid + band
    );

    expect(leftSW).toBeGreaterThan(rightSW);
    expect(rightSE).toBeGreaterThan(leftSE);
  });

  it("draws a sphere and a building pad around the prism", () => {
    const sphere = renderIsoTemplate({ shape: "sphere", width: 80, pitch: DIMETRIC_PITCH });
    const building = renderIsoTemplate({ shape: "building", width: 80, pitch: DIMETRIC_PITCH });

    expect(alphaAt(sphere, Math.floor(sphere.width / 2), Math.floor(sphere.height / 2))).toBe(255);
    expect(alphaAt(sphere, 1, 1)).toBe(0);
    expect(countOpaque(sphere)).toBeGreaterThan(200);
    expect(countOpaque(building)).toBeGreaterThan(200);
    expect(lumaAt(building, Math.floor(building.width / 2), building.height - 6)).toBeGreaterThan(0.4);
  });

  it("unsquashes the plate when the camera is higher", () => {
    const low = renderIsoTemplate({ shape: "prism", width: 80, pitch: 20 });
    const high = renderIsoTemplate({ shape: "prism", width: 80, pitch: 65 });
    expect(high.height / high.width).toBeGreaterThan(low.height / low.width);
  });

  it("renders a front face at 0° and a top at 90°", () => {
    const front = renderIsoTemplate({
      shape: "prism",
      width: 96,
      pitch: 0,
      yaw: 0,
      extentX: 1,
      extentY: 1,
      extentZ: 1
    });
    const top = renderIsoTemplate({
      shape: "prism",
      width: 96,
      pitch: 90,
      yaw: 0,
      extentX: 1,
      extentY: 1,
      extentZ: 1
    });
    const isoSide = renderIsoTemplate({
      shape: "prism",
      width: 96,
      pitch: 0,
      yaw: 45,
      extentX: 1,
      extentY: 1,
      extentZ: 1
    });

    expect(countOpaque(front)).toBeGreaterThan(400);
    expect(countOpaque(top)).toBeGreaterThan(400);
    expect(countOpaque(isoSide)).toBeGreaterThan(400);
    expect(alphaAt(front, 2, 2)).toBe(0);
    expect(alphaAt(top, 2, 2)).toBe(0);

    const cx = Math.floor(front.width / 2);
    const cy = Math.floor(front.height / 2);
    expect(alphaAt(front, cx, cy)).toBe(255);
    expect(alphaAt(top, Math.floor(top.width / 2), Math.floor(top.height / 2))).toBe(255);
    expect(lumaAt(top, Math.floor(top.width / 2), Math.floor(top.height / 2))).toBeGreaterThan(
      lumaAt(front, cx, cy)
    );
  });
});
