import type { SequencePlanPlate } from "@/shared/model";
import { createImage } from "./pixels";
import { cellUsed } from "./slice";
import type { RgbaImage, Size } from "./types";

function cellRect(
  plate: SequencePlanPlate,
  column: number,
  row: number
): { x: number; y: number; width: number; height: number } {
  const gutter = Math.max(0, Math.floor(plate.gutter ?? 0));
  return {
    x: plate.origin.x + column * (plate.cell.width + gutter),
    y: plate.origin.y + row * (plate.cell.height + gutter),
    width: plate.cell.width,
    height: plate.cell.height
  };
}

export const SHEET_FRAMES_TEMPLATE_ID = "builtin:sheet-frames";
export const SHEET_FRAMES_TEMPLATE_NAME = "frames";
export const SHEET_FRAMES_PREVIEW_SIZE: Size = { width: 256, height: 256 };

/** Black gutters so white cells read as empty frames, not a pixel grid. */
export const SHEET_FRAME_INK = 0;

export function isSheetFramesTemplate(id: string): boolean {
  return id === SHEET_FRAMES_TEMPLATE_ID;
}

export function sheetFramesTemplateInfo(): {
  id: string;
  name: string;
  width: number;
  height: number;
} {
  return {
    id: SHEET_FRAMES_TEMPLATE_ID,
    name: SHEET_FRAMES_TEMPLATE_NAME,
    width: SHEET_FRAMES_PREVIEW_SIZE.width,
    height: SHEET_FRAMES_PREVIEW_SIZE.height
  };
}

/**
 * Equal cells on the request canvas, with a thin gutter between them.
 *
 * Unlike the pixel-constraint plate this does not subdivide a cell into
 * sprite pixels — it is only a frame layout.
 */
export function sheetFrameLayout(canvas: Size, columns: number, rows: number): SequencePlanPlate {
  const cols = Math.max(1, Math.floor(columns) || 1);
  const rws = Math.max(1, Math.floor(rows) || 1);
  const width = Math.max(1, Math.floor(canvas.width));
  const height = Math.max(1, Math.floor(canvas.height));
  const raw = Math.min(width / cols, height / rws);
  const gutter = cols === 1 && rws === 1 ? 0 : Math.max(4, Math.floor(raw * 0.04));
  const cellWidth = Math.max(1, Math.floor((width - (cols - 1) * gutter) / cols));
  const cellHeight = Math.max(1, Math.floor((height - (rws - 1) * gutter) / rws));
  const gridWidth = cols * cellWidth + (cols - 1) * gutter;
  const gridHeight = rws * cellHeight + (rws - 1) * gutter;

  return {
    canvas: { width, height },
    origin: {
      x: Math.floor((width - gridWidth) / 2),
      y: Math.floor((height - gridHeight) / 2)
    },
    cell: { width: cellWidth, height: cellHeight },
    sprite: { width: 1, height: 1 },
    gutter
  };
}

export function attachSheetFramePlate<T extends { columns: number; rows: number }>(
  plan: T,
  canvas: Size
): T & { plate: SequencePlanPlate } {
  return {
    ...plan,
    plate: sheetFrameLayout(canvas, plan.columns, plan.rows)
  };
}

function fillRect(
  image: RgbaImage,
  x0: number,
  y0: number,
  width: number,
  height: number,
  grey: number,
  alpha = 255
) {
  const x1 = Math.min(image.width, x0 + width);
  const y1 = Math.min(image.height, y0 + height);
  const left = Math.max(0, x0);
  const top = Math.max(0, y0);

  for (let y = top; y < y1; y++) {
    for (let x = left; x < x1; x++) {
      const i = (y * image.width + x) * 4;
      image.data[i] = grey;
      image.data[i + 1] = grey;
      image.data[i + 2] = grey;
      image.data[i + 3] = alpha;
    }
  }
}

function blankInk(width: number, height: number): RgbaImage {
  const image = createImage(width, height);
  fillRect(image, 0, 0, width, height, SHEET_FRAME_INK);
  return image;
}

export function buildSheetFramesTemplate(
  canvas: Size,
  plan: {
    columns: number;
    rows: number;
    actions?: Array<{ frames: number }>;
    plate?: SequencePlanPlate | null;
  }
): RgbaImage {
  const layout = plan.plate ?? sheetFrameLayout(canvas, plan.columns, plan.rows);
  const image = blankInk(layout.canvas.width, layout.canvas.height);
  const columns = Math.max(1, plan.columns);
  const rows = Math.max(1, plan.rows);
  const actions = plan.actions ?? [];

  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      if (actions.length > 0 && !cellUsed(row, column, actions)) continue;
      const rect = cellRect(layout, column, row);
      fillRect(image, rect.x, rect.y, rect.width, rect.height, 255);
    }
  }

  return image;
}

export function buildSheetFramesMask(
  canvas: Size,
  plan: {
    columns: number;
    rows: number;
    actions?: Array<{ frames: number }>;
    plate?: SequencePlanPlate | null;
  }
): RgbaImage {
  const layout = plan.plate ?? sheetFrameLayout(canvas, plan.columns, plan.rows);
  const mask = createImage(layout.canvas.width, layout.canvas.height);
  const columns = Math.max(1, plan.columns);
  const rows = Math.max(1, plan.rows);
  const actions = plan.actions ?? [];

  for (let i = 3; i < mask.data.length; i += 4) {
    mask.data[i] = 255;
  }

  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      if (actions.length > 0 && !cellUsed(row, column, actions)) continue;
      const rect = cellRect(layout, column, row);
      fillRect(mask, rect.x, rect.y, rect.width, rect.height, 255, 0);
    }
  }

  return mask;
}

export function previewSheetFramesPlan(): {
  columns: number;
  rows: number;
  actions: Array<{ name: string; frames: number }>;
} {
  return {
    columns: 2,
    rows: 2,
    actions: [
      { name: "walk", frames: 2 },
      { name: "idle", frames: 1 }
    ]
  };
}
