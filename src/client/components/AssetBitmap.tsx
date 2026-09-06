"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { processor, type ProcessedPreview, type SourceVariant } from "@/client/processor";
import { EMPTY_PALETTE, useStudio } from "@/client/store";
import type { Rgb } from "@/core/types";
import type { AssetRecord } from "@/shared/model";

interface PreviewState {
  preview: ProcessedPreview | null;
  error: string | null;
  loading: boolean;
}

export function useAssetPalette(asset: AssetRecord | null): Rgb[] {
  const file = asset?.processing.paletteFile ?? "";
  const colors = useStudio((state) => (file ? state.paletteColors[file] : undefined));

  useEffect(() => {
    if (file && !colors) void useStudio.getState().ensurePalette(file);
  }, [file, colors]);

  return colors ?? EMPTY_PALETTE;
}

export function useProcessed(
  asset: AssetRecord | null,
  palette: Rgb[],
  wantSource = false,
  variant: SourceVariant = "source"
): PreviewState {
  const [state, setState] = useState<PreviewState>({
    preview: null,
    error: null,
    loading: false
  });

  // Falls back to the thumbnail once the full-resolution source has rolled off,
  // so the library keeps rendering even though the original is gone.
  const effective: SourceVariant = asset?.hasSource === false ? "thumb" : variant;

  const cacheKey = useMemo(
    () =>
      asset ? processor.cacheKeyFor(asset.id, asset.processing, palette.length, effective) : "",
    [asset, palette.length, effective]
  );

  useEffect(() => {
    if (!asset) {
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
      .process(asset.id, asset.processing, palette, wantSource, effective)
      .then((preview) => {
        if (!cancelled) setState({ preview, error: null, loading: false });
      })
      .catch((error: Error) => {
        if (!cancelled) setState({ preview: null, error: error.message, loading: false });
      });

    return () => {
      cancelled = true;
    };
  }, [asset, cacheKey, palette, wantSource, effective]);

  return state;
}

export function BitmapCanvas({
  bitmap,
  width,
  height,
  pixelated = true,
  showAlpha = false,
  className = "",
  style
}: {
  bitmap: ImageBitmap | null | undefined;
  width: number;
  height: number;
  pixelated?: boolean;
  showAlpha?: boolean;
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

    if (!showAlpha) return;

    const frame = context.getImageData(0, 0, width, height);
    for (let i = 0; i < frame.data.length; i += 4) {
      const alpha = frame.data[i + 3];
      frame.data[i] = alpha;
      frame.data[i + 1] = alpha;
      frame.data[i + 2] = alpha;
      frame.data[i + 3] = 255;
    }
    context.putImageData(frame, 0, 0);
  }, [bitmap, width, height, showAlpha]);

  return (
    <canvas
      ref={ref}
      className={className}
      style={{ imageRendering: pixelated ? "pixelated" : "auto", ...style }}
    />
  );
}

export function AssetThumb({ asset, size = 96 }: { asset: AssetRecord; size?: number }) {
  const palette = useAssetPalette(asset);
  // Runs the pipeline over the small stored preview rather than the source.
  // The result is indistinguishable at this size and costs a few KB.
  const { preview, error, loading } = useProcessed(asset, palette, false, "thumb");

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
      className="checkerboard flex items-center justify-center overflow-hidden rounded"
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
    </div>
  );
}
