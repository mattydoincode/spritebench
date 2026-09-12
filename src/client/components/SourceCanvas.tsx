"use client";

import { useEffect, useRef, useState } from "react";
import { sourceUrl } from "@/client/api";
import type { RgbaImage } from "@/core/types";

/**
 * The raw generated PNG, decoded in the page rather than in the processing
 * worker.
 *
 * Both the crop tool and the slicer work in raw source coordinates -- what you
 * drag a box over has to be the untouched image, or the rectangle you get back
 * means something different from the rectangle you drew.
 */
export async function loadSource(url: string): Promise<RgbaImage> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`could not load the source image (${response.status})`);

  const bitmap = await createImageBitmap(await response.blob());
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;

  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("no 2d canvas context available");

  context.drawImage(bitmap, 0, 0);
  bitmap.close();

  const frame = context.getImageData(0, 0, canvas.width, canvas.height);
  return { width: frame.width, height: frame.height, data: frame.data };
}

/**
 * Whole-number zoom when magnifying, so individual pixels stay square and a
 * grid line drawn at pixel 40 sits exactly on pixel 40.
 */
export function fitScale(image: RgbaImage, viewWidth: number, viewHeight: number): number {
  const raw = Math.min(viewWidth / image.width, viewHeight / image.height);
  return raw >= 1 ? Math.floor(raw) : raw;
}

export function ImageCanvas({ image, scale }: { image: RgbaImage; scale: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;

    canvas.width = image.width;
    canvas.height = image.height;

    const context = canvas.getContext("2d");
    if (!context) return;

    context.clearRect(0, 0, image.width, image.height);
    context.putImageData(new ImageData(image.data, image.width, image.height), 0, 0);
  }, [image]);

  return (
    <canvas
      ref={ref}
      className="pointer-events-none block"
      style={{
        width: image.width * scale,
        height: image.height * scale,
        imageRendering: scale >= 1 ? "pixelated" : "auto"
      }}
    />
  );
}

export interface SourceState {
  source: RgbaImage | null;
  error: string | null;
}

/** Fetches and decodes an asset's raw PNG, refetching when the asset changes. */
export function useSource(projectId: string | null, assetId: string | null): SourceState {
  const [state, setState] = useState<SourceState>({ source: null, error: null });

  useEffect(() => {
    if (!assetId || !projectId) {
      setState({ source: null, error: null });
      return;
    }

    let cancelled = false;
    setState({ source: null, error: null });

    loadSource(sourceUrl(projectId, assetId, "source"))
      .then((image) => {
        if (!cancelled) setState({ source: image, error: null });
      })
      .catch((reason: Error) => {
        if (!cancelled) setState({ source: null, error: reason.message });
      });

    return () => {
      cancelled = true;
    };
  }, [assetId, projectId]);

  return state;
}
