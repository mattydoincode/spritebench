import type { RepeaterRotate, RepeatGroup } from "@/shared/model";
import type { Size } from "@/core/types";

/**
 * Repeater placement, kept out of the scene so a scatter of trash can be
 * enumerated in a test instead of by dragging a slider and squinting.
 */

export interface PlannedStamp {
  key: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  flipH: boolean;
  flipV: boolean;
  mixIndex: number;
}

export function clampDegrees(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return ((Math.round(value) % 360) + 360) % 360;
}

/** 0 is upright, handle-up. World y grows down, same as the scene. */
export function rotateFromCenter(
  center: { x: number; y: number },
  pointer: { x: number; y: number },
  snap = 0
): number {
  const deg =
    (Math.atan2(pointer.y - center.y, pointer.x - center.x) * 180) / Math.PI + 90;
  const wrapped = clampDegrees(deg);
  if (snap <= 0) return wrapped;
  return clampDegrees(Math.round(wrapped / snap) * snap);
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function stampStyle(
  random: () => number,
  rotate: RepeaterRotate,
  scaleJitter: number
): { rotation: number; flipH: boolean; flipV: boolean; scale: number } {
  const jitter = Math.min(1, Math.max(0, scaleJitter));
  const scale = Math.max(0.2, 1 + (random() * 2 - 1) * jitter);

  if (rotate === "quarter") {
    return { rotation: Math.floor(random() * 4) * 90, flipH: false, flipV: false, scale };
  }

  if (rotate === "flip") {
    return { rotation: 0, flipH: random() < 0.5, flipV: random() < 0.5, scale };
  }

  if (rotate === "free") {
    return { rotation: Math.floor(random() * 360), flipH: false, flipV: false, scale };
  }

  return { rotation: 0, flipH: false, flipV: false, scale };
}

/** Pull a 0–1 coordinate toward 0 or 1. Bias 1 lands on an edge. */
export function towardEdge(t: number, bias: number): number {
  if (bias <= 0) return t;
  const clamped = Math.min(1, Math.max(0, t));
  const fromEdge = clamped < 0.5 ? clamped : 1 - clamped;
  const pulled = fromEdge * (1 - Math.min(1, bias));
  return clamped < 0.5 ? pulled : 1 - pulled;
}

export function pickIndex(seed: number, column: number, row: number, count: number): number {
  if (count <= 1) return 0;

  let hash = (seed ^ Math.imul(column, 374761393) ^ Math.imul(row, 668265263)) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 13), 1274126177) >>> 0;
  hash = (hash ^ (hash >>> 16)) >>> 0;

  return hash % count;
}

function boxAt(
  origin: { x: number; y: number },
  cell: Size,
  scale: number,
  style: { rotation: number; flipH: boolean; flipV: boolean },
  mixIndex: number,
  key: string
): PlannedStamp {
  const width = Math.max(1, cell.width * scale);
  const height = Math.max(1, cell.height * scale);

  return {
    key,
    x: origin.x,
    y: origin.y,
    width,
    height,
    rotation: style.rotation,
    flipH: style.flipH,
    flipV: style.flipV,
    mixIndex
  };
}

/**
 * 2:1 dimetric tile: the diamond pixel-art maps actually click together on.
 * Width is the cell; height is half of that. Art may be taller and hangs
 * north of the diamond so a building covers the tile behind it.
 */
export interface IsoLattice {
  diamondW: number;
  diamondH: number;
  halfW: number;
  halfH: number;
}

export function isoLattice(cell: Size, marginX: number, marginY: number): IsoLattice {
  const diamondW = Math.max(0, cell.width);
  const diamondH = diamondW / 2;

  return {
    diamondW,
    diamondH,
    halfW: (diamondW + marginX) / 2,
    halfH: (diamondH + marginY) / 2
  };
}

export function isoDiamondOrigin(
  col: number,
  row: number,
  origin: { x: number; y: number },
  lattice: IsoLattice
): { x: number; y: number } {
  return {
    x: origin.x + (col - row) * lattice.halfW,
    y: origin.y + (col + row) * lattice.halfH
  };
}

export function isoStampBox(
  col: number,
  row: number,
  origin: { x: number; y: number },
  lattice: IsoLattice,
  cell: Size,
  scale = 1
): { x: number; y: number; width: number; height: number } {
  const diamond = isoDiamondOrigin(col, row, origin, lattice);
  const width = Math.max(1, cell.width * scale);
  const height = Math.max(1, cell.height * scale);

  return {
    x: diamond.x + (lattice.diamondW - width) / 2,
    y: diamond.y + lattice.diamondH - height,
    width,
    height
  };
}

function boxesOverlap(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number }
): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

