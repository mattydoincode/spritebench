import { describe, expect, it } from "vitest";
import {
  SHEET_FRAME_INK,
  SHEET_FRAMES_TEMPLATE_ID,
  buildSheetFramesMask,
  buildSheetFramesTemplate,
  isSheetFramesTemplate,
  sheetFrameLayout
} from "@/core/frameMask";
import { isLayoutGuideTemplate, sheetCellRect } from "@/core/pixelMask";

function at(image: { width: number; data: Uint8ClampedArray }, x: number, y: number) {
  const i = (y * image.width + x) * 4;
  return [image.data[i], image.data[i + 1], image.data[i + 2], image.data[i + 3]];
}

const plan = {
  columns: 2,
  rows: 2,
  actions: [
    { name: "walk", frames: 2 },
    { name: "idle", frames: 1 }
  ]
};

describe("sheet frames plate", () => {
  it("is a layout guide, not a pixel constraint", () => {
    expect(isSheetFramesTemplate(SHEET_FRAMES_TEMPLATE_ID)).toBe(true);
    expect(isLayoutGuideTemplate(SHEET_FRAMES_TEMPLATE_ID)).toBe(true);
    expect(isSheetFramesTemplate("builtin:pixel-constraint")).toBe(false);
  });

  it("paints used cells white and leaves gutters and unused cells black", () => {
    const canvas = { width: 64, height: 64 };
    const layout = sheetFrameLayout(canvas, 2, 2);
    const image = buildSheetFramesTemplate(canvas, { ...plan, plate: layout });

    const used = sheetCellRect(layout, 0, 0);
    const unused = sheetCellRect(layout, 1, 1);
    expect(at(image, used.x, used.y)).toEqual([255, 255, 255, 255]);
    expect(at(image, unused.x, unused.y)).toEqual([SHEET_FRAME_INK, SHEET_FRAME_INK, SHEET_FRAME_INK, 255]);
    if ((layout.gutter ?? 0) > 0) {
      expect(at(image, used.x + used.width, used.y)).toEqual([
        SHEET_FRAME_INK,
        SHEET_FRAME_INK,
        SHEET_FRAME_INK,
        255
      ]);
    }
  });

  it("unlocks only used cells on the mask", () => {
    const canvas = { width: 64, height: 64 };
    const layout = sheetFrameLayout(canvas, 2, 2);
    const mask = buildSheetFramesMask(canvas, { ...plan, plate: layout });
    const used = sheetCellRect(layout, 0, 0);
    const unused = sheetCellRect(layout, 1, 1);

    expect(at(mask, used.x, used.y)[3]).toBe(0);
    expect(at(mask, unused.x, unused.y)[3]).toBe(255);
  });
});
