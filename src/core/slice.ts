import { createImage, toByte } from "./pixels";
import type { Inset, Rect, RgbaImage, Size } from "./types";

/**
 * Cutting a sheet into frames.
 *
 * Pure geometry over an image, kept out of the client so the layout can be
 * verified in a test instead of by eye. `sliceGrid` is what the slice dialog's
 * inputs drive; `detectGrid` guesses those inputs from the pixels;
 * `placeFrame` / `nudgeFrame` are the fixed-size boxes you drag; and
 * `unionInset` is what removes dead space without breaking registration.
 */

export interface GridOptions {
  columns: number;
  rows: number;
  /** Border between the sheet edge and the first cell. */
  marginX: number;
  marginY: number;
  /** Gutter between cells. */
  spacingX: number;
  spacingY: number;
}

export const DEFAULT_GRID: GridOptions = {
  columns: 4,
  rows: 4,
  marginX: 0,
  marginY: 0,
  spacingX: 0,
  spacingY: 0
};

function whole(value: number, fallback = 0): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : fallback;
}

/**
 * Cell edges along one axis.
 *
 * Positions are computed in floating point and rounded at the boundary rather
 * than by flooring a cell size and multiplying. Flooring loses up to a pixel
 * per cell, which on a 6-wide grid walks the last cell six pixels left of
 * where the art actually is.
 */
function edges(total: number, count: number, margin: number, spacing: number): number[] {
  const usable = total - margin * 2 - spacing * (count - 1);
  const cell = usable / count;

  const result: number[] = [];
  for (let index = 0; index <= count; index++) {
    result.push(Math.round(margin + index * (cell + spacing)));
  }

  return result;
}

/** Frame rectangles in row-major order: left to right, then top to bottom. */
export function sliceGrid(size: Size, options: GridOptions): Rect[] {
  const columns = Math.max(1, whole(options.columns, 1));
  const rows = Math.max(1, whole(options.rows, 1));
  const width = Math.max(1, Math.floor(size.width));
  const height = Math.max(1, Math.floor(size.height));

  // A margin or gutter wide enough to consume the sheet would produce zero or
  // negative cells. Clamping to something that still leaves a pixel per cell
  // keeps a mistyped number as a visibly wrong grid rather than an exception.
  const marginX = Math.min(whole(options.marginX), Math.max(0, Math.floor((width - columns) / 2)));
  const marginY = Math.min(whole(options.marginY), Math.max(0, Math.floor((height - rows) / 2)));

  const maxSpacingX = columns > 1 ? Math.floor((width - marginX * 2 - columns) / (columns - 1)) : 0;
  const maxSpacingY = rows > 1 ? Math.floor((height - marginY * 2 - rows) / (rows - 1)) : 0;
  const spacingX = Math.min(whole(options.spacingX), Math.max(0, maxSpacingX));
  const spacingY = Math.min(whole(options.spacingY), Math.max(0, maxSpacingY));

  const columnEdges = edges(width, columns, marginX, spacingX);
  const rowEdges = edges(height, rows, marginY, spacingY);

  const rects: Rect[] = [];

  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const left = columnEdges[column];
      const top = rowEdges[row];

      rects.push({
        x: left,
        y: top,
        width: Math.max(1, columnEdges[column + 1] - spacingX - left),
        height: Math.max(1, rowEdges[row + 1] - spacingY - top)
      });
    }
  }

  return rects;
}

/** Whether this cell is a real frame, vs a hole the model was told not to draw. */
export function cellUsed(
  row: number,
  column: number,
  actions: Array<{ frames: number }>
): boolean {
  return row >= 0 && row < actions.length && column >= 0 && column < actions[row].frames;
}

/**
 * OpenAI mask for an action grid: transparent where the model should draw,
 * opaque where the cell is unused (short row, or a padding row for aspect).
 */
