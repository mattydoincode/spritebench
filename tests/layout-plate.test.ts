import { describe, expect, it } from "vitest";
import { ISO_DIAMOND_TEMPLATE_ID } from "@/core/isoMask";
import { layoutPlateForJob, overlayPlateForView } from "@/core/layoutPlate";
import {
  PIXEL_CONSTRAINT_GREY_A,
  PIXEL_CONSTRAINT_GREY_B,
  PIXEL_CONSTRAINT_TEMPLATE_ID
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

    expect(plate?.width).toBe(256);
    expect(plate?.height).toBe(128);
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
