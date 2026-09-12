import type { Size } from "./types";

/**
 * Camera for a boxed image view: zoom around a point, pan in screen pixels.
 *
 * Kept out of the React surface so the slicer and the crop tool share one
 * definition of "the pixel under the pointer", and so a test can check that
 * zooming does not walk the image out from under the cursor.
 */

export interface ViewCamera {
  zoom: number;
  /** Image origin, in viewport pixels. */
  panX: number;
  panY: number;
}

export const MIN_VIEW_ZOOM = 0.1;
export const MAX_VIEW_ZOOM = 64;

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(MAX_VIEW_ZOOM, Math.max(MIN_VIEW_ZOOM, zoom));
}

/**
 * Centre the image in the view, scaled to fit.
 *
 * Whole-number zoom when magnifying, same reason as `fitScale`: a 3.7x
 * pixel art preview makes grid lines sit between CSS pixels.
 */
export function fitCamera(image: Size, view: Size): ViewCamera {
  const width = Math.max(1, image.width);
  const height = Math.max(1, image.height);
  const raw = Math.min(view.width / width, view.height / height);
  const zoom = raw >= 1 ? Math.max(1, Math.floor(raw)) : Math.max(MIN_VIEW_ZOOM, raw);

  return {
    zoom,
    panX: (view.width - width * zoom) / 2,
    panY: (view.height - height * zoom) / 2
  };
}

/** 1:1, centred. The image may hang off the view; that is what pan is for. */
export function actualSizeCamera(image: Size, view: Size): ViewCamera {
  return {
    zoom: 1,
    panX: (view.width - image.width) / 2,
    panY: (view.height - image.height) / 2
  };
}

export function viewToImage(
  camera: ViewCamera,
  viewX: number,
  viewY: number
): { x: number; y: number } {
  return {
    x: (viewX - camera.panX) / camera.zoom,
    y: (viewY - camera.panY) / camera.zoom
  };
}

export function imageToView(
  camera: ViewCamera,
  imageX: number,
  imageY: number
): { x: number; y: number } {
  return {
    x: imageX * camera.zoom + camera.panX,
    y: imageY * camera.zoom + camera.panY
  };
}

/**
 * Zoom so the image point currently under `(viewX, viewY)` stays there.
 */
export function zoomAt(
  camera: ViewCamera,
  viewX: number,
  viewY: number,
  factor: number
): ViewCamera {
  const point = viewToImage(camera, viewX, viewY);
  const zoom = clampZoom(camera.zoom * factor);

  return {
    zoom,
    panX: viewX - point.x * zoom,
    panY: viewY - point.y * zoom
  };
}

export function panCamera(camera: ViewCamera, dx: number, dy: number): ViewCamera {
  return { ...camera, panX: camera.panX + dx, panY: camera.panY + dy };
}
