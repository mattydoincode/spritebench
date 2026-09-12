import { isIsoDiamondTemplate } from "./isoMask";
import { createImage } from "./pixels";
import { resize } from "./resample";
import type { RgbaImage, Size } from "./types";

export const PIXEL_CONSTRAINT_TEMPLATE_ID = "builtin:pixel-constraint";
export const PIXEL_CONSTRAINT_TEMPLATE_NAME = "pixel constraint";
export const PIXEL_CONSTRAINT_PREVIEW_SIZE: Size = { width: 256, height: 256 };
export const DEFAULT_PIXEL_WINDOW: Size = { width: 32, height: 32 };

/** Two mid greys so leftover guide cells are obvious after the model draws. */
export const PIXEL_CONSTRAINT_GREY_A = 88;
export const PIXEL_CONSTRAINT_GREY_B = 168;

export function isPixelConstraintTemplate(id: string): boolean {
  return id === PIXEL_CONSTRAINT_TEMPLATE_ID;
}

/** Builtin plates that are layout masks, not composition references. */
export function isLayoutGuideTemplate(id: string): boolean {
  return isIsoDiamondTemplate(id) || isPixelConstraintTemplate(id);
}

export function pixelConstraintTemplateInfo(): {
  id: string;
  name: string;
  width: number;
  height: number;
} {
  return {
    id: PIXEL_CONSTRAINT_TEMPLATE_ID,
    name: PIXEL_CONSTRAINT_TEMPLATE_NAME,
    width: PIXEL_CONSTRAINT_PREVIEW_SIZE.width,
    height: PIXEL_CONSTRAINT_PREVIEW_SIZE.height
  };
}

/** Asset size is the cell count. A zero axis falls back to 32. */
export function pixelConstraintWindow(target: Size): Size {
  return {
    width: target.width > 0 ? Math.max(1, Math.floor(target.width)) : DEFAULT_PIXEL_WINDOW.width,
    height: target.height > 0 ? Math.max(1, Math.floor(target.height)) : DEFAULT_PIXEL_WINDOW.height
  };
}

export interface PixelConstraintLayout {
  canvas: Size;
  columns: number;
  rows: number;
  cell: number;
  originX: number;
  originY: number;
  gridWidth: number;
  gridHeight: number;
}

/**
 * Largest square cell that fits `columns×rows` on the request canvas.
 *
 * 32×32 on 1024 → 32px cells that fill the plate. 32×48 on 1024 → 21px
 * cells (limited by the taller axis) with white margin on the sides.
 */
export function pixelConstraintLayout(canvas: Size, cells: Size): PixelConstraintLayout {
  const width = Math.max(1, Math.floor(canvas.width));
  const height = Math.max(1, Math.floor(canvas.height));
  const columns = Math.max(1, Math.min(width, Math.floor(cells.width) || 1));
  const rows = Math.max(1, Math.min(height, Math.floor(cells.height) || 1));
  const cell = Math.max(1, Math.floor(Math.min(width / columns, height / rows)));
  const gridWidth = columns * cell;
  const gridHeight = rows * cell;

  return {
    canvas: { width, height },
    columns,
    rows,
    cell,
    originX: Math.floor((width - gridWidth) / 2),
    originY: Math.floor((height - gridHeight) / 2),
    gridWidth,
    gridHeight
  };
}

export interface PixelGridSpec {
  kind: "pixelGrid";
  columns: number;
  rows: number;
  canvasWidth?: number;
  canvasHeight?: number;
  originX?: number;
  originY?: number;
  cell?: number;
}

export function pixelConstraintEdit(layout: PixelConstraintLayout): PixelGridSpec {
  return {
    kind: "pixelGrid",
    columns: layout.columns,
    rows: layout.rows,
    canvasWidth: layout.canvas.width,
    canvasHeight: layout.canvas.height,
    originX: layout.originX,
    originY: layout.originY,
    cell: layout.cell
  };
}

/** Map a stored plate onto whatever size the model actually returned. */
export function resolvePixelGridLayout(
  image: Size,
  spec: Pick<PixelGridSpec, "columns" | "rows" | "canvasWidth" | "canvasHeight" | "originX" | "originY" | "cell">
): PixelConstraintLayout {
  const columns = Math.max(1, Math.round(spec.columns));
  const rows = Math.max(1, Math.round(spec.rows));

  if (
    spec.cell &&
    spec.canvasWidth &&
    spec.canvasHeight &&
    spec.originX !== undefined &&
    spec.originY !== undefined
  ) {
    const scaleX = image.width / spec.canvasWidth;
    const scaleY = image.height / spec.canvasHeight;
    const originX = Math.round(spec.originX * scaleX);
    const originY = Math.round(spec.originY * scaleY);
    const gridWidth = Math.max(1, Math.round(spec.columns * spec.cell * scaleX));
    const gridHeight = Math.max(1, Math.round(spec.rows * spec.cell * scaleY));

    return {
      canvas: { width: image.width, height: image.height },
      columns,
      rows,
      cell: Math.max(1, Math.round(spec.cell * Math.min(scaleX, scaleY))),
      originX,
      originY,
      gridWidth: Math.min(gridWidth, Math.max(1, image.width - originX)),
      gridHeight: Math.min(gridHeight, Math.max(1, image.height - originY))
    };
  }

  return pixelConstraintLayout(image, { width: columns, height: rows });
}