export function buildSheetMask(
  size: Size,
  columns: number,
  rows: number,
  actions: Array<{ frames: number }>
): RgbaImage {
  const width = Math.max(1, Math.floor(size.width));
  const height = Math.max(1, Math.floor(size.height));
  const mask = createImage(width, height);

  for (let pixel = 0; pixel < width * height; pixel++) {
    const i = pixel * 4;
    mask.data[i] = 255;
    mask.data[i + 1] = 255;
    mask.data[i + 2] = 255;
    mask.data[i + 3] = 255;
  }

  const rects = sliceGrid({ width, height }, {
    columns,
    rows,
    marginX: 0,
    marginY: 0,
    spacingX: 0,
    spacingY: 0
  });

  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      if (!cellUsed(row, column, actions)) continue;

      const rect = rects[row * columns + column];
      if (!rect) continue;

      for (let y = rect.y; y < rect.y + rect.height; y++) {
        for (let x = rect.x; x < rect.x + rect.width; x++) {
          mask.data[(y * width + x) * 4 + 3] = 0;
        }
      }
    }
  }

  return mask;
}

/**
 * Maps a rectangle from one image's coordinate space into another's.
 *
 * Frame rectangles are stored against the raw source, but the library renders
 * from a 256-pixel thumbnail. Without this, frame 4 of a 2880-pixel sheet
 * would be cropped at x=2160 out of a 256-pixel image -- entirely off the
 * edge, so the thumbnail comes back blank.
 *
 * Clamped to the target, because rounding at both edges of a heavy downscale
 * can otherwise push the right edge a pixel past the image.
 */
export function scaleRect(rect: Rect, from: Size, to: Size): Rect {
  if (from.width <= 0 || from.height <= 0) return rect;

  const scaleX = to.width / from.width;
  const scaleY = to.height / from.height;

  const x = Math.max(0, Math.min(to.width - 1, Math.round(rect.x * scaleX)));
  const y = Math.max(0, Math.min(to.height - 1, Math.round(rect.y * scaleY)));

  return {
    x,
    y,
    width: Math.max(1, Math.min(to.width - x, Math.round(rect.width * scaleX))),
    height: Math.max(1, Math.min(to.height - y, Math.round(rect.height * scaleY)))
  };
}

/** Per-column and per-row flags: does this line hold any opaque pixel. */
function occupancy(image: RgbaImage, alphaThreshold: number) {
  const cutoff = toByte(alphaThreshold);
  const columns = new Uint8Array(image.width);
  const rows = new Uint8Array(image.height);

  for (let y = 0; y < image.height; y++) {
    const rowStart = y * image.width * 4;
    for (let x = 0; x < image.width; x++) {
      if (image.data[rowStart + x * 4 + 3] < cutoff) continue;
      columns[x] = 1;
      rows[y] = 1;
    }
  }

  return { columns, rows };
}

/** Runs of occupied lines, as [start, endInclusive] pairs. */
function bands(flags: Uint8Array): Array<[number, number]> {
  const result: Array<[number, number]> = [];
  let start = -1;

  for (let index = 0; index < flags.length; index++) {
    if (flags[index]) {
      if (start === -1) start = index;
      continue;
    }

    if (start !== -1) {
      result.push([start, index - 1]);
      start = -1;
    }
  }

  if (start !== -1) result.push([start, flags.length - 1]);

  return result;
}

function averageGap(found: Array<[number, number]>): number {
  if (found.length < 2) return 0;

  let total = 0;
  for (let index = 1; index < found.length; index++) {
    total += found[index][0] - found[index - 1][1] - 1;
  }

  return Math.max(0, Math.round(total / (found.length - 1)));
}

/**
 * Guesses the grid from the transparent gutters between sprites.
 *
 * Content-aware rather than "divide the width by four", because a sheet whose
 * sprites differ in size gets clipped by uniform division -- the failure mode
 * everyone hits first. Returns options for the same inputs the dialog edits,
 * so the guess is a starting point the user can nudge rather than a separate
 * code path.
 *
 * Returns null for a sheet with no transparent gutters at all, where there is
 * nothing to go on and a guess would be worse than asking.
 */
export function detectGrid(image: RgbaImage, alphaThreshold: number): GridOptions | null {
  const { columns, rows } = occupancy(image, alphaThreshold);

  const columnBands = bands(columns);
  const rowBands = bands(rows);

  if (columnBands.length === 0 || rowBands.length === 0) return null;
  if (columnBands.length === 1 && rowBands.length === 1) return null;

  return {
    columns: columnBands.length,
    rows: rowBands.length,
    marginX: columnBands[0][0],
    marginY: rowBands[0][0],
    spacingX: averageGap(columnBands),
    spacingY: averageGap(rowBands)
  };
}

