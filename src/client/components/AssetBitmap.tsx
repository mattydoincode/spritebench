"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { processor, type ProcessedPreview, type SourceVariant } from "@/client/processor";
import { previewFrameSettings } from "@/client/sequence";
import { EMPTY_PALETTE, useServer } from "@/client/stores/server";
import type { ProcessingSettings } from "@/core/settings";
import type { Rgb } from "@/core/types";
import type { ResolvedAsset } from "@/shared/model";

interface PreviewState {
  preview: ProcessedPreview | null;
  error: string | null;
  loading: boolean;
}

export function useAssetPalette(asset: ResolvedAsset | null): Rgb[] {
  const paletteId = asset?.processing.paletteId ?? "";
  const colors = useServer((state) => (paletteId ? state.paletteColors[paletteId] : undefined));

  useEffect(() => {
    if (paletteId && !colors) void useServer.getState().ensurePalette(paletteId);
  }, [paletteId, colors]);

  return colors ?? EMPTY_PALETTE;
}

/**
 * Runs the pipeline over an asset and hands back the bitmap.
 *
 * `override` exists for animation frames, which are the asset's own settings
 * with the frame's rectangle pushed onto the front of the edit list. Because
 * the processor's cache key is a hash of the settings, each frame gets its own
 * entry for free and the worker decodes the sheet once for all of them.
 */
export function useProcessed(
  asset: ResolvedAsset | null,
  palette: Rgb[],
  wantSource = false,
  variant: SourceVariant = "source",
  override?: ProcessingSettings,
  sourceAssetId?: string
): PreviewState {
  const projectId = useServer((state) => state.project?.id ?? null);

  const [state, setState] = useState<PreviewState>({
    preview: null,
    error: null,
    loading: false
  });

  // Falls back to the thumbnail once the full-resolution source has rolled off,
  // so the library keeps rendering even though the original is gone.
  const processId = sourceAssetId || asset?.id || "";
  const effective: SourceVariant = asset?.hasSource === false ? "thumb" : variant;
  const settings = override ?? asset?.processing ?? null;

  const cacheKey = useMemo(
    () =>
      asset && settings && processId
        ? processor.cacheKeyFor(processId, settings, palette.length, effective)
        : "",
    [asset, settings, palette.length, effective, processId]
  );

  useEffect(() => {
    if (!asset || !projectId || !settings || !processId) {
      setState({ preview: null, error: null, loading: false });
      return;
    }

    const cached = processor.peek(cacheKey);
    if (cached && (!wantSource || cached.sourceBitmap)) {
      setState({ preview: cached, error: null, loading: false });
      return;
    }

    let cancelled = false;
    setState((previous) => ({ ...previous, loading: true }));

    processor
      .process(projectId, processId, settings, palette, wantSource, effective)
      .then((preview) => {
        if (!cancelled) setState({ preview, error: null, loading: false });
      })
      .catch((error: Error) => {
        if (!cancelled) setState({ preview: null, error: error.message, loading: false });
      });

    return () => {
      cancelled = true;
    };
    // `settings` is covered by `cacheKey`, which is a hash of it. Depending on
    // the object as well would refetch on every render for a caller that
    // builds its override inline.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asset, projectId, cacheKey, palette, wantSource, effective]);

  return state;
}

export function BitmapCanvas({
  bitmap,
  width,
  height,
  pixelated = true,
  showAlpha = false,
  overlay = null,
  overlayOpacity = 0.5,
  className = "",
  style
}: {
  bitmap: ImageBitmap | null | undefined;
  width: number;
  height: number;
  pixelated?: boolean;
  showAlpha?: boolean;
  overlay?: ImageBitmap | null;
  overlayOpacity?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !bitmap || width <= 0 || height <= 0) return;

    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d", { willReadFrequently: showAlpha });
    if (!context) return;

    context.clearRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0);

    if (showAlpha) {
      const frame = context.getImageData(0, 0, width, height);
      for (let i = 0; i < frame.data.length; i += 4) {
        const alpha = frame.data[i + 3];
        frame.data[i] = alpha;
        frame.data[i + 1] = alpha;
        frame.data[i + 2] = alpha;
        frame.data[i + 3] = 255;
      }
      context.putImageData(frame, 0, 0);
    }

    if (overlay) {
      context.save();
      context.globalAlpha = overlayOpacity;
      context.drawImage(overlay, 0, 0, width, height);
      context.restore();
    }
  }, [bitmap, width, height, showAlpha, overlay, overlayOpacity]);

  return (
    <canvas
      ref={ref}
      className={className}
      style={{ imageRendering: pixelated ? "pixelated" : "auto", ...style }}
    />
  );
}

export function AssetThumb({ asset, size = 96 }: { asset: ResolvedAsset; size?: number }) {
  const palette = useAssetPalette(asset);
  // Runs the pipeline over the small stored preview rather than the source.
  // The result is indistinguishable at this size and costs a few KB.
  const { preview, error, loading } = useProcessed(
    asset,
    palette,
    false,
    "thumb",
    asset.set ? undefined : previewFrameSettings(asset, "thumb")
  );

  const frameCount = asset.sequences.find((entry) => entry.frames.length > 0)?.frames.length ?? 0;

  if (error) {
    return (
      <div
        className="flex items-center justify-center rounded bg-[#3a1e26] p-1 text-center text-[9px] leading-tight text-rose-300"
        style={{ width: size, height: size }}
      >
        {error}
      </div>
    );
  }

  if (!preview) {
    return (
      <div
        className="checkerboard flex items-center justify-center rounded text-[10px] text-slate-500"
        style={{ width: size, height: size }}
      >
        {loading ? "..." : ""}
      </div>
    );
  }

  const scale = Math.min(size / preview.width, size / preview.height);

  return (
    <div
      className="checkerboard relative flex items-center justify-center overflow-hidden rounded"
      style={{ width: size, height: size }}
    >
      <BitmapCanvas
        bitmap={preview.processed}
        width={preview.width}
        height={preview.height}
        pixelated={scale >= 1}
        style={{
          width: Math.max(1, Math.round(preview.width * scale)),
          height: Math.max(1, Math.round(preview.height * scale))
        }}
      />

      {frameCount > 0 ? (
        <span
          className="pointer-events-none absolute bottom-0.5 right-0.5 rounded bg-black/70 px-1 text-[9px] leading-tight text-amber-300"
          title={`${frameCount} frame animation, showing frame 1`}
        >
          {frameCount}f
        </span>
      ) : null}
    </div>
  );
}
