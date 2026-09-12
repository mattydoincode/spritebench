import { describe, expect, it } from "vitest";
import {
  actualSizeCamera,
  fitCamera,
  imageToView,
  panCamera,
  viewToImage,
  zoomAt
} from "@/core/viewport";

const image = { width: 200, height: 100 };
const view = { width: 400, height: 300 };

describe("fitCamera", () => {
  it("centres a smaller image at a whole-number zoom", () => {
    const camera = fitCamera(image, view);

    expect(camera.zoom).toBe(2);
    expect(viewToImage(camera, 200, 150)).toEqual({ x: 100, y: 50 });
  });

  it("shrinks a larger image to fit", () => {
    const camera = fitCamera({ width: 800, height: 800 }, { width: 200, height: 100 });

    expect(camera.zoom).toBe(0.125);
    expect(camera.panX).toBe(50);
    expect(camera.panY).toBe(0);
  });
});

describe("actualSizeCamera", () => {
  it("is 1:1 and centred", () => {
    const camera = actualSizeCamera(image, view);

    expect(camera.zoom).toBe(1);
    expect(viewToImage(camera, 200, 150)).toEqual({ x: 100, y: 50 });
  });
});

describe("zoomAt", () => {
  it("keeps the image point under the cursor still", () => {
    const camera = fitCamera(image, view);
    const pointer = { x: 240, y: 180 };
    const before = viewToImage(camera, pointer.x, pointer.y);

    const zoomed = zoomAt(camera, pointer.x, pointer.y, 2);
    const after = viewToImage(zoomed, pointer.x, pointer.y);

    expect(zoomed.zoom).toBe(4);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });
});

describe("panCamera", () => {
  it("is a screen-pixel translation", () => {
    const camera = { zoom: 2, panX: 10, panY: 20 };

    expect(panCamera(camera, 5, -8)).toEqual({ zoom: 2, panX: 15, panY: 12 });
  });
});

describe("imageToView", () => {
  it("is the inverse of viewToImage", () => {
    const camera = { zoom: 3, panX: 12, panY: -4 };
    const screen = imageToView(camera, 40, 10);

    expect(viewToImage(camera, screen.x, screen.y)).toEqual({ x: 40, y: 10 });
  });
});