/** Content bounds inside one rectangle, in image coordinates. */
function contentBounds(image: RgbaImage, rect: Rect, cutoff: number): Rect | null {
  const left = Math.max(0, Math.floor(rect.x));
  const top = Math.max(0, Math.floor(rect.y));
  const right = Math.min(image.width - 1, left + Math.floor(rect.width) - 1);
  const bottom = Math.min(image.height - 1, top + Math.floor(rect.height) - 1);

  let minX = right + 1;
  let minY = bottom + 1;
  let maxX = left - 1;
  let maxY = top - 1;

  for (let y = top; y <= bottom; y++) {
    const rowStart = y * image.width * 4;
    for (let x = left; x <= right; x++) {
      if (image.data[rowStart + x * 4 + 3] < cutoff) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < minX || maxY < minY) return null;

  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/**
 * Where the art actually sits inside one frame.
 *
 * Both an outline and a centre of mass, because they fail in opposite ways.
 * A bounding box is thrown by one outstretched limb -- a swinging arm drags
 * its edge back and forth and takes the box centre with it. The alpha-weighted
 * centroid barely notices a thin limb, but drifts if the character's bulk
 * genuinely moves. Which one registers a given animation best is a judgement
 * the person watching it should make, so both are measured and the choice is
 * theirs.
 */
export interface FrameMeasure {
  /** Content bounds in image coordinates, or null for an empty frame. */
  bounds: Rect | null;
  /** Alpha-weighted centre of mass, in image coordinates. */
  centroidX: number;
  centroidY: number;
}

/** Measures every frame in one pass over the image. */
export function measureFrames(
  image: RgbaImage,
  rects: Rect[],
  alphaThreshold: number
): FrameMeasure[] {
  const cutoff = toByte(alphaThreshold);

  return rects.map((rect) => {
    const bounds = contentBounds(image, rect, cutoff);

    const left = Math.max(0, Math.floor(rect.x));
    const top = Math.max(0, Math.floor(rect.y));
    const right = Math.min(image.width - 1, left + Math.floor(rect.width) - 1);
    const bottom = Math.min(image.height - 1, top + Math.floor(rect.height) - 1);

    let weight = 0;
    let sumX = 0;
    let sumY = 0;

    for (let y = top; y <= bottom; y++) {
      const rowStart = y * image.width * 4;
      for (let x = left; x <= right; x++) {
        const alpha = image.data[rowStart + x * 4 + 3];
        if (alpha < cutoff) continue;

        weight += alpha;
        sumX += x * alpha;
        sumY += y * alpha;
      }
    }

    // An empty frame reports the middle of its own cell rather than zero, so
    // it contributes something neutral instead of yanking the alignment to
    // the top-left corner of the sheet.
    if (weight === 0) {
      return {
        bounds,
        centroidX: left + Math.floor(rect.width) / 2,
        centroidY: top + Math.floor(rect.height) / 2
      };
    }

    return { bounds, centroidX: sumX / weight, centroidY: sumY / weight };
  });
}

/**
 * The dead space every frame shares, as an inset off each frame's rectangle.
 *
 * Taking the minimum across frames rather than each frame's own bounds is the
 * whole point: an inset that varies per frame is just `trimToContent` again,
 * and the sprite would drift. Frames with no content at all are skipped rather
 * than counted as fully inset.
 */
export function unionInset(image: RgbaImage, rects: Rect[], alphaThreshold: number): Inset {
  const cutoff = toByte(alphaThreshold);

  let left = Infinity;
  let top = Infinity;
  let right = Infinity;
  let bottom = Infinity;

  for (const rect of rects) {
    const bounds = contentBounds(image, rect, cutoff);
    if (!bounds) continue;

    const rectRight = Math.floor(rect.x) + Math.floor(rect.width) - 1;
    const rectBottom = Math.floor(rect.y) + Math.floor(rect.height) - 1;

    left = Math.min(left, bounds.x - Math.floor(rect.x));
    top = Math.min(top, bounds.y - Math.floor(rect.y));
    right = Math.min(right, rectRight - (bounds.x + bounds.width - 1));
    bottom = Math.min(bottom, rectBottom - (bounds.y + bounds.height - 1));
  }

  if (!Number.isFinite(left)) return { top: 0, right: 0, bottom: 0, left: 0 };

  return {
    top: Math.max(0, top),
    right: Math.max(0, right),
    bottom: Math.max(0, bottom),
    left: Math.max(0, left)
  };
}

/** Shared crop size. Every frame of a sequence has to be the same. */
export interface FrameSize {
  width: number;
  height: number;
}

function clampSize(size: FrameSize, sheet: Size): FrameSize {
  return {
    width: Math.max(1, Math.min(Math.floor(sheet.width), Math.max(1, Math.floor(size.width)))),
    height: Math.max(1, Math.min(Math.floor(sheet.height), Math.max(1, Math.floor(size.height))))
  };
}

/**
 * The largest size that still fits inside every cell.
 *
 * Grid remainder can leave the last column a pixel wider; taking the min
 * keeps every frame the same instead of inheriting that slack.
 */
export function cellFrameSize(cells: Rect[]): FrameSize {
  if (cells.length === 0) return { width: 1, height: 1 };

  return {
    width: Math.max(1, Math.min(...cells.map((cell) => Math.max(1, Math.floor(cell.width))))),
    height: Math.max(1, Math.min(...cells.map((cell) => Math.max(1, Math.floor(cell.height)))))
  };
}

/**
 * Keeps a frame on the sheet without changing its size, unless the size
 * itself is larger than the sheet.
 */
export function clampFrame(rect: Rect, sheet: Size): Rect {
  const width = Math.max(1, Math.min(Math.floor(sheet.width), Math.max(1, Math.floor(rect.width))));
  const height = Math.max(
    1,
    Math.min(Math.floor(sheet.height), Math.max(1, Math.floor(rect.height)))
  );

  return {
    x: Math.max(0, Math.min(Math.floor(sheet.width) - width, Math.round(rect.x))),
    y: Math.max(0, Math.min(Math.floor(sheet.height) - height, Math.round(rect.y))),
    width,
    height
  };
}

/** A fixed-size frame centred in a grid cell. */
export function placeFrame(cell: Rect, size: FrameSize, sheet: Size): Rect {
  const { width, height } = clampSize(size, sheet);

  return clampFrame(
    {
      x: Math.round(cell.x + (cell.width - width) / 2),
      y: Math.round(cell.y + (cell.height - height) / 2),
      width,
      height
    },
    sheet
  );
}

export function placeFrames(cells: Rect[], size: FrameSize, sheet: Size): Rect[] {
  return cells.map((cell) => placeFrame(cell, size, sheet));
}

/** Slide a frame without resizing it. */
export function nudgeFrame(rect: Rect, dx: number, dy: number, sheet: Size): Rect {
  return clampFrame({ ...rect, x: rect.x + dx, y: rect.y + dy }, sheet);
}

/**
 * Resize around the current centre.
 *
 * Growing or shrinking from the top-left would walk the sprite out of the
 * box the moment you type a new frame size. The centre is what you were
 * aiming at.
 */
export function resizeFrame(rect: Rect, size: FrameSize, sheet?: Size): Rect {
  const width = Math.max(1, Math.floor(size.width));
  const height = Math.max(1, Math.floor(size.height));

  const next: Rect = {
    x: Math.round(rect.x + rect.width / 2 - width / 2),
    y: Math.round(rect.y + rect.height / 2 - height / 2),
    width,
    height
  };

  return sheet ? clampFrame(next, sheet) : next;
}

export function resizeFrames(rects: Rect[], size: FrameSize, sheet?: Size): Rect[] {
  return rects.map((rect) => resizeFrame(rect, size, sheet));
}

/** Bake a shared inset into the rectangles themselves. */
export function applyInset(rects: Rect[], inset: Inset): Rect[] {
  const left = Math.max(0, Math.round(inset.left));
  const top = Math.max(0, Math.round(inset.top));
  const right = Math.max(0, Math.round(inset.right));
  const bottom = Math.max(0, Math.round(inset.bottom));

  return rects.map((rect) => ({
    x: Math.round(rect.x) + left,
    y: Math.round(rect.y) + top,
    width: Math.max(1, Math.round(rect.width) - left - right),
    height: Math.max(1, Math.round(rect.height) - top - bottom)
  }));
}

/**
 * Shrink every frame by the empty margin they all share.
 *
 * Same numbers as `unionInset`, written back onto the rectangles so "frame
 * size" and "tighten" are one concept instead of two overlays.
 */
export function tightenFrames(
  image: RgbaImage,
  rects: Rect[],
  alphaThreshold: number
): Rect[] {
  if (rects.length === 0) return [];
  return applyInset(rects, unionInset(image, rects, alphaThreshold));
}
