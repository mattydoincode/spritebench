import { describe, expect, it } from "vitest";
import { grabAt, grabCursor, moveBox, resizeBox } from "@/shared/cropBox";

const box = { x: 10, y: 10, width: 40, height: 20 };
const image = { width: 100, height: 60 };

describe("grabAt", () => {
  it("draws a new box with no box, or outside it", () => {
    expect(grabAt(null, { x: 20, y: 20 }, 2).mode).toBe("draw");
    expect(grabAt(box, { x: 80, y: 50 }, 2).mode).toBe("draw");
  });

  it("moves from inside, resizes from an edge or corner", () => {
    expect(grabAt(box, { x: 30, y: 20 }, 2).mode).toBe("move");

    const left = grabAt(box, { x: 11, y: 20 }, 2);
    expect(left).toEqual({ mode: "resize", edges: { left: true, right: false, top: false, bottom: false } });

    const corner = grabAt(box, { x: 49, y: 31 }, 2);
    expect(corner).toEqual({ mode: "resize", edges: { left: false, right: true, top: false, bottom: true } });
  });

  it("picks the nearer edge when a small box's margins overlap", () => {
    const tiny = { x: 10, y: 10, width: 2, height: 2 };
    const grab = grabAt(tiny, { x: 12.5, y: 11 }, 3);
    expect(grab.mode === "resize" && grab.edges.right && !grab.edges.left).toBe(true);
  });
});

describe("grabCursor", () => {
  it("names the cursor for each grab", () => {
    expect(grabCursor({ mode: "draw" })).toBe("crosshair");
    expect(grabCursor({ mode: "move" })).toBe("move");
    expect(grabCursor({ mode: "resize", edges: { left: true, right: false, top: true, bottom: false } })).toBe("nwse-resize");
    expect(grabCursor({ mode: "resize", edges: { left: false, right: true, top: true, bottom: false } })).toBe("nesw-resize");
    expect(grabCursor({ mode: "resize", edges: { left: false, right: false, top: false, bottom: true } })).toBe("ns-resize");
  });
});

describe("moveBox", () => {
  it("moves without changing size, and stops at the image's edges", () => {
    expect(moveBox(box, 5, 3, image)).toEqual({ x: 15, y: 13, width: 40, height: 20 });
    expect(moveBox(box, 500, -500, image)).toEqual({ x: 60, y: 0, width: 40, height: 20 });
  });
});

describe("resizeBox", () => {
  it("moves only the grabbed edges", () => {
    const edges = { left: false, right: true, top: false, bottom: true };
    expect(resizeBox(box, edges, { x: 70, y: 40 })).toEqual({ x: 10, y: 10, width: 60, height: 30 });
  });

  it("flips rather than collapsing when dragged past the opposite edge", () => {
    const edges = { left: true, right: false, top: false, bottom: false };
    expect(resizeBox(box, edges, { x: 60, y: 0 })).toEqual({ x: 50, y: 10, width: 10, height: 20 });
  });
});
