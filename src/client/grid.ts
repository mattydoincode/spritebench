import { isoLattice, isoStampBox } from "@/core/repeater";
import { terrainExtent } from "@/core/terrain";
import type { Size } from "@/core/types";
import {
  isIsoPlacement,
  isoPitchForRepeater,
  type RepeatGroup,
  type StagedItem,
  type TerrainGroup
} from "@/shared/model";

export interface Point {
  x: number;
  y: number;
}

/** Nearest scene grid intersection in world coordinates. */
export function snapPointToGrid(point: Point, unitsPerCell: number): Point {
  const spacing =
    Number.isFinite(unitsPerCell) && unitsPerCell > 0 ? unitsPerCell : 1;

  return {
    x: Math.round(point.x / spacing) * spacing,
    y: Math.round(point.y / spacing) * spacing
  };
}

/**
 * Where the camera has to sit to put something in the middle of the view.
 *
 * `x` and `y` are a top-left corner on both kinds of thing, so centring means
 * adding half the extent. A sprite carries its own footprint. A repeater's
 * extent is its cell size times its counts, plus the margins between cells.
 */
export type ResizeCorner = "nw" | "ne" | "sw" | "se";

const OPPOSITE_CORNER: Record<ResizeCorner, ResizeCorner> = {
  nw: "se",
  ne: "sw",
  sw: "ne",
  se: "nw"
};

/** Clockwise, y-down — same convention as CSS `rotate` and item.rotation. */
export function rotateAbout(point: Point, center: Point, degrees: number): Point {
  if (!Number.isFinite(degrees) || degrees % 360 === 0) return { x: point.x, y: point.y };

  const rad = (degrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = point.x - center.x;
  const dy = point.y - center.y;

  return {
    x: center.x + dx * cos - dy * sin,
    y: center.y + dx * sin + dy * cos
  };
}

export function unrotateAbout(point: Point, center: Point, degrees: number): Point {
  return rotateAbout(point, center, -degrees);
}

function boxCenter(box: { x: number; y: number; width: number; height: number }): Point {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

function cornerPoint(
  box: { x: number; y: number; width: number; height: number },
  corner: ResizeCorner
): Point {
  const east = corner === "ne" || corner === "se";
  const south = corner === "se" || corner === "sw";
  return {
    x: east ? box.x + box.width : box.x,
    y: south ? box.y + box.height : box.y
  };
}

/**
 * Resize a sprite from one corner, keeping the opposite corner planted.
 *
 * Aspect lock projects the pointer onto the diagonal out of that anchor, so
 * the dragged corner stays on the original proportions instead of picking
 * an axis and fighting you.
 *
 * `rotation` is the sprite's current turn. The pointer is read in that frame
 * so a handle that has spun with the art still grows the same local edge,
 * and the opposite corner stays planted in the world.
 */
export function resizeFromCorner(
  start: { x: number; y: number; width: number; height: number },
  corner: ResizeCorner,
  pointer: Point,
  options: { lockAspect?: boolean; snap?: number; rotation?: number } = {}
): { x: number; y: number; width: number; height: number } {
  const width = Math.max(1, start.width);
  const height = Math.max(1, start.height);
  const rotation = options.rotation ?? 0;
  const center = boxCenter({ ...start, width, height });
  const local = unrotateAbout(pointer, center, rotation);
  const at = options.snap ? snapPointToGrid(local, options.snap) : local;

  const east = corner === "ne" || corner === "se";
  const south = corner === "se" || corner === "sw";

  const anchor = {
    x: east ? start.x : start.x + width,
    y: south ? start.y : start.y + height
  };

  const dx = Math.abs(at.x - anchor.x);
  const dy = Math.abs(at.y - anchor.y);

  let nextWidth: number;
  let nextHeight: number;

  if (options.lockAspect) {
    const scale = (dx * width + dy * height) / (width * width + height * height);
    const sized = Math.max(1 / Math.max(width, height), scale);
    nextWidth = Math.max(1, Math.round(width * sized));
    nextHeight = Math.max(1, Math.round(height * sized));
  } else {
    nextWidth = Math.max(1, Math.round(dx));
    nextHeight = Math.max(1, Math.round(dy));
  }

  const next = {
    x: east ? anchor.x : anchor.x - nextWidth,
    y: south ? anchor.y : anchor.y - nextHeight,
    width: nextWidth,
    height: nextHeight
  };

  if (rotation % 360 === 0) return next;

  const planted = OPPOSITE_CORNER[corner];
  const plantWorld = rotateAbout(cornerPoint({ ...start, width, height }, planted), center, rotation);
  const plantAfter = rotateAbout(cornerPoint(next, planted), boxCenter(next), rotation);

  return {
    ...next,
    x: next.x + plantWorld.x - plantAfter.x,
    y: next.y + plantWorld.y - plantAfter.y
  };
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type RepeaterScalePatch = {
  x: number;
  y: number;
  cell: Size;
  marginX: number;
  marginY: number;
  areaWidth: number;
  areaHeight: number;
};

type RepeaterLayout = Pick<
  RepeatGroup,
  | "x"
  | "y"
  | "placement"
  | "marginX"
  | "marginY"
  | "countX"
  | "countY"
  | "fillX"
  | "fillY"
  | "areaWidth"
  | "areaHeight"
> & { isoPitch?: number };

function isoMapBox(
  origin: Point,
  cell: Size,
  marginX: number,
  marginY: number,
  cols: number,
  rows: number,
  pitch: number
): Box {
  const lattice = isoLattice(cell, marginX, marginY, pitch);
  const corners = [
    [0, 0],
    [Math.max(0, cols - 1), 0],
    [0, Math.max(0, rows - 1)],
    [Math.max(0, cols - 1), Math.max(0, rows - 1)]
  ] as const;

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const [col, row] of corners) {
    const box = isoStampBox(col, row, origin, lattice, cell);
    minX = Math.min(minX, box.x);
    maxX = Math.max(maxX, box.x + box.width);
    minY = Math.min(minY, box.y);
    maxY = Math.max(maxY, box.y + box.height);
  }

  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY)
  };
}