/**
 * Crop to the stored grid (white margin stays out), then pixelate each cell
 * to one sprite pixel. Recomputes the grid only when the job has no layout.
 */
export function samplePixelConstraintGrid(image: RgbaImage, spec: PixelGridSpec): RgbaImage {
  const layout = resolvePixelGridLayout({ width: image.width, height: image.height }, spec);
  const cropped = cropRect(image, layout.originX, layout.originY, layout.gridWidth, layout.gridHeight);

  if (cropped.width === layout.columns && cropped.height === layout.rows) return cropped;

  return resize(cropped, { width: layout.columns, height: layout.rows }, "dominantColor", 0.5);
}

/** Downsample the checkerboard without writing that into user defaults. */
export function withPixelConstraintProcessing<
  T extends { edits: unknown[]; targetSize: Size; trimToContent: boolean; cutout: string }
>(processing: T, cells: Size, canvas?: Size): T {
  const window = pixelConstraintWindow(cells);
  const edit = canvas
    ? pixelConstraintEdit(pixelConstraintLayout(canvas, window))
    : { kind: "pixelGrid" as const, columns: window.width, rows: window.height };

  return {
    ...processing,
    edits: [edit, ...processing.edits],
    trimToContent: false,
    cutout: "none",
    targetSize: { width: window.width, height: window.height }
  };
}

/**
 * New jobs drop client crops, then attach the stored plate layout. Trim and
 * cutout stay off: the white margin is padding, not content to flood-fill.
 */
export function processingForJob<
  T extends { edits: unknown[]; targetSize: Size; trimToContent: boolean; cutout: string }
>(
  processing: T,
  inputs: { mask?: { source: { kind: string; templateId?: string }; window?: Size } | null } | null | undefined,
  canvas?: Size
): T {
  const next = { ...processing, edits: [] as T["edits"] };
  const mask = inputs?.mask;
  if (mask?.source.kind !== "template" || !isPixelConstraintTemplate(mask.source.templateId ?? "")) {
    return next;
  }

  return withPixelConstraintProcessing(
    next,
    pixelConstraintWindow(mask.window ?? processing.targetSize),
    canvas
  );
}

function cropRect(image: RgbaImage, x: number, y: number, width: number, height: number): RgbaImage {
  const out = createImage(width, height);

  for (let row = 0; row < height; row++) {
    const sourceRow = y + row;
    if (sourceRow < 0 || sourceRow >= image.height) continue;

    for (let column = 0; column < width; column++) {
      const sourceColumn = x + column;
      if (sourceColumn < 0 || sourceColumn >= image.width) continue;

      const from = (sourceRow * image.width + sourceColumn) * 4;
      const to = (row * width + column) * 4;
      out.data[to] = image.data[from];
      out.data[to + 1] = image.data[from + 1];
      out.data[to + 2] = image.data[from + 2];
      out.data[to + 3] = image.data[from + 3];
    }
  }

  return out;
}

/**
 * Request-sized plate: white outside, two-grey checkerboard for the sprite
 * cells. The greys are the grid — no extra outline.
 */
export function buildPixelConstraintTemplate(
  canvas: Size,
  cells: Size = DEFAULT_PIXEL_WINDOW
): RgbaImage {
  const layout = pixelConstraintLayout(canvas, cells);
  const image = createImage(layout.canvas.width, layout.canvas.height);

  for (let i = 0; i < image.data.length; i += 4) {
    image.data[i] = 255;
    image.data[i + 1] = 255;
    image.data[i + 2] = 255;
    image.data[i + 3] = 255;
  }

  for (let row = 0; row < layout.rows; row++) {
    for (let column = 0; column < layout.columns; column++) {
      const grey = (column + row) % 2 === 0 ? PIXEL_CONSTRAINT_GREY_A : PIXEL_CONSTRAINT_GREY_B;
      const x0 = layout.originX + column * layout.cell;
      const y0 = layout.originY + row * layout.cell;
      fillRect(image, x0, y0, layout.cell, layout.cell, grey);
    }
  }

  return image;
}

/** Editable inside the grid, locked white margin. Used when a reference is the base. */
export function buildPixelConstraintMask(canvas: Size, cells: Size): RgbaImage {
  const layout = pixelConstraintLayout(canvas, cells);
  const mask = createImage(layout.canvas.width, layout.canvas.height);

  for (let i = 3; i < mask.data.length; i += 4) {
    mask.data[i] = 255;
  }

  for (let y = 0; y < layout.gridHeight; y++) {
    for (let x = 0; x < layout.gridWidth; x++) {
      const i = ((layout.originY + y) * mask.width + (layout.originX + x)) * 4;
      mask.data[i + 3] = 0;
    }
  }

  return mask;
}

function fillRect(image: RgbaImage, x0: number, y0: number, width: number, height: number, grey: number) {
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
    }
  }
}