function isoIndexRange(options: {
  origin: { x: number; y: number };
  lattice: IsoLattice;
  cell: Size;
  view: { minX: number; maxX: number; minY: number; maxY: number };
}): { col0: number; col1: number; row0: number; row1: number } {
  const { origin, lattice, cell, view } = options;
  if (lattice.halfW === 0 || lattice.halfH === 0) {
    return { col0: 0, col1: 0, row0: 0, row1: 0 };
  }

  const padX = Math.max(lattice.diamondW, cell.width);
  const padY = Math.max(lattice.diamondH, cell.height);
  const xs = [view.minX - padX, view.maxX + padX];
  const ys = [view.minY - padY, view.maxY + padY];

  let col0 = Infinity;
  let col1 = -Infinity;
  let row0 = Infinity;
  let row1 = -Infinity;

  for (const x of xs) {
    for (const y of ys) {
      const u = (x - origin.x) / lattice.halfW;
      const v = (y - origin.y) / lattice.halfH;
      const col = (u + v) / 2;
      const row = (v - u) / 2;
      col0 = Math.min(col0, col);
      col1 = Math.max(col1, col);
      row0 = Math.min(row0, row);
      row1 = Math.max(row1, row);
    }
  }

  return {
    col0: Math.floor(col0) - 1,
    col1: Math.ceil(col1) + 1,
    row0: Math.floor(row0) - 1,
    row1: Math.ceil(row1) + 1
  };
}

export function listIsoCells(options: {
  origin: { x: number; y: number };
  lattice: IsoLattice;
  cell: Size;
  countX: number;
  countY: number;
  fillX: boolean;
  fillY: boolean;
  view: { minX: number; maxX: number; minY: number; maxY: number };
  maxTiles: number;
  maxPerAxis: number;
}): Array<{ col: number; row: number }> {
  const countX = Math.max(1, Math.floor(options.countX));
  const countY = Math.max(1, Math.floor(options.countY));
  const maxTiles = Math.max(1, options.maxTiles);
  const maxPerAxis = Math.max(1, options.maxPerAxis);

  let col0: number;
  let col1: number;
  let row0: number;
  let row1: number;

  if (!options.fillX && !options.fillY) {
    col0 = 0;
    col1 = Math.min(maxPerAxis, countX) - 1;
    row0 = 0;
    const colCount = col1 - col0 + 1;
    row1 = Math.min(countY, Math.max(1, Math.floor(maxTiles / colCount))) - 1;
  } else {
    const range = isoIndexRange(options);
    col0 = options.fillX ? range.col0 : 0;
    col1 = options.fillX ? range.col1 : countX - 1;
    row0 = options.fillY ? range.row0 : 0;
    row1 = options.fillY ? range.row1 : countY - 1;
  }

  if (col1 < col0) [col0, col1] = [col1, col0];
  if (row1 < row0) [row0, row1] = [row1, row0];
  if (col1 - col0 + 1 > maxPerAxis) col1 = col0 + maxPerAxis - 1;
  if (row1 - row0 + 1 > maxPerAxis) row1 = row0 + maxPerAxis - 1;

  const viewBox = {
    x: options.view.minX,
    y: options.view.minY,
    width: options.view.maxX - options.view.minX,
    height: options.view.maxY - options.view.minY
  };
  const cull = options.fillX || options.fillY;
  const cells: Array<{ col: number; row: number }> = [];

  for (let row = row0; row <= row1; row++) {
    for (let col = col0; col <= col1; col++) {
      if (cull) {
        const box = isoStampBox(col, row, options.origin, options.lattice, options.cell);
        if (!boxesOverlap(box, viewBox)) continue;
      }

      cells.push({ col, row });
      if (cells.length >= maxTiles) break;
    }

    if (cells.length >= maxTiles) break;
  }

  cells.sort((a, b) => a.col + a.row - (b.col + b.row) || a.col - b.col);
  return cells;
}

export function planIsoStamps(options: {
  origin: { x: number; y: number };
  cells: Array<{ col: number; row: number }>;
  cell: Size;
  marginX: number;
  marginY: number;
  seed: number;
  mixCount: number;
  rotate: RepeaterRotate;
  scaleJitter: number;
}): PlannedStamp[] {
  const mix = Math.max(1, Math.floor(options.mixCount));
  const lattice = isoLattice(options.cell, options.marginX, options.marginY);
  if (lattice.diamondW <= 0) return [];

  const stamps: PlannedStamp[] = [];
  const cells = [...options.cells].sort(
    (a, b) => a.col + a.row - (b.col + b.row) || a.col - b.col
  );

  for (const { col, row } of cells) {
    const random = mulberry32(
      (options.seed ^ Math.imul(col + 1, 0x9e3779b9) ^ Math.imul(row + 1, 0x85ebca6b)) >>> 0
    );
    const style = stampStyle(random, options.rotate, options.scaleJitter);
    const box = isoStampBox(col, row, options.origin, lattice, options.cell, style.scale);

    stamps.push({
      key: `${col}:${row}`,
      ...box,
      rotation: style.rotation,
      flipH: style.flipH,
      flipV: style.flipV,
      mixIndex: pickIndex(options.seed, col, row, mix)
    });
  }

  return stamps;
}

