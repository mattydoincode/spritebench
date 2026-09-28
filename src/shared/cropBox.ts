/**
 * The crop tool's box, once drawn: grab inside to move it, an edge or corner
 * to resize it, anywhere else to draw a new one. Everything is in image
 * pixels; the caller converts the pointer and scales the grab margin.
 */

export interface CropBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Edges {
  left: boolean;
  right: boolean;
  top: boolean;
  bottom: boolean;
}

export type CropGrab =
  | { mode: "draw" }
  | { mode: "move" }
  | { mode: "resize"; edges: Edges };

/** What a press at `point` would do to `box`. `margin` is how near an edge counts as on it. */
export function grabAt(
  box: CropBox | null,
  point: { x: number; y: number },
  margin: number
): CropGrab {
  if (!box || box.width <= 0 || box.height <= 0) return { mode: "draw" };

  const right = box.x + box.width;
  const bottom = box.y + box.height;
  const withinX = point.x >= box.x - margin && point.x <= right + margin;
  const withinY = point.y >= box.y - margin && point.y <= bottom + margin;
  if (!withinX || !withinY) return { mode: "draw" };

  // On a small box the two margins overlap; the nearer edge wins.
  const nearLeft = Math.abs(point.x - box.x) <= margin;
  const nearRight = Math.abs(point.x - right) <= margin;
  const nearTop = Math.abs(point.y - box.y) <= margin;
  const nearBottom = Math.abs(point.y - bottom) <= margin;
  const edges: Edges = {
    left: nearLeft && (!nearRight || Math.abs(point.x - box.x) <= Math.abs(point.x - right)),
    right: nearRight && (!nearLeft || Math.abs(point.x - right) < Math.abs(point.x - box.x)),
    top: nearTop && (!nearBottom || Math.abs(point.y - box.y) <= Math.abs(point.y - bottom)),
    bottom: nearBottom && (!nearTop || Math.abs(point.y - bottom) < Math.abs(point.y - box.y))
  };

  if (edges.left || edges.right || edges.top || edges.bottom) return { mode: "resize", edges };
  return { mode: "move" };
}

/** The CSS cursor for a grab. */
export function grabCursor(grab: CropGrab): string {
  if (grab.mode === "draw") return "crosshair";
  if (grab.mode === "move") return "move";

  const { left, right, top, bottom } = grab.edges;
  if ((left && top) || (right && bottom)) return "nwse-resize";
  if ((right && top) || (left && bottom)) return "nesw-resize";
  return left || right ? "ew-resize" : "ns-resize";
}

/** The box moved by (dx, dy), kept inside the image. */
export function moveBox(
  box: CropBox,
  dx: number,
  dy: number,
  image: { width: number; height: number }
): CropBox {
  return {
    ...box,
    x: Math.max(0, Math.min(image.width - box.width, Math.round(box.x + dx))),
    y: Math.max(0, Math.min(image.height - box.height, Math.round(box.y + dy)))
  };
}

/**
 * The box with the grabbed edges moved to `point` (already clamped to the
 * image). Dragging an edge past its opposite flips the box rather than
 * collapsing it.
 */
export function resizeBox(box: CropBox, edges: Edges, point: { x: number; y: number }): CropBox {
  let x1 = box.x;
  let y1 = box.y;
  let x2 = box.x + box.width;
  let y2 = box.y + box.height;

  if (edges.left) x1 = point.x;
  if (edges.right) x2 = point.x;
  if (edges.top) y1 = point.y;
  if (edges.bottom) y2 = point.y;

  return {
    x: Math.round(Math.min(x1, x2)),
    y: Math.round(Math.min(y1, y2)),
    width: Math.max(1, Math.round(Math.abs(x2 - x1))),
    height: Math.max(1, Math.round(Math.abs(y2 - y1)))
  };
}
