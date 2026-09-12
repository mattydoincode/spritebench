"use client";

import { useEffect, useRef, type PointerEvent, type ReactNode } from "react";
import {
  actualSizeCamera,
  fitCamera,
  panCamera,
  zoomAt,
  type ViewCamera
} from "@/core/viewport";
import type { RgbaImage } from "@/core/types";
import { ImageCanvas } from "./SourceCanvas";
import { Button, Row } from "./ui";

/**
 * A boxed image you can zoom and pan, the way the scene works.
 *
 * Children sit in image-pixel space (`left: x * zoom`) on top of the bitmap.
 * Wheel zooms toward the cursor. Space, Alt, or the middle button pan; pass
 * `panOnBackground` to also pan with a plain left-drag on empty pixels.
 */

export function viewPoint(
  viewport: HTMLElement,
  camera: ViewCamera,
  clientX: number,
  clientY: number
): { viewX: number; viewY: number; imageX: number; imageY: number } {
  const bounds = viewport.getBoundingClientRect();
  const viewX = clientX - bounds.left;
  const viewY = clientY - bounds.top;

  return {
    viewX,
    viewY,
    imageX: (viewX - camera.panX) / camera.zoom,
    imageY: (viewY - camera.panY) / camera.zoom
  };
}

function shouldPan(event: PointerEvent, spaceHeld: boolean): boolean {
  return event.button === 1 || event.altKey || spaceHeld;
}

export function ImageViewport({
  image,
  width,
  height,
  camera,
  onCameraChange,
  children,
  panOnBackground = false,
  cursor,
  viewportRef,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel
}: {
  image: RgbaImage;
  width: number;
  height: number;
  camera: ViewCamera;
  onCameraChange: (camera: ViewCamera) => void;
  children?: ReactNode;
  /** Left-drag on empty pixels pans, like dragging the scene background. */
  panOnBackground?: boolean;
  cursor?: string;
  viewportRef?: { current: HTMLDivElement | null };
  onPointerDown?: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerMove?: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerUp?: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerCancel?: (event: PointerEvent<HTMLDivElement>) => void;
}) {
  const innerRef = useRef<HTMLDivElement | null>(null);
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const spaceHeld = useRef(false);
  const panRef = useRef<{ startX: number; startY: number; origin: ViewCamera } | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space") return;
      spaceHeld.current = true;
      if (
        !(event.target instanceof HTMLInputElement) &&
        !(event.target instanceof HTMLTextAreaElement)
      ) {
        event.preventDefault();
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") spaceHeld.current = false;
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  const setViewport = (node: HTMLDivElement | null) => {
    innerRef.current = node;
    if (viewportRef) viewportRef.current = node;
  };

  useEffect(() => {
    const node = innerRef.current;
    if (!node) return;

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();

      const bounds = node.getBoundingClientRect();
      const factor = Math.exp(-event.deltaY * 0.0015);
      onCameraChange(zoomAt(cameraRef.current, event.clientX - bounds.left, event.clientY - bounds.top, factor));
    };

    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, [onCameraChange]);

  const startPan = (event: PointerEvent<HTMLDivElement>) => {
    panRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      origin: cameraRef.current
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  return (
    <div
      ref={setViewport}
      className="checkerboard relative overflow-hidden rounded"
      style={{ width, height, touchAction: "none", cursor: cursor ?? (panOnBackground ? "grab" : "default") }}
      onPointerDown={(event) => {
        const background = event.target === event.currentTarget;
        if (shouldPan(event, spaceHeld.current) || (panOnBackground && background)) {
          event.preventDefault();
          startPan(event);
          return;
        }
        onPointerDown?.(event);
      }}
      onPointerMove={(event) => {
        const pan = panRef.current;
        if (pan) {
          onCameraChange(
            panCamera(pan.origin, event.clientX - pan.startX, event.clientY - pan.startY)
          );
          return;
        }
        onPointerMove?.(event);
      }}
      onPointerUp={(event) => {
        if (panRef.current) {
          panRef.current = null;
          return;
        }
        onPointerUp?.(event);
      }}
      onPointerCancel={(event) => {
        panRef.current = null;
        onPointerCancel?.(event);
      }}
    >
      <div
        className="pointer-events-none absolute left-0 top-0"
        style={{ transform: `translate(${camera.panX}px, ${camera.panY}px)` }}
      >
        <div className="relative">
          <ImageCanvas image={image} scale={camera.zoom} />
          {children}
        </div>
      </div>
    </div>
  );
}

export function ViewControls({
  image,
  view,
  camera,
  onCameraChange
}: {
  image: { width: number; height: number };
  view: { width: number; height: number };
  camera: ViewCamera;
  onCameraChange: (camera: ViewCamera) => void;
}) {
  const label = camera.zoom >= 1 ? `${camera.zoom.toFixed(2)}x` : `${Math.round(camera.zoom * 100)}%`;

  return (
    <Row className="mt-2">
      <Button title="Zoom out" onClick={() => onCameraChange(zoomAt(camera, view.width / 2, view.height / 2, 0.5))}>
        −
      </Button>
      <Button title="Fit the image in the view" onClick={() => onCameraChange(fitCamera(image, view))}>
        fit
      </Button>
      <Button title="Actual size" onClick={() => onCameraChange(actualSizeCamera(image, view))}>
        1:1
      </Button>
      <Button title="Zoom in" onClick={() => onCameraChange(zoomAt(camera, view.width / 2, view.height / 2, 2))}>
        +
      </Button>
      <span className="text-[10px] tabular-nums text-slate-500">{label}</span>
    </Row>
  );
}
