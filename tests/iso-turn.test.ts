import { describe, expect, it } from "vitest";
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
  it("is a no-op at 0 and yaws in 90° steps", () => {
    expect(isoTurnCss(0)).toBe("");
    expect(isoTurnCss(1)).toBe("scaleY(0.5) rotate(90deg) scaleY(2)");
    expect(isoTurnCss(2)).toBe("scaleY(0.5) rotate(180deg) scaleY(2)");
  });
});

describe("spriteFacingCss", () => {
  it("keeps flips-only when there is no yaw", () => {
    expect(spriteFacingCss(true, false, 0)).toBe("scale(-1, 1)");
  });

  it("applies yaw after flips so the art is mirrored in its drawn facing first", () => {
    expect(spriteFacingCss(true, false, 1)).toBe(
      "scaleY(0.5) rotate(90deg) scaleY(2) scale(-1, 1)"
    );
  });
});
