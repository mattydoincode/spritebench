import { describe, expect, it } from "vitest";
import { flattenEditGuide } from "@/core/guide";
import { createImage } from "@/core/pixels";

function pixel(image: ReturnType<typeof createImage>, x: number, y: number) {
  const i = (y * image.width + x) * 4;
  return [image.data[i], image.data[i + 1], image.data[i + 2], image.data[i + 3]];
}

describe("flattenEditGuide", () => {
  it("paints editable mask pixels white and empty protected pixels black", () => {
    const base = createImage(2, 1);
    const mask = createImage(2, 1);
    mask.data[3] = 0;
    mask.data[7] = 255;

    const guide = flattenEditGuide(base, mask);

    expect(pixel(guide, 0, 0)).toEqual([255, 255, 255, 255]);
    expect(pixel(guide, 1, 0)).toEqual([0, 0, 0, 255]);
  });

  it("keeps the base colour where the mask protects an opaque pixel", () => {
    const base = createImage(1, 1);
    base.data.set([10, 20, 30, 255]);
    const mask = createImage(1, 1);
    mask.data[3] = 255;

    expect(pixel(flattenEditGuide(base, mask), 0, 0)).toEqual([10, 20, 30, 255]);
  });

  it("refuses a size mismatch", () => {
    expect(() => flattenEditGuide(createImage(2, 1), createImage(1, 1))).toThrow(/does not match/);
  });
});
