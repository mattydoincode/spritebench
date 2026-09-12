"use client";

import { useEffect, useState } from "react";
import { sourceUrl } from "@/client/api";
import { layoutPlateForJob, overlayPlateForView } from "@/core/layoutPlate";
import { isLayoutGuideTemplate } from "@/core/pixelMask";
import type { RgbaImage } from "@/core/types";
import type { ResolvedAsset } from "@/shared/model";

export function hasMaskOverlay(asset: ResolvedAsset | null): boolean {
  if (!asset) return false;
  if (asset.processing.edits.some((entry) => entry.kind === "pixelGrid")) return true;
  return Boolean(asset.inputs?.mask);
}

async function bitmapFromRgba(image: RgbaImage): Promise<ImageBitmap> {
  return createImageBitmap(new ImageData(image.data, image.width, image.height));
}

async function loadCustomPlate(projectId: string, asset: ResolvedAsset): Promise<ImageBitmap | null> {
  const source = asset.inputs?.mask?.source;
  if (!source) return null;

  const url =
    source.kind === "template" && !isLayoutGuideTemplate(source.templateId)
      ? `/api/projects/${projectId}/templates/file?id=${encodeURIComponent(source.templateId)}`
      : source.kind === "asset"
        ? sourceUrl(projectId, source.assetId, "source")
        : null;

  if (!url) return null;

  const response = await fetch(url);
  if (!response.ok) return null;
  return createImageBitmap(await response.blob());
}

export function useMaskOverlay(
  asset: ResolvedAsset | null,
  projectId: string | null,
  view: "source" | "processed"
): { bitmap: ImageBitmap | null; available: boolean } {
  const available = hasMaskOverlay(asset);
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);

  useEffect(() => {
    if (!asset || !projectId || !available) {
      setBitmap(null);
      return;
    }

    let cancelled = false;
    const plate = layoutPlateForJob({
      mask: asset.inputs?.mask ?? null,
      edits: asset.processing.edits,
      sourceSize: { width: asset.sourceWidth, height: asset.sourceHeight },
      targetSize: asset.processing.targetSize
    });

    const next = plate
      ? bitmapFromRgba(overlayPlateForView(plate, asset.processing.edits, view))
      : loadCustomPlate(projectId, asset);

    next
      .then((loaded) => {
        if (!cancelled) setBitmap(loaded);
      })
      .catch(() => {
        if (!cancelled) setBitmap(null);
      });

    return () => {
      cancelled = true;
    };
  }, [asset, projectId, view, available]);

  return { bitmap, available };
}
