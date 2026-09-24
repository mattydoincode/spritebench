import { describe, expect, it } from "vitest";
import { SHEET_FRAME_INK, SHEET_FRAMES_TEMPLATE_ID, sheetFrameLayout } from "@/core/frameMask";
import { ISO_21_TEMPLATE_ID, ISO_DIAMOND_SIZE, ISO_DIAMOND_TEMPLATE_ID } from "@/core/isoMask";
import { layoutPlateForJob, overlayPlateForView } from "@/core/layoutPlate";
import {
  PIXEL_CONSTRAINT_GREY_A,
  PIXEL_CONSTRAINT_GREY_B,
  PIXEL_CONSTRAINT_TEMPLATE_ID,
  sheetCellRect,
  sheetPixelConstraintLayout
} from "@/core/pixelMask";

function at(image: { width: number; data: Uint8ClampedArray }, x: number, y: number) {
  const i = (y * image.width + x) * 4;
  return [image.data[i], image.data[i + 1], image.data[i + 2], image.data[i + 3]];
}

describe("layout plate overlay", () => {
  it("rebuilds the pixel-constraint plate from the stored grid", () => {
    const plate = layoutPlateForJob({
      mask: {
        source: { kind: "template", templateId: PIXEL_CONSTRAINT_TEMPLATE_ID },
        window: { width: 32, height: 48 }
      },
      edits: [
        {
          kind: "pixelGrid",
          columns: 32,
          rows: 48,
          canvasWidth: 1024,
          canvasHeight: 1024,
          originX: 176,
          originY: 8,
          cell: 21
        }
      ],
      sourceSize: { width: 1024, height: 1024 },
      targetSize: { width: 32, height: 48 }
    });

    expect(plate?.width).toBe(1024);
    expect(plate?.height).toBe(1024);
    expect(at(plate!, 0, 0)).toEqual([255, 255, 255, 255]);
    expect(at(plate!, 176 + 10, 8 + 10)).toEqual([
      PIXEL_CONSTRAINT_GREY_A,
      PIXEL_CONSTRAINT_GREY_A,
      PIXEL_CONSTRAINT_GREY_A,
      255
    ]);
  });

  it("samples the plate to asset size for the processed overlay", () => {
    const plate = layoutPlateForJob({
      mask: {
        source: { kind: "template", templateId: PIXEL_CONSTRAINT_TEMPLATE_ID },
        window: { width: 2, height: 4 }
      },
      edits: [
        {
          kind: "pixelGrid",
          columns: 2,
          rows: 4,
          canvasWidth: 64,
          canvasHeight: 64,
          originX: 16,
          originY: 0,
          cell: 16
        }
      ],
      sourceSize: { width: 64, height: 64 },
      targetSize: { width: 2, height: 4 }
    });
    if (!plate) throw new Error("expected plate");

    const overlay = overlayPlateForView(plate, [
      {
        kind: "pixelGrid",
        columns: 2,
        rows: 4,
        canvasWidth: 64,
        canvasHeight: 64,
        originX: 16,
        originY: 0,
        cell: 16
      }
    ], "processed");

    expect(overlay.width).toBe(2);
    expect(overlay.height).toBe(4);
    expect(at(overlay, 0, 0)).toEqual([
      PIXEL_CONSTRAINT_GREY_A,
      PIXEL_CONSTRAINT_GREY_A,
      PIXEL_CONSTRAINT_GREY_A,
      255
    ]);
    expect(at(overlay, 1, 0)).toEqual([
      PIXEL_CONSTRAINT_GREY_B,
      PIXEL_CONSTRAINT_GREY_B,
      PIXEL_CONSTRAINT_GREY_B,
      255
    ]);
  });

  it("builds the iso diamond for that plate", () => {
    const plate = layoutPlateForJob({
      mask: { source: { kind: "template", templateId: ISO_DIAMOND_TEMPLATE_ID } },
      edits: [],
      sourceSize: { width: 1024, height: 1024 },
      targetSize: { width: 0, height: 0 }
    });

    expect(plate?.width).toBe(ISO_DIAMOND_SIZE.width);
    expect(plate?.height).toBe(ISO_DIAMOND_SIZE.height);
  });

  it("builds the 2:1 diamond for that plate", () => {
    const plate = layoutPlateForJob({
      mask: { source: { kind: "template", templateId: ISO_21_TEMPLATE_ID } },
      edits: [],
      sourceSize: { width: 1024, height: 1024 },
      targetSize: { width: 0, height: 0 }
    });

    expect(plate?.width).toBe(256);
    expect(plate?.height).toBe(128);
  });

  it("rebuilds the full sheet plate for a pixel-constrained animation", () => {
    const plateLayout = sheetPixelConstraintLayout({ width: 64, height: 64 }, { width: 4, height: 4 }, 2, 2);
    const plate = layoutPlateForJob({
      mask: {
        source: { kind: "template", templateId: PIXEL_CONSTRAINT_TEMPLATE_ID },
        window: { width: 4, height: 4 }
      },
      edits: [
        {
          kind: "pixelGrid",
          columns: 4,
          rows: 4,
          canvasWidth: plateLayout.cell.width,
          canvasHeight: plateLayout.cell.height,
          originX: 0,
          originY: 0,
          cell: 7
        }
      ],
      sourceSize: { width: 64, height: 64 },
      targetSize: { width: 4, height: 4 },
      sequencePlan: {
        columns: 2,
        rows: 2,
        fps: 6,
        actions: [
          { name: "walk", frames: 2 },
          { name: "idle", frames: 1 }
        ],
        plate: plateLayout
      }
    });

    expect(plate?.width).toBe(64);
    const first = sheetCellRect(plateLayout, 0, 0);
    const unused = sheetCellRect(plateLayout, 1, 1);
    expect(at(plate!, first.x, first.y)).toEqual([
      PIXEL_CONSTRAINT_GREY_A,
      PIXEL_CONSTRAINT_GREY_A,
      PIXEL_CONSTRAINT_GREY_A,
      255
    ]);
    expect(at(plate!, unused.x, unused.y)).toEqual([255, 255, 255, 255]);
  });

  it("samples one animation cell for the processed overlay, not the whole sheet", () => {
    const plateLayout = sheetPixelConstraintLayout({ width: 64, height: 64 }, { width: 4, height: 4 }, 2, 2);
    const edits = [
      {
        kind: "pixelGrid" as const,
        columns: 4,
        rows: 4,
        canvasWidth: plateLayout.cell.width,
        canvasHeight: plateLayout.cell.height,
        originX: 0,
        originY: 0,
        cell: Math.max(1, Math.floor(plateLayout.cell.width / 4))
      }
    ];
    const plate = layoutPlateForJob({
      mask: {
        source: { kind: "template", templateId: PIXEL_CONSTRAINT_TEMPLATE_ID },
        window: { width: 4, height: 4 }
      },
      edits,
      sourceSize: { width: 64, height: 64 },
      targetSize: { width: 4, height: 4 },
      sequencePlan: {
        columns: 2,
        rows: 2,
        fps: 6,
        actions: [{ name: "walk", frames: 2 }],
        plate: plateLayout
      }
    });
    if (!plate) throw new Error("expected plate");

    const overlay = overlayPlateForView(plate, edits, "processed", {
      columns: 2,
      rows: 2,
      fps: 6,
      actions: [{ name: "walk", frames: 2 }],
      plate: plateLayout
    });

    expect(overlay.width).toBe(4);
    expect(overlay.height).toBe(4);
    expect(at(overlay, 0, 0)).toEqual([
      PIXEL_CONSTRAINT_GREY_A,
      PIXEL_CONSTRAINT_GREY_A,
      PIXEL_CONSTRAINT_GREY_A,
      255
    ]);
    expect(at(overlay, 1, 0)).toEqual([
      PIXEL_CONSTRAINT_GREY_B,
      PIXEL_CONSTRAINT_GREY_B,
      PIXEL_CONSTRAINT_GREY_B,
      255
    ]);
  });

  it("rebuilds empty white cells for a frames sheet", () => {
    const plateLayout = sheetFrameLayout({ width: 64, height: 64 }, 2, 2);
    const plate = layoutPlateForJob({
      mask: { source: { kind: "template", templateId: SHEET_FRAMES_TEMPLATE_ID } },
      edits: [],
      sourceSize: { width: 64, height: 64 },
      targetSize: { width: 0, height: 0 },
      sequencePlan: {
        columns: 2,
        rows: 2,
        fps: 6,
        actions: [
          { name: "walk", frames: 2 },
          { name: "idle", frames: 1 }
        ],
        plate: plateLayout
      }
    });

    expect(plate?.width).toBe(64);
    const first = sheetCellRect(plateLayout, 0, 0);
    const unused = sheetCellRect(plateLayout, 1, 1);
    expect(at(plate!, first.x, first.y)).toEqual([255, 255, 255, 255]);
    expect(at(plate!, unused.x, unused.y)).toEqual([
      SHEET_FRAME_INK,
      SHEET_FRAME_INK,
      SHEET_FRAME_INK,
      255
    ]);
  });

  it("returns nothing when the job had no mask", () => {
    expect(
      layoutPlateForJob({
        mask: null,
        edits: [],
        sourceSize: { width: 1024, height: 1024 },
        targetSize: { width: 32, height: 32 }
      })
    ).toBeNull();
  });
});
