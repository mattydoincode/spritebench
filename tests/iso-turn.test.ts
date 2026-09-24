import { describe, expect, it } from "vitest";
import { ISO_DIAMOND_RATIO, isoSquash } from "@/core/iso";
import { clampIsoTurn, isoTurnCss, spriteFacingCss } from "@/core/isoTurn";

describe("clampIsoTurn", () => {
  it("wraps into 0–3", () => {
    expect(clampIsoTurn(0)).toBe(0);
    expect(clampIsoTurn(1)).toBe(1);
    expect(clampIsoTurn(4)).toBe(0);
    expect(clampIsoTurn(-1)).toBe(3);
    expect(clampIsoTurn(2.6)).toBe(3);
  });

  it("treats non-finite as as-drawn", () => {
    expect(clampIsoTurn(Number.NaN)).toBe(0);
  });
});

describe("isoTurnCss", () => {
  it("is a no-op at 0 and yaws in 90° steps on the true-iso diamond", () => {
    const squash = isoSquash("true");
    const unsquash = ISO_DIAMOND_RATIO.true;
    expect(isoTurnCss(0)).toBe("");
    expect(isoTurnCss(1)).toBe(`scaleY(${squash}) rotate(90deg) scaleY(${unsquash})`);
    expect(isoTurnCss(2)).toBe(`scaleY(${squash}) rotate(180deg) scaleY(${unsquash})`);
  });

  it("uses 2:1 squash for dimetric yaw", () => {
    expect(isoTurnCss(1, "dimetric")).toBe("scaleY(0.5) rotate(90deg) scaleY(2)");
  });
});

describe("spriteFacingCss", () => {
  it("keeps flips-only when there is no yaw", () => {
    expect(spriteFacingCss(true, false, 0)).toBe("scale(-1, 1)");
  });

  it("applies yaw after flips so the art is mirrored in its drawn facing first", () => {
    const squash = isoSquash("true");
    const unsquash = ISO_DIAMOND_RATIO.true;
    expect(spriteFacingCss(true, false, 1)).toBe(
      `scaleY(${squash}) rotate(90deg) scaleY(${unsquash}) scale(-1, 1)`
    );
  });
});
