import {
  EDGE_MULTIPLE,
  MAX_EDGE,
  MAX_ASPECT,
  MAX_TOTAL_PIXELS,
  isValidFlexibleSize
} from "./size";
import type { Rect, Size } from "./types";

/**
 * Sheet layout, in both directions.
 *
 * `planSheetRequest` picks the canvas to *ask* a model for. `planSheet` packs
 * frames the pipeline has already produced back into one image for export.
 * They are separate problems -- one is bounded by what the provider accepts,
 * the other by what a game engine wants to read -- and only share the habit of
 * preferring a near-square grid.
 */

export interface GridShape {
  columns: number;
  rows: number;
}

/**
 * Candidate grids for a frame count, roughly square first.
 *
 * Squareness is not cosmetic. `MAX_ASPECT` is 3, so a horizontal strip is
 * illegal past three frames -- an eight-frame 8x1 sheet is 8:1 and the request
 * is rejected. Every layout here is a grid for that reason.
 */
export function gridShapes(frameCount: number): GridShape[] {
  const count = Math.max(1, Math.floor(frameCount));
  const shapes: GridShape[] = [];

  for (let columns = 1; columns <= count; columns++) {
    const rows = Math.ceil(count / columns);
    const aspect = Math.max(columns / rows, rows / columns);
    if (aspect > MAX_ASPECT) continue;

    shapes.push({ columns, rows });
  }

  return shapes;
}

export interface SheetRequest extends GridShape {
  /** Edge of one cell, in generated pixels. */
  cell: number;
  /** The canvas to request. Always a legal flexible size. */
  size: Size;
  /** Cells the frames do not fill. Wasted spend, so worth showing. */
  spare: number;
}

/** The largest cell a grid can use, as a multiple of the edge quantum. */
function largestCell(shape: GridShape): number {
  const byEdge = Math.min(MAX_EDGE / shape.columns, MAX_EDGE / shape.rows);
  const byArea = Math.sqrt(MAX_TOTAL_PIXELS / (shape.columns * shape.rows));

  return Math.floor(Math.min(byEdge, byArea) / EDGE_MULTIPLE) * EDGE_MULTIPLE;
}

/**
 * The cell this grid will actually use, honouring the caller's ceiling where
 * it can.
 *
 * The ceiling is a preference and `MIN_TOTAL_PIXELS` is not: a four-frame
 * sheet at 256-pixel cells is a 512x512 canvas, which the provider rejects as
 * too small. Growing past the ceiling is the only way to make such a request
 * at all, so it beats honouring a number the caller offered as a cost hint.
 */
function fitCell(shape: GridShape, desired: number): number | null {
  const largest = largestCell(shape);
  if (largest < EDGE_MULTIPLE) return null;

  const quantised = Math.floor(desired / EDGE_MULTIPLE) * EDGE_MULTIPLE;

  for (
    let cell = Math.min(largest, Math.max(EDGE_MULTIPLE, quantised));
    cell <= largest;
    cell += EDGE_MULTIPLE
  ) {
    const size = { width: shape.columns * cell, height: shape.rows * cell };
    if (isValidFlexibleSize(size)) return cell;
  }

  return null;
}

/**
 * The canvas to ask for, given how many frames are wanted.
 *
 * Cell size is quantised to `EDGE_MULTIPLE` so that multiplying by the column
 * and row counts lands on a legal edge without a snap that would move the cell
 * boundaries out from under the slicer.
 *
 * `maxCell` is the caller's cost lever: output is billed per pixel, and a
 * 64-pixel sprite gains nothing from a 720-pixel cell. Passing roughly four
 * times the intended sprite size keeps enough headroom for the downsample
 * while not paying for a 4-megapixel canvas nobody looks at.
 */
/**
 * Grows a prescribed action grid until the provider will accept the aspect.
 *
 * One row per action and columns = the longest cycle is what you draw. An
 * 8-frame walk alone is 8:1, which is illegal, so empty rows get added at the
 * bottom (and empty columns on the right for a tall stack). Those cells are
 * masked, not drawn.
 */
export function padGridForAspect(columns: number, rows: number): GridShape {
  let wide = Math.max(1, Math.floor(columns));
  let tall = Math.max(1, Math.floor(rows));

  while (Math.max(wide / tall, tall / wide) > MAX_ASPECT) {
    if (wide >= tall) tall += 1;
    else wide += 1;
  }

  return { columns: wide, rows: tall };
}

