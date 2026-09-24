"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  framesAfterSignatureChange,
  keysToCancel,
  PROCESS_DEBOUNCE_MS,
  shouldDebounceProcess
} from "@/client/processPreview";
import {
  isProcessCancelled,
  PROCESS_PRIORITY,
  processor,
  type ProcessedPreview,
  type SourceVariant
} from "@/client/processor";
import { useServer } from "@/client/stores/server";
import { hashPalette, hashSettings, type ProcessingSettings } from "@/core/settings";
import type { Rgb } from "@/core/types";
import type { ResolvedAsset } from "@/shared/model";
import {
  clampFps,
  firstTickOfIndex,
  frameIndexAtTick,
  frameSettings,
  frameSourceAssetId,
  totalTicks,
  type Sequence
} from "@/shared/sequence";

/**
 * How to render an animated asset as a single still: its first frame.
 *
 * A 4x4 sheet drawn into a 96-pixel library square is sixteen unreadable
 * specks, so anywhere that shows one image per asset shows frame 0 instead.
 *
 * Rectangles stay in raw source pixels. The processor maps them onto a
 * thumbnail when that is the image being decoded.
 *
 * Returns undefined for an asset with no animation, which is the signal to
 * render it the ordinary way.
 */
export function previewFrameSettings(asset: ResolvedAsset | null): ProcessingSettings | undefined {
  const sequence = asset?.sequences.find((entry) => entry.frames.length > 0);
  if (!asset || !sequence) return undefined;

  return frameSettings(asset.processing, sequence, sequence.frames[0]);
}

export interface SequenceFramesState {
  /** One entry per frame, in order. Null until that frame has been rendered. */
  frames: Array<ProcessedPreview | null>;
  loading: boolean;
  error: string | null;
}

const EMPTY: SequenceFramesState = { frames: [], loading: false, error: null };

/**
 * Renders every frame of a sequence.
 *
 * One `processor.process` call per frame, which sounds wasteful and is not:
 * the worker caches the decoded sheet by URL, so sixteen frames cost one PNG
 * decode and sixteen runs of the pipeline over a region of it.
 *
 * Frames land as they finish rather than all at once, so a long sequence
 * starts playing the moment its first frames are ready instead of blocking on
 * the last one.
 */
