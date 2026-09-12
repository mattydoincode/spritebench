import { describe, expect, it } from "vitest";
import {
  ISO_DIAMOND_SIZE,
  ISO_DIAMOND_TEMPLATE_ID,
  buildIsoDiamondTemplate,
  isIsoDiamondTemplate,
  pointInIsoDiamond
} from "@/core/isoMask";
import { buildMask } from "@/core/mask";

describe("iso diamond template", () => {
  it("is 2:1 and only fills the diamond", () => {
    const image = buildIsoDiamondTemplate();
    expect(image.width / image.height).toBe(2);

    const at = (x: number, y: number) => image.data[(y * image.width + x) * 4 + 3];

    expect(at(image.width / 2, image.height / 2)).toBe(255);
    expect(at(0, 0)).toBe(0);
    expect(at(image.width - 1, 0)).toBe(0);
    expect(at(0, image.height - 1)).toBe(0);
    expect(at(image.width - 1, image.height - 1)).toBe(0);
    expect(at(image.width / 2, 0)).toBe(255);
    expect(at(0, image.height / 2)).toBe(255);
  });

  it("keeps the diamond editable under keepInsideShape", () => {
    const image = buildIsoDiamondTemplate();
    const mask = buildMask(image, ISO_DIAMOND_SIZE, "keepInsideShape", 0.5, 0.85, 0, "contain");

    const alpha = (x: number, y: number) => mask.data[(y * mask.width + x) * 4 + 3];

    expect(alpha(mask.width / 2, mask.height / 2)).toBe(0);
    expect(alpha(0, 0)).toBe(255);
  });

  it("addresses the builtin by a stable id", () => {
    expect(isIsoDiamondTemplate(ISO_DIAMOND_TEMPLATE_ID)).toBe(true);
    expect(isIsoDiamondTemplate("some-upload")).toBe(false);
  });

  it("rejects points outside a degenerate diamond", () => {
    expect(pointInIsoDiamond(0, 0, 0, 32)).toBe(false);
  });
});