export function planGridStamps(options: {
  origin: { x: number; y: number };
  columns: number[];
  rows: number[];
  stepX: number;
  stepY: number;
  cell: Size;
  seed: number;
  mixCount: number;
  rotate: RepeaterRotate;
  scaleJitter: number;
}): PlannedStamp[] {
  const mix = Math.max(1, Math.floor(options.mixCount));
  const stamps: PlannedStamp[] = [];

  for (const row of options.rows) {
    for (const column of options.columns) {
      const random = mulberry32(
        (options.seed ^ Math.imul(column + 1, 0x9e3779b9) ^ Math.imul(row + 1, 0x85ebca6b)) >>> 0
      );
      const style = stampStyle(random, options.rotate, options.scaleJitter);
      const width = Math.max(1, options.cell.width * style.scale);
      const height = Math.max(1, options.cell.height * style.scale);
      const cellX = options.origin.x + column * options.stepX;
      const cellY = options.origin.y + row * options.stepY;

      stamps.push({
        key: `${column}:${row}`,
        x: cellX + (options.cell.width - width) / 2,
        y: cellY + (options.cell.height - height) / 2,
        width,
        height,
        rotation: style.rotation,
        flipH: style.flipH,
        flipV: style.flipV,
        mixIndex: pickIndex(options.seed, column, row, mix)
      });
    }
  }

  return stamps;
}

export function planScatterStamps(options: {
  origin: { x: number; y: number };
  area: Size;
  cell: Size;
  count: number;
  seed: number;
  mixCount: number;
  rotate: RepeaterRotate;
  scaleJitter: number;
  minGap: number;
  edgeBias: number;
}): PlannedStamp[] {
  const count = Math.max(0, Math.floor(options.count));
  const mix = Math.max(1, Math.floor(options.mixCount));
  const width = Math.max(1, options.area.width);
  const height = Math.max(1, options.area.height);
  const gap = Math.max(0, options.minGap);
  const random = mulberry32(options.seed);
  const stamps: PlannedStamp[] = [];
  const centers: Array<{ x: number; y: number }> = [];

  for (let index = 0; index < count; index++) {
    let placed: PlannedStamp | null = null;
    let center: { x: number; y: number } | null = null;

    for (let attempt = 0; attempt < 40; attempt++) {
      const style = stampStyle(random, options.rotate, options.scaleJitter);
      const cx =
        options.origin.x + towardEdge(random(), options.edgeBias) * width;
      const cy =
        options.origin.y + towardEdge(random(), options.edgeBias) * height;

      if (
        gap > 0 &&
        centers.some((entry) => {
          const dx = entry.x - cx;
          const dy = entry.y - cy;
          return dx * dx + dy * dy < gap * gap;
        })
      ) {
        continue;
      }

      placed = boxAt(
        { x: cx - (options.cell.width * style.scale) / 2, y: cy - (options.cell.height * style.scale) / 2 },
        options.cell,
        style.scale,
        style,
        Math.floor(random() * mix),
        String(index)
      );
      center = { x: cx, y: cy };
      break;
    }

    if (placed && center) {
      stamps.push(placed);
      centers.push(center);
    }
  }

  return stamps;
}

export function planRepeater(
  group: Pick<
    RepeatGroup,
    | "x"
    | "y"
    | "placement"
    | "rotate"
    | "seed"
    | "scaleJitter"
    | "scatterCount"
    | "areaWidth"
    | "areaHeight"
    | "minGap"
    | "edgeBias"
    | "marginX"
    | "marginY"
  >,
  cell: Size,
  mixCount: number,
  grid: {
    columns: number[];
    rows: number[];
    stepX: number;
    stepY: number;
    cells?: Array<{ col: number; row: number }>;
  }
): PlannedStamp[] {
  if (cell.width <= 0 || cell.height <= 0 || mixCount <= 0) return [];

  if (group.placement === "scatter") {
    return planScatterStamps({
      origin: { x: group.x, y: group.y },
      area: { width: group.areaWidth, height: group.areaHeight },
      cell,
      count: group.scatterCount,
      seed: group.seed,
      mixCount,
      rotate: group.rotate,
      scaleJitter: group.scaleJitter,
      minGap: group.minGap,
      edgeBias: group.edgeBias
    });
  }

  if (group.placement === "iso") {
    return planIsoStamps({
      origin: { x: group.x, y: group.y },
      cells: grid.cells ?? [],
      cell,
      marginX: group.marginX,
      marginY: group.marginY,
      seed: group.seed,
      mixCount,
      rotate: group.rotate,
      scaleJitter: group.scaleJitter
    });
  }

  return planGridStamps({
    origin: { x: group.x, y: group.y },
    columns: grid.columns,
    rows: grid.rows,
    stepX: grid.stepX,
    stepY: grid.stepY,
    cell,
    seed: group.seed,
    mixCount,
    rotate: group.rotate,
    scaleJitter: group.scaleJitter
  });
}