/**
 * The rectangle the corner handles sit on. Finite maps use the whole
 * footprint; a fill axis collapses to one cell so you are not dragging
 * infinity. Scatter is the scatter area.
 */
export function repeaterScaleBox(group: RepeaterLayout, cell: Size): Box {
  if (group.placement === "scatter") {
    return {
      x: group.x,
      y: group.y,
      width: Math.max(1, group.areaWidth),
      height: Math.max(1, group.areaHeight)
    };
  }

  const cols = group.fillX ? 1 : Math.max(1, Math.floor(group.countX));
  const rows = group.fillY ? 1 : Math.max(1, Math.floor(group.countY));
  const width = Math.max(1, cell.width);
  const height = Math.max(1, cell.height);

  if (isIsoPlacement(group.placement)) {
    return isoMapBox(
      { x: group.x, y: group.y },
      { width, height },
      group.marginX,
      group.marginY,
      cols,
      rows,
      isoPitchForRepeater(group)
    );
  }

  return {
    x: group.x,
    y: group.y,
    width: Math.max(1, (width + group.marginX) * cols - group.marginX),
    height: Math.max(1, (height + group.marginY) * rows - group.marginY)
  };
}

/**
 * Map a dragged scale box back onto cell, margins, and origin. Opposite
 * corner of the box stays planted; stamps scale with the box.
 */
export function applyRepeaterScale(
  group: RepeaterLayout,
  cell: Size,
  start: Box,
  next: Box
): RepeaterScalePatch {
  const startW = Math.max(1, start.width);
  const startH = Math.max(1, start.height);
  const scaleX = Math.max(1 / startW, next.width / startW);
  const scaleY = Math.max(1 / startH, next.height / startH);

  const nextCell = {
    width: cell.width > 0 ? Math.max(1, Math.round(cell.width * scaleX)) : 0,
    height: cell.height > 0 ? Math.max(1, Math.round(cell.height * scaleY)) : 0
  };

  const scaled: RepeaterScalePatch = {
    x: group.x,
    y: group.y,
    cell: nextCell,
    marginX: Math.round(group.marginX * scaleX),
    marginY: Math.round(group.marginY * scaleY),
    areaWidth:
      group.placement === "scatter"
        ? Math.max(1, next.width)
        : Math.max(1, Math.round(group.areaWidth * scaleX)),
    areaHeight:
      group.placement === "scatter"
        ? Math.max(1, next.height)
        : Math.max(1, Math.round(group.areaHeight * scaleY))
  };

  const tentative = repeaterScaleBox({ ...group, ...scaled }, {
    width: nextCell.width > 0 ? nextCell.width : Math.max(1, Math.round(startW * scaleX)),
    height: nextCell.height > 0 ? nextCell.height : Math.max(1, Math.round(startH * scaleY))
  });

  return {
    ...scaled,
    x: group.x + (next.x - tentative.x),
    y: group.y + (next.y - tentative.y)
  };
}

export function centerOf(entry: StagedItem | RepeatGroup | TerrainGroup): Point {
  if ("footprint" in entry) {
    return {
      x: entry.x + entry.footprint.width / 2,
      y: entry.y + entry.footprint.height / 2
    };
  }

  if ("tiles" in entry) {
    const extent = terrainExtent(entry);
    return {
      x: entry.x + extent.width / 2,
      y: entry.y + extent.height / 2
    };
  }

  if (entry.placement === "scatter") {
    return {
      x: entry.x + Math.max(1, entry.areaWidth) / 2,
      y: entry.y + Math.max(1, entry.areaHeight) / 2
    };
  }

  // A repeater's cell size can be inherited from its art, which is only known
  // once that art has decoded. With no explicit cell this centres on the
  // origin, which is near enough to find it again.
  if (entry.cell.width <= 0 && entry.cell.height <= 0) {
    return { x: entry.x, y: entry.y };
  }

  if (isIsoPlacement(entry.placement)) {
    if (entry.cell.width <= 0) return { x: entry.x, y: entry.y };

    const box = isoMapBox(
      { x: entry.x, y: entry.y },
      entry.cell,
      entry.marginX,
      entry.marginY,
      Math.max(1, Math.floor(entry.countX)),
      Math.max(1, Math.floor(entry.countY)),
      isoPitchForRepeater(entry)
    );

    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }

  return {
    x: entry.x + ((entry.cell.width + entry.marginX) * entry.countX) / 2,
    y: entry.y + ((entry.cell.height + entry.marginY) * entry.countY) / 2
  };
}