/** Legal canvas for a grid whose shape is already decided. */
export function planSheetRequestForGrid(shape: GridShape, maxCell?: number): SheetRequest {
  const columns = Math.max(1, Math.floor(shape.columns));
  const rows = Math.max(1, Math.floor(shape.rows));
  const ceiling = maxCell && maxCell > 0 ? maxCell : Number.POSITIVE_INFINITY;
  const cell = fitCell({ columns, rows }, ceiling) ?? EDGE_MULTIPLE;

  return {
    columns,
    rows,
    cell,
    size: { width: columns * cell, height: rows * cell },
    spare: 0
  };
}

export function planSheetRequest(frameCount: number, maxCell?: number): SheetRequest {
  const count = Math.max(1, Math.floor(frameCount));
  const ceiling = maxCell && maxCell > 0 ? maxCell : Number.POSITIVE_INFINITY;

  let best: SheetRequest | null = null;

  for (const shape of gridShapes(count)) {
    const cell = fitCell(shape, ceiling);
    if (cell === null) continue;

    const candidate: SheetRequest = {
      ...shape,
      cell,
      size: { width: shape.columns * cell, height: shape.rows * cell },
      spare: shape.columns * shape.rows - count
    };

    if (!best || isBetterRequest(candidate, best)) best = candidate;
  }

  // Nothing legal, which only happens for frame counts past what a single
  // canvas can hold. One cell is a useless sheet but a valid request, and the
  // caller surfaces the frame count as the problem.
  return best ?? fallbackRequest(count);
}

/**
 * Bigger cells win, then fewer wasted cells, then squarer.
 *
 * Cell size first because detail is the thing you cannot recover later: a
 * spare cell costs a fraction of the spend, while a cell too small to
 * downsample from costs the whole generation.
 */
function isBetterRequest(candidate: SheetRequest, best: SheetRequest): boolean {
  if (candidate.cell !== best.cell) return candidate.cell > best.cell;
  if (candidate.spare !== best.spare) return candidate.spare < best.spare;

  const candidateSkew = Math.abs(candidate.columns - candidate.rows);
  const bestSkew = Math.abs(best.columns - best.rows);
  if (candidateSkew !== bestSkew) return candidateSkew < bestSkew;

  // 4x2 rather than 2x4. A wide sheet is the convention, and without this the
  // two are indistinguishable and the answer depends on iteration order.
  return candidate.columns > best.columns;
}

function fallbackRequest(count: number): SheetRequest {
  const columns = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / columns);
  const cell = EDGE_MULTIPLE;

  return {
    columns,
    rows,
    cell,
    size: { width: columns * cell, height: rows * cell },
    spare: columns * rows - count
  };
}

export interface SheetPlacement extends Rect {
  index: number;
}

export interface SheetPlan {
  size: Size;
  columns: number;
  rows: number;
  /** Uniform cell every frame is placed inside. */
  cell: Size;
  placements: SheetPlacement[];
}

export interface PackOptions {
  /** Force a column count. Defaults to the squarest legal grid. */
  columns?: number;
  /** Transparent gutter between cells, so filtering cannot bleed across. */
  padding?: number;
}

/**
 * Packs processed frames into one image for export.
 *
 * Cells are uniform and sized to the largest frame, because that is what an
 * engine importing a sheet expects: frame `n` is at a computable offset. When
 * frames differ in size they are centred horizontally and sat on the bottom of
 * the cell rather than centred both ways -- a sprite that changes height
 * between frames should keep its feet on the ground, not float.
 *
 * With trim off, which is what a sequence forces, every frame is already the
 * same size and the alignment never comes up.
 */
export function planSheet(sizes: Size[], options: PackOptions = {}): SheetPlan {
  const padding = Math.max(0, Math.floor(options.padding ?? 0));

  const cell = {
    width: Math.max(1, ...sizes.map((size) => Math.max(1, Math.floor(size.width)))),
    height: Math.max(1, ...sizes.map((size) => Math.max(1, Math.floor(size.height))))
  };

  const columns =
    options.columns && options.columns > 0
      ? Math.floor(options.columns)
      : Math.max(1, Math.ceil(Math.sqrt(sizes.length)));

  const rows = Math.max(1, Math.ceil(sizes.length / columns));

  const placements = sizes.map((size, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);

    const width = Math.max(1, Math.floor(size.width));
    const height = Math.max(1, Math.floor(size.height));

    const cellX = padding + column * (cell.width + padding);
    const cellY = padding + row * (cell.height + padding);

    return {
      index,
      x: cellX + Math.floor((cell.width - width) / 2),
      y: cellY + (cell.height - height),
      width,
      height
    };
  });

  return {
    size: {
      width: columns * cell.width + padding * (columns + 1),
      height: rows * cell.height + padding * (rows + 1)
    },
    columns,
    rows,
    cell,
    placements
  };
}
