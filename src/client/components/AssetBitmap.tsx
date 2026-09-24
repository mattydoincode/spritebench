"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  PROCESS_DEBOUNCE_MS,
  previewAfterKeyChange,
  shouldDebounceProcess
} from "@/client/processPreview";
import {
  bitmapLive,
  isProcessCancelled,
  previewUsable,
  processor,
  PROCESS_PRIORITY,
  type ProcessedPreview,
  type SourceVariant
} from "@/client/processor";
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
  sourceAssetId?: string,
  priority: number = PROCESS_PRIORITY.background,
  enabled = true
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
        ? processor.cacheKeyFor(processId, settings, palette, effective)
        : "",
    [asset, settings, palette, effective, processId]
  );

  const detached = Boolean(state.preview && !previewUsable(state.preview, wantSource));
  const stateRef = useRef(state);
  stateRef.current = state;
  const keyRef = useRef("");
  const assetRef = useRef("");

  useEffect(() => {
    if (!asset || !projectId || !settings || !processId) {
      keyRef.current = "";
      assetRef.current = "";
      setState({ preview: null, error: null, loading: false });
      return;
    }

    if (!enabled) return;

    const previousKey = keyRef.current;
    if (previousKey && previousKey !== cacheKey) processor.cancel(previousKey);
    keyRef.current = cacheKey;

    const assetChanged = assetRef.current !== processId;
    assetRef.current = processId;

    let cancelled = false;
    let timer = 0;

    const apply = (preview: ProcessedPreview) => {
      if (cancelled || !previewUsable(preview, wantSource)) return;
      setState({ preview, error: null, loading: false });
    };

    const cached = processor.peek(cacheKey);
    const peeked = cached && previewUsable(cached, wantSource) ? cached : null;
    const lastGood = previewUsable(stateRef.current.preview, wantSource)
      ? stateRef.current.preview
      : null;
    const next = previewAfterKeyChange({
      previous: lastGood,
      nextPeek: peeked,
      assetChanged
    });

    setState({ preview: next.preview, error: null, loading: next.loading });

    if (!peeked) {
      const start = () => {
        processor
          .process(
            projectId,
            processId,
            settings,
            palette,
            wantSource,
            effective,
            { width: asset.sourceWidth, height: asset.sourceHeight },
            priority
          )
          .then(apply)
          .catch((error: Error) => {
            if (cancelled || isProcessCancelled(error)) return;
            setState((previous) => ({
              preview: previous.preview,
              error: error.message,
              loading: false
            }));
          });
      };

      const delay = shouldDebounceProcess(Boolean(next.preview)) ? PROCESS_DEBOUNCE_MS : 0;
      timer = window.setTimeout(start, delay);
    }

    const unsubscribe = processor.subscribe(cacheKey, apply);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      unsubscribe();
    };
    // `settings` is covered by `cacheKey`, which is a hash of it. Depending on
    // the object as well would refetch on every render for a caller that
    // builds its override inline.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asset, projectId, cacheKey, palette, wantSource, effective, detached, processId, priority, enabled]);

  return detached ? { preview: null, error: state.error, loading: true } : state;
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
    if (!canvas) return;
    if (!bitmap || !bitmapLive(bitmap) || width <= 0 || height <= 0) {
      canvas.width = 0;
      canvas.height = 0;
      return;
    }

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

    if (overlay && bitmapLive(overlay)) {
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

function useIntersecting(ref: { current: Element | null }): boolean {
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === "undefined");

  useEffect(() => {
    if (visible) return;
    const element = ref.current;
    if (!element) return;

    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setVisible(true);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, visible]);

  return visible;
}

export function AssetThumb({
  asset,
  size = 96,
  variant = "thumb"
}: {
  asset: ResolvedAsset;
  size?: number;
  variant?: SourceVariant;
}) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const visible = useIntersecting(boxRef);
  const palette = useAssetPalette(asset);
  // Thumb variant runs the same pipeline over the stored preview. Source-space
  // crops and erode are mapped in the worker from the recorded source size.
  const { preview, error, loading } = useProcessed(
    asset,
    palette,
    false,
    variant,
    asset.set ? undefined : previewFrameSettings(asset),
    undefined,
    PROCESS_PRIORITY.background,
    visible
  );

  const frameCount = asset.sequences.find((entry) => entry.frames.length > 0)?.frames.length ?? 0;
  const scale =
    preview && preview.width > 0 && preview.height > 0
      ? Math.min(size / preview.width, size / preview.height)
      : 1;

  return (
    <div
      ref={boxRef}
      className={`relative flex items-center justify-center overflow-hidden ${
        error ? "rounded bg-[#3a1e26] p-1" : "checkerboard"
      }`}
      style={{ width: size, height: size }}
    >
      {error ? (
        <span className="text-center text-[9px] leading-tight text-rose-300">{error}</span>
      ) : preview ? (
        <>
          <BitmapCanvas
            bitmap={preview.processed}
            width={preview.width}
            height={preview.height}
            pixelated
            className="block"
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
        </>
      ) : (
        <span className="text-[10px] text-slate-500">{loading ? "..." : ""}</span>
      )}
    </div>
  );
}
