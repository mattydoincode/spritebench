import { describe, expect, it } from "vitest";
import { applyEdits, normalizeEdits } from "@/core/edits";
import { applyPipeline } from "@/core/pipeline";
import {
  DEFAULT_PIXEL_WINDOW,
  PIXEL_CONSTRAINT_GREY_A,
  PIXEL_CONSTRAINT_GREY_B,
  PIXEL_CONSTRAINT_TEMPLATE_ID,
  buildPixelConstraintMask,
  buildPixelConstraintTemplate,
  isPixelConstraintTemplate,
  pixelConstraintLayout,
  pixelConstraintWindow,
  processingForJob,
  samplePixelConstraintGrid,
  withPixelConstraintProcessing
} from "@/core/pixelMask";
import { DEFAULT_PROCESSING } from "@/core/settings";

function at(
  image: { width: number; data: Uint8ClampedArray },
  x: number,
  y: number
): [number, number, number, number] {
  const i = (y * image.width + x) * 4;
  return [image.data[i], image.data[i + 1], image.data[i + 2], image.data[i + 3]];
}

describe("pixel constraint template", () => {
  it("tiles square cells from asset size onto the request canvas", () => {
    expect(pixelConstraintLayout({ width: 1024, height: 1024 }, { width: 32, height: 32 })).toMatchObject({
      columns: 32,
      rows: 32,
      cell: 32,
      originX: 0,
      originY: 0,
      gridWidth: 1024,
      gridHeight: 1024
    });

    expect(pixelConstraintLayout({ width: 1024, height: 1024 }, { width: 32, height: 48 })).toMatchObject({
      columns: 32,
      rows: 48,
      cell: 21,
      originX: 176,
      originY: 8,
      gridWidth: 672,
      gridHeight: 1008
    });
  });

  it("paints a two-grey checkerboard with white margin", () => {
    const image = buildPixelConstraintTemplate({ width: 64, height: 64 }, { width: 4, height: 4 });
    const layout = pixelConstraintLayout({ width: 64, height: 64 }, { width: 4, height: 4 });

    expect(image.width).toBe(64);
    expect(layout.cell).toBe(16);
    expect(at(image, 0, 0)).toEqual([PIXEL_CONSTRAINT_GREY_A, PIXEL_CONSTRAINT_GREY_A, PIXEL_CONSTRAINT_GREY_A, 255]);
    expect(at(image, 8, 8)).toEqual([PIXEL_CONSTRAINT_GREY_A, PIXEL_CONSTRAINT_GREY_A, PIXEL_CONSTRAINT_GREY_A, 255]);
    expect(at(image, 16, 8)).toEqual([PIXEL_CONSTRAINT_GREY_B, PIXEL_CONSTRAINT_GREY_B, PIXEL_CONSTRAINT_GREY_B, 255]);
    expect(at(image, 24, 8)).toEqual([PIXEL_CONSTRAINT_GREY_B, PIXEL_CONSTRAINT_GREY_B, PIXEL_CONSTRAINT_GREY_B, 255]);
  });

  it("keeps leftover canvas white when the grid cannot fill the plate", () => {
    const image = buildPixelConstraintTemplate({ width: 64, height: 64 }, { width: 2, height: 4 });
    const layout = pixelConstraintLayout({ width: 64, height: 64 }, { width: 2, height: 4 });

    expect(layout.cell).toBe(16);
    expect(layout.originX).toBe(16);
    expect(at(image, 0, 0)).toEqual([255, 255, 255, 255]);
    expect(at(image, 63, 32)).toEqual([255, 255, 255, 255]);
  });

  it("unlocks only the grid in the mask", () => {
    const mask = buildPixelConstraintMask({ width: 64, height: 64 }, { width: 2, height: 4 });
    const layout = pixelConstraintLayout({ width: 64, height: 64 }, { width: 2, height: 4 });
    const alpha = (x: number, y: number) => mask.data[(y * mask.width + x) * 4 + 3];

    expect(alpha(layout.originX, layout.originY)).toBe(0);
    expect(alpha(layout.originX + layout.gridWidth - 1, layout.originY + layout.gridHeight - 1)).toBe(0);
    expect(alpha(0, 0)).toBe(255);
  });

  it("pixelates each stored cell and ignores the white margin", () => {
    const canvas = { width: 64, height: 64 };
    const cells = { width: 2, height: 4 };
    const painted = buildPixelConstraintTemplate(canvas, cells);
    const layout = pixelConstraintLayout(canvas, cells);
    const col = 1;
    const row = 2;
    const x0 = layout.originX + col * layout.cell;
    const y0 = layout.originY + row * layout.cell;

    for (let y = y0; y < y0 + layout.cell; y++) {
      for (let x = x0; x < x0 + layout.cell; x++) {
        const i = (y * painted.width + x) * 4;
        painted.data[i] = 200;
        painted.data[i + 1] = 10;
        painted.data[i + 2] = 30;
      }
    }

    const sprite = samplePixelConstraintGrid(painted, {
      kind: "pixelGrid",
      columns: 2,
      rows: 4,
      canvasWidth: 64,
      canvasHeight: 64,
      originX: layout.originX,
      originY: layout.originY,
      cell: layout.cell
    });

    expect(sprite.width).toBe(2);
    expect(sprite.height).toBe(4);
    expect(at(sprite, col, row)).toEqual([200, 10, 30, 255]);
    expect(at(sprite, 0, 0)).toEqual([PIXEL_CONSTRAINT_GREY_A, PIXEL_CONSTRAINT_GREY_A, PIXEL_CONSTRAINT_GREY_A, 255]);
  });

  it("addresses the builtin by a stable id", () => {
    expect(isPixelConstraintTemplate(PIXEL_CONSTRAINT_TEMPLATE_ID)).toBe(true);
    expect(isPixelConstraintTemplate("builtin:iso-diamond")).toBe(false);
    expect(DEFAULT_PIXEL_WINDOW).toEqual({ width: 32, height: 32 });
  });

  it("reads the cell count from asset size, defaulting a zero axis to 32", () => {
    expect(pixelConstraintWindow({ width: 32, height: 48 })).toEqual({ width: 32, height: 48 });
    expect(pixelConstraintWindow({ width: 0, height: 0 })).toEqual({ width: 32, height: 32 });
    expect(pixelConstraintWindow({ width: 24, height: 0 })).toEqual({ width: 24, height: 32 });
  });

  it("stores the plate layout and turns off trim/cutout", () => {
    const next = withPixelConstraintProcessing(DEFAULT_PROCESSING, { width: 32, height: 48 }, {
      width: 1024,
      height: 1024
    });

    expect(next.edits[0]).toEqual({
      kind: "pixelGrid",
      columns: 32,
      rows: 48,
      canvasWidth: 1024,
      canvasHeight: 1024,
      originX: 176,
      originY: 8,
      cell: 21
    });
    expect(next.trimToContent).toBe(false);
    expect(next.cutout).toBe("none");
    expect(next.targetSize).toEqual({ width: 32, height: 48 });
    expect(DEFAULT_PROCESSING.trimToContent).toBe(true);
    expect(DEFAULT_PROCESSING.edits).toEqual([]);
  });

  it("reattaches the stored grid on enqueue after dropping client crops", () => {
    const processing = {
      ...DEFAULT_PROCESSING,
      targetSize: { width: 32, height: 48 },
      edits: [{ kind: "crop" as const, x: 1, y: 2, width: 8, height: 8 }]
    };
    const mask = {
      source: { kind: "template" as const, templateId: PIXEL_CONSTRAINT_TEMPLATE_ID },
      window: { width: 32, height: 48 }
    };

    expect(processingForJob(processing, { mask }, { width: 1024, height: 1024 }).edits[0]).toEqual({
      kind: "pixelGrid",
      columns: 32,
      rows: 48,
      canvasWidth: 1024,
      canvasHeight: 1024,
      originX: 176,
      originY: 8,
      cell: 21
    });

    expect(processingForJob(processing, null).edits).toEqual([]);
  });

  it("samples a padded plate through the pipeline without trimming", () => {
    const source = buildPixelConstraintTemplate({ width: 64, height: 64 }, { width: 2, height: 4 });
    const settings = processingForJob(
      DEFAULT_PROCESSING,
      {
        mask: {
          source: { kind: "template", templateId: PIXEL_CONSTRAINT_TEMPLATE_ID },
          window: { width: 2, height: 4 }
        }
      },
      { width: 64, height: 64 }
    );

    const { image } = applyPipeline(source, settings);

    expect(image.width).toBe(2);
    expect(image.height).toBe(4);
    expect(at(image, 0, 0)).toEqual([PIXEL_CONSTRAINT_GREY_A, PIXEL_CONSTRAINT_GREY_A, PIXEL_CONSTRAINT_GREY_A, 255]);
    expect(at(image, 1, 0)).toEqual([PIXEL_CONSTRAINT_GREY_B, PIXEL_CONSTRAINT_GREY_B, PIXEL_CONSTRAINT_GREY_B, 255]);
  });

  it("keeps pixel-grid edits when settings are re-normalized", () => {
    expect(
      normalizeEdits([
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
      ])
    ).toEqual([
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
    ]);
  });

  it("still applies a columns-only edit by recomputing from the result", () => {
    expect(
      applyEdits(buildPixelConstraintTemplate({ width: 64, height: 64 }, { width: 4, height: 4 }), [
        { kind: "pixelGrid", columns: 4, rows: 4 }
      ])
    ).toMatchObject({ width: 4, height: 4 });
  });
});