export function useSequenceFrames(
  asset: ResolvedAsset | null,
  sequence: Sequence | null,
  palette: Rgb[],
  variant: SourceVariant = "source"
): SequenceFramesState {
  const projectId = useServer((state) => state.project?.id ?? null);
  const [state, setState] = useState<SequenceFramesState>(EMPTY);

  const effective: SourceVariant = asset?.hasSource === false ? "thumb" : variant;

  // Every input that changes a pixel, flattened to a string. Depending on the
  // sequence object itself would re-render on any unrelated document change.
  const signature = useMemo(() => {
    if (!asset || !sequence) return "";

    const frames = sequence.frames
      .map(
        (frame) =>
          `${frameSourceAssetId(asset.id, frame)}:${frame.rect.x},${frame.rect.y},${frame.rect.width},${frame.rect.height}:${JSON.stringify(frame.edits)}`
      )
      .join("|");

    const { top, right, bottom, left } = sequence.inset;

    return [
      asset.id,
      effective,
      hashSettings(asset.processing),
      hashPalette(palette),
      `${top},${right},${bottom},${left}`,
      frames
    ].join("/");
  }, [asset, sequence, palette, effective]);

  const stateRef = useRef(state);
  stateRef.current = state;
  const keysRef = useRef<string[]>([]);

  useEffect(() => {
    if (!asset || !sequence || !projectId || sequence.frames.length === 0) {
      for (const key of keysToCancel(keysRef.current, [])) processor.cancel(key);
      keysRef.current = [];
      setState(EMPTY);
      return;
    }

    const settings = sequence.frames.map((frame) =>
      frameSettings(asset.processing, sequence, frame)
    );
    const keys = settings.map((entry, index) =>
      processor.cacheKeyFor(
        frameSourceAssetId(asset.id, sequence.frames[index]),
        entry,
        palette,
        effective
      )
    );

    for (const key of keysToCancel(keysRef.current, keys)) processor.cancel(key);
    keysRef.current = keys;

    const peeked = keys.map((key) => processor.peek(key) ?? null);
    const frames = framesAfterSignatureChange(stateRef.current.frames, peeked);
    const missing = peeked.flatMap((frame, index) => (frame ? [] : [index]));

    setState({
      frames,
      loading: missing.length > 0,
      error: null
    });

    if (missing.length === 0) return;

    let cancelled = false;
    let timer = 0;

    const start = () => {
      let outstanding = missing.length;

      for (const index of missing) {
        processor
          .process(
            projectId,
            frameSourceAssetId(asset.id, sequence.frames[index]),
            settings[index],
            palette,
            false,
            effective,
            { width: asset.sourceWidth, height: asset.sourceHeight },
            PROCESS_PRIORITY.visible
          )
          .then((preview) => {
            if (cancelled) return;

            setState((previous) => {
              const next = [...previous.frames];
              next[index] = preview;
              return { ...previous, frames: next };
            });
          })
          .catch((error: Error) => {
            if (!cancelled && !isProcessCancelled(error)) {
              setState((previous) => ({ ...previous, error: error.message }));
            }
          })
          .finally(() => {
            outstanding--;
            if (!cancelled && outstanding === 0) {
              setState((previous) => ({ ...previous, loading: false }));
            }
          });
      }
    };

    const delay = shouldDebounceProcess(frames.some(Boolean)) ? PROCESS_DEBOUNCE_MS : 0;
    timer = window.setTimeout(start, delay);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // `signature` stands in for asset, sequence and palette: it is built from
    // exactly the fields of each that change a rendered pixel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, projectId]);

  return state;
}

export interface Playback {
  index: number;
  playing: boolean;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  /** Scrubbing. Pauses, because fighting the clock for the scrub bar is worse. */
  seek: (index: number) => void;
}

/**
 * Drives the frame index off a clock.
 *
 * Time is converted to integer ticks and the frame is looked up from those,
 * rather than advancing an index every N milliseconds. A dropped animation
 * frame then shows up as a skipped frame instead of the whole animation
 * running slow, which is what happens when the index is incremented per
 * callback.
 */
export function useSequencePlayback(sequence: Sequence | null, autoPlay = false): Playback {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(autoPlay);

  const frameCount = sequence?.frames.length ?? 0;
  const indexRef = useRef(index);
  indexRef.current = index;

  // A re-slice can leave the index past the end of the new frame list.
  useEffect(() => {
    if (frameCount > 0 && indexRef.current >= frameCount) setIndex(0);
  }, [frameCount]);

  useEffect(() => {
    if (!playing || !sequence || frameCount === 0) return;

    const fps = clampFps(sequence.fps);
    const span = totalTicks(sequence);
    const startTick = firstTickOfIndex(sequence, indexRef.current);
    const startedAt = performance.now();

    let handle = 0;

    const step = () => {
      const elapsed = (performance.now() - startedAt) / 1000;
      const tick = startTick + Math.floor(elapsed * fps);

      setIndex(frameIndexAtTick(sequence, tick));

      if (sequence.playback === "once" && tick >= span - 1) {
        setPlaying(false);
        return;
      }

      handle = requestAnimationFrame(step);
    };

    handle = requestAnimationFrame(step);

    return () => cancelAnimationFrame(handle);
    // Restarting the clock on a settings change is correct: the new fps or
    // playback mode should take effect now, not at the end of the cycle.
  }, [playing, sequence, frameCount]);

  const seek = useCallback((next: number) => {
    setPlaying(false);
    setIndex(Math.max(0, Math.floor(next)));
  }, []);

  const play = useCallback(() => setPlaying(true), []);
  const pause = useCallback(() => setPlaying(false), []);
  const toggle = useCallback(() => setPlaying((was) => !was), []);

  return { index: frameCount === 0 ? 0 : Math.min(index, frameCount - 1), playing, play, pause, toggle, seek };
}
