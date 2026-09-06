import { describe, expect, it } from "vitest";
import { oklabFromSrgb } from "@/core/oklab";

describe("oklabFromSrgb", () => {
  it("maps black to L=0", () => {
    const [l, a, b] = oklabFromSrgb(0, 0, 0);

    expect(l).toBeCloseTo(0, 6);
    expect(a).toBeCloseTo(0, 6);
    expect(b).toBeCloseTo(0, 6);
  });

  it("maps white to L=1 with no chroma", () => {
    const [l, a, b] = oklabFromSrgb(255, 255, 255);

    expect(l).toBeCloseTo(1, 3);
    expect(a).toBeCloseTo(0, 3);
    expect(b).toBeCloseTo(0, 3);
  });

  it("keeps greys on the neutral axis", () => {
    for (const level of [16, 64, 128, 192, 240]) {
      const [, a, b] = oklabFromSrgb(level, level, level);

      expect(a).toBeCloseTo(0, 3);
      expect(b).toBeCloseTo(0, 3);
    }
  });

  it("increases lightness monotonically with grey level", () => {
    const levels = [0, 32, 64, 96, 128, 160, 192, 224, 255];
    const lightness = levels.map((level) => oklabFromSrgb(level, level, level)[0]);

    for (let i = 1; i < lightness.length; i++) {
      expect(lightness[i]).toBeGreaterThan(lightness[i - 1]);
    }
  });

  it("matches the reference values for the sRGB primaries", () => {
    // From Björn Ottosson's original Oklab article.
    const [lr, ar, br] = oklabFromSrgb(255, 0, 0);
    expect(lr).toBeCloseTo(0.6279, 3);
    expect(ar).toBeCloseTo(0.2249, 3);
    expect(br).toBeCloseTo(0.1258, 3);

    const [lg, ag, bg] = oklabFromSrgb(0, 255, 0);
    expect(lg).toBeCloseTo(0.8664, 3);
    expect(ag).toBeCloseTo(-0.2339, 3);
    expect(bg).toBeCloseTo(0.1795, 3);

    const [lb, ab, bb] = oklabFromSrgb(0, 0, 255);
    expect(lb).toBeCloseTo(0.452, 3);
    expect(ab).toBeCloseTo(-0.0324, 3);
    expect(bb).toBeCloseTo(-0.3115, 3);
  });

  it("puts red and green far apart, and near-identical colours close together", () => {
    const distance = (x: [number, number, number], y: [number, number, number]) =>
      Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);

    const red = oklabFromSrgb(255, 0, 0);
    const green = oklabFromSrgb(0, 255, 0);
    const nearRed = oklabFromSrgb(250, 5, 5);

    expect(distance(red, green)).toBeGreaterThan(0.4);
    expect(distance(red, nearRed)).toBeLessThan(0.05);
  });

  it("is finite across the whole cube", () => {
    for (let r = 0; r <= 255; r += 51) {
      for (let g = 0; g <= 255; g += 51) {
        for (let b = 0; b <= 255; b += 51) {
          for (const value of oklabFromSrgb(r, g, b)) {
            expect(Number.isFinite(value)).toBe(true);
          }
        }
      }
    }
  });
});
