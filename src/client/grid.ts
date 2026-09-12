import { isoLattice, isoStampBox } from "@/core/repeater";
import { terrainExtent } from "@/core/terrain";
import type { RepeatGroup, StagedItem, TerrainGroup } from "@/shared/model";

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

  if (entry.placement === "iso") {
    if (entry.cell.width <= 0) return { x: entry.x, y: entry.y };

    const lattice = isoLattice(entry.cell, entry.marginX, entry.marginY);
    const cols = Math.max(1, Math.floor(entry.countX));
    const rows = Math.max(1, Math.floor(entry.countY));
    const origin = { x: entry.x, y: entry.y };
    const corners = [
      [0, 0],
      [cols - 1, 0],
      [0, rows - 1],
      [cols - 1, rows - 1]
    ] as const;

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (const [col, row] of corners) {
      const box = isoStampBox(col, row, origin, lattice, entry.cell);
      minX = Math.min(minX, box.x);
      maxX = Math.max(maxX, box.x + box.width);
      minY = Math.min(minY, box.y);
      maxY = Math.max(maxY, box.y + box.height);
    }

    return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  }

  return {
    x: entry.x + ((entry.cell.width + entry.marginX) * entry.countX) / 2,
    y: entry.y + ((entry.cell.height + entry.marginY) * entry.countY) / 2
  };
}
