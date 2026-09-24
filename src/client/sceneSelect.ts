import { repeaterScaleBox, rotateAbout, type Point } from "@/client/grid";
import type { Size } from "@/core/types";
import type { RepeatGroup } from "@/shared/model";

/** Pixels of pointer travel before a click becomes a drag or a marquee. */
export const DRAG_THRESHOLD_PX = 3;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SelectableItem {
  id: string;
  x: number;
  y: number;
  footprint: Size;
  rotation: number;
}

export type SelectableGroup = Pick<
  RepeatGroup,
  | "id"
  | "x"
  | "y"
  | "placement"
  | "cell"
  | "marginX"
  | "marginY"
  | "countX"
  | "countY"
    | "fillX"
    | "fillY"
    | "areaWidth"
    | "areaHeight"
  > & { isoPitch?: number };

export interface SceneSelection {
  itemIds: string[];
  groupIds: string[];
}

export const EMPTY_SELECTION: SceneSelection = { itemIds: [], groupIds: [] };

/**
 * Figma's temporary pan: middle mouse, Alt, or Space held.
 *
 * Left-drag without those is select / marquee, not pan.
 */
export function shouldPan(
  event: { button: number; altKey: boolean },
  spaceHeld: boolean
): boolean {
  return event.button === 1 || event.altKey || spaceHeld;
}

export function pastDragThreshold(
  dx: number,
  dy: number,
  threshold = DRAG_THRESHOLD_PX
): boolean {
  return dx * dx + dy * dy >= threshold * threshold;
}

export function toggleId(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((entry) => entry !== id) : [...ids, id];
}

export function rectFromPoints(a: Point, b: Point): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

export function pointInRect(point: Point, rect: Rect): boolean {
  return (
    point.x >= rect.x &&
    point.x < rect.x + rect.width &&
    point.y >= rect.y &&
    point.y < rect.y + rect.height
  );
}

/** Union AABB of the current selection, or null when nothing is selected. */
export function selectionBounds(items: SelectableItem[], groups: SelectableGroup[]): Rect | null {
  const boxes = [...items.map(itemBounds), ...groups.map(groupBounds)];
  if (boxes.length === 0) return null;

  const minX = Math.min(...boxes.map((box) => box.x));
  const minY = Math.min(...boxes.map((box) => box.y));
  const maxX = Math.max(...boxes.map((box) => box.x + box.width));
  const maxY = Math.max(...boxes.map((box) => box.y + box.height));

  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function selectionCount(selection: SceneSelection): number {
  return selection.itemIds.length + selection.groupIds.length;
}

export function selectionsEqual(a: SceneSelection, b: SceneSelection): boolean {
  return (
    a.itemIds.length === b.itemIds.length &&
    a.groupIds.length === b.groupIds.length &&
    a.itemIds.every((id, index) => id === b.itemIds[index]) &&
    a.groupIds.every((id, index) => id === b.groupIds[index])
  );
}

function unionIds(current: string[], extra: string[]): string[] {
  const seen = new Set(current);
  const next = [...current];
  for (const id of extra) {
    if (seen.has(id)) continue;
    seen.add(id);
    next.push(id);
  }
  return next;
}

/**
 * Axis-aligned box that covers the sprite, including its CSS rotation
 * around the footprint centre.
 */
export function itemBounds(item: SelectableItem): Rect {
  const width = Math.max(0, item.footprint.width);
  const height = Math.max(0, item.footprint.height);
  const box = { x: item.x, y: item.y, width, height };

  if (!Number.isFinite(item.rotation) || item.rotation % 360 === 0) return box;

  const center = { x: item.x + width / 2, y: item.y + height / 2 };
  const corners = [
    { x: item.x, y: item.y },
    { x: item.x + width, y: item.y },
    { x: item.x + width, y: item.y + height },
    { x: item.x, y: item.y + height }
  ].map((point) => rotateAbout(point, center, item.rotation));

  const xs = corners.map((point) => point.x);
  const ys = corners.map((point) => point.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);

  return { x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY };
}

/** Same rectangle the repeater's scale frame sits on. */
export function groupBounds(group: SelectableGroup): Rect {
  return repeaterScaleBox(group, {
    width: group.cell.width > 0 ? group.cell.width : 48,
    height: group.cell.height > 0 ? group.cell.height : 48
  });
}

export function hitsInMarquee(
  items: SelectableItem[],
  groups: SelectableGroup[],
  rect: Rect
): SceneSelection {
  const box = rectFromPoints(
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.height }
  );

  return {
    itemIds: items.filter((item) => rectsIntersect(itemBounds(item), box)).map((item) => item.id),
    groupIds: groups.filter((group) => rectsIntersect(groupBounds(group), box)).map((group) => group.id)
  };
}

export function idsInMarquee(items: SelectableItem[], rect: Rect): string[] {
  return hitsInMarquee(items, [], rect).itemIds;
}

function hasTarget(selection: SceneSelection, kind: "item" | "group", id: string): boolean {
  return kind === "item" ? selection.itemIds.includes(id) : selection.groupIds.includes(id);
}

/** Pointer down on a sprite or repeater: replace, keep (so a drag can move the set), or toggle. */
export function selectionOnTargetDown(
  current: SceneSelection,
  kind: "item" | "group",
  clicked: string,
  shift: boolean
): SceneSelection {
  if (shift) {
    return kind === "item"
      ? { ...current, itemIds: toggleId(current.itemIds, clicked) }
      : { ...current, groupIds: toggleId(current.groupIds, clicked) };
  }

  if (hasTarget(current, kind, clicked)) return current;
  return kind === "item"
    ? { itemIds: [clicked], groupIds: [] }
    : { itemIds: [], groupIds: [clicked] };
}

/**
 * Pointer up with no drag. Figma collapses a multi-select to the one you
 * clicked, unless Shift held the toggle from pointerdown.
 */
export function selectionOnTargetClick(
  current: SceneSelection,
  kind: "item" | "group",
  clicked: string,
  shift: boolean
): SceneSelection {
  if (shift) return current;
  if (selectionCount(current) > 1 && hasTarget(current, kind, clicked)) {
    return kind === "item"
      ? { itemIds: [clicked], groupIds: [] }
      : { itemIds: [], groupIds: [clicked] };
  }
  return current;
}

/** Pointer down on a sprite: replace, keep (so a drag can move the set), or toggle. */
export function selectionOnItemDown(current: string[], clicked: string, shift: boolean): string[] {
  return selectionOnTargetDown({ itemIds: current, groupIds: [] }, "item", clicked, shift).itemIds;
}

/**
 * Pointer up on a sprite with no drag. Figma collapses a multi-select to the
 * one you clicked, unless Shift held the toggle from pointerdown.
 */
export function selectionOnItemClick(current: string[], clicked: string, shift: boolean): string[] {
  return selectionOnTargetClick({ itemIds: current, groupIds: [] }, "item", clicked, shift).itemIds;
}

/**
 * Marquee membership from a pointer-down snapshot plus the current box.
 *
 * Replace is exactly the current hits, so shrinking the box drops things.
 * Shift unions hits onto the snapshot, so shrinking only drops what the box
 * added — not what was already selected.
 */
export function selectionOnMarquee(
  baseline: SceneSelection,
  hit: SceneSelection,
  additive: boolean
): SceneSelection {
  if (!additive) return hit;
  return {
    itemIds: unionIds(baseline.itemIds, hit.itemIds),
    groupIds: unionIds(baseline.groupIds, hit.groupIds)
  };
}
