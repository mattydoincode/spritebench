import { describe, expect, it } from "vitest";
import { ISO_DIAMOND_RATIO } from "@/core/iso";
import {
  ISO_21_SIZE,
  ISO_21_TEMPLATE_ID,
  ISO_DIAMOND_SIZE,
  ISO_DIAMOND_TEMPLATE_ID,
  buildIsoDiamondTemplate,
  clipToIsoDiamond,
  isIsoDiamondTemplate,
  isoProjectionForTemplate,
  pointInIsoDiamond
} from "@/core/isoMask";
import { buildMask } from "@/core/mask";
import { applyPipeline } from "@/core/pipeline";
import { withDefaults } from "@/core/settings";
import { solid } from "./helpers";

describe("iso diamond template", () => {
  it("is √3:1 and only fills the diamond", () => {
    const image = buildIsoDiamondTemplate();
    expect(image.width / image.height).toBeCloseTo(ISO_DIAMOND_RATIO.true, 2);

    const at = (x: number, y: number) => image.data[(y * image.width + x) * 4 + 3];

    expect(at(image.width / 2, image.height / 2)).toBe(255);
    expect(at(0, 0)).toBe(0);
    expect(at(image.width - 1, 0)).toBe(0);
    expect(at(0, image.height - 1)).toBe(0);
    expect(at(image.width - 1, image.height - 1)).toBe(0);
    expect(at(image.width / 2, 0)).toBe(255);
    expect(at(0, image.height / 2)).toBe(255);
  });

  it("builds a 2:1 plate for the dimetric template", () => {
    const image = buildIsoDiamondTemplate(ISO_21_SIZE);
    expect(image.width / image.height).toBe(2);
    expect(isoProjectionForTemplate(ISO_21_TEMPLATE_ID)).toBe("dimetric");
  });

  it("keeps the diamond editable under keepInsideShape", () => {
    const image = buildIsoDiamondTemplate();
    const mask = buildMask(image, ISO_DIAMOND_SIZE, "keepInsideShape", 0.5, 0.85, 0, "contain");

    const alpha = (x: number, y: number) => mask.data[(y * mask.width + x) * 4 + 3];

    expect(alpha(mask.width / 2, mask.height / 2)).toBe(0);
    expect(alpha(0, 0)).toBe(255);
  });

  it("addresses the builtins by stable ids", () => {
    expect(isIsoDiamondTemplate(ISO_DIAMOND_TEMPLATE_ID)).toBe(true);
    expect(isIsoDiamondTemplate(ISO_21_TEMPLATE_ID)).toBe(true);
    expect(isIsoDiamondTemplate("some-upload")).toBe(false);
    expect(isoProjectionForTemplate(ISO_DIAMOND_TEMPLATE_ID)).toBe("true");
  });

  it("rejects points outside a degenerate diamond", () => {
    expect(pointInIsoDiamond(0, 0, 0, 32)).toBe(false);
  });
});

describe("clip to iso diamond", () => {
  it("clears the corners and keeps the edge midpoints of the frame", () => {
    const source = solid(64, 64, { r: 200, g: 40, b: 40 });
    const clipped = clipToIsoDiamond(source);
    const alpha = (x: number, y: number) => clipped.data[(y * 64 + x) * 4 + 3];

    expect(clipped.width).toBe(64);
    expect(clipped.height).toBe(64);
    expect(alpha(32, 32)).toBe(255);
    expect(alpha(32, 0)).toBe(255);
    expect(alpha(0, 32)).toBe(255);
    expect(alpha(63, 32)).toBe(255);
    expect(alpha(32, 63)).toBe(255);
    expect(alpha(0, 0)).toBe(0);
    expect(alpha(63, 0)).toBe(0);
  });

  it("keeps the original canvas even when trim is also on", () => {
    const source = solid(48, 48, { r: 10, g: 20, b: 30 });
    const { image, description } = applyPipeline(
      source,
      withDefaults({
        cutout: "none",
        trimToContent: true,
        snapAlpha: false,
        clipToIso: true
      })
    );

    expect(image.width).toBe(48);
    expect(image.height).toBe(48);
    expect(description).toBe("clip iso");
    expect(image.data[3]).toBe(0);
    expect(image.data[(24 * 48 + 24) * 4 + 3]).toBe(255);
  });
});
