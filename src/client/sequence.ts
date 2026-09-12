"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { processor, type ProcessedPreview, type SourceVariant } from "@/client/processor";
import { useServer } from "@/client/stores/server";
import { hashSettings, type ProcessingSettings } from "@/core/settings";
import { thumbnailSize } from "@/core/size";
import { scaleRect } from "@/core/slice";
import type { Rgb } from "@/core/types";
import type { ResolvedAsset } from "@/shared/model";
import {
  clampFps,
  firstTickOfIndex,
  frameIndexAtTick,
  frameSettings,
  frameSourceAssetId,
  insetRect,
  totalTicks,
  type Sequence
} from "@/shared/sequence";

/**
 * How to render an animated asset as a single still: its first frame.
 *
 * A 4x4 sheet drawn into a 96-pixel library square is sixteen unreadable
 * specks, so anywhere that shows one image per asset shows frame 0 instead.
 *
 * The `variant` matters. Frame rectangles are in raw source coordinates, and
 * the library renders from a 256-pixel stored thumbnail, so the rectangle has
 * to be mapped into that space or it lands off the edge of the image.
 *
 * Returns undefined for an asset with no animation, which is the signal to
 * render it the ordinary way.
 */
export function previewFrameSettings(
  asset: ResolvedAsset | null,
  variant: SourceVariant
): ProcessingSettings | undefined {
  const sequence = asset?.sequences.find((entry) => entry.frames.length > 0);
  if (!asset || !sequence) return undefined;

  const settings = frameSettings(asset.processing, sequence, sequence.frames[0]);
  if (variant !== "thumb") return settings;

  const source = { width: asset.sourceWidth, height: asset.sourceHeight };
  const rect = insetRect(sequence.frames[0].rect, sequence.inset);
  const scaled = scaleRect(rect, source, thumbnailSize(source));

  // Per-frame edits are dropped rather than rescaled: they are in the frame's
  // own space, and at thumbnail scale a few pixels of crop is invisible
  // anyway. Getting the frame right is the whole job here.
  return { ...settings, edits: [{ kind: "crop", ...scaled }] };
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
      palette.length,
      `${top},${right},${bottom},${left}`,
      frames
    ].join("/");
  }, [asset, sequence, palette.length, effective]);

  useEffect(() => {
    if (!asset || !sequence || !projectId || sequence.frames.length === 0) {
      setState(EMPTY);
      return;
    }

    const settings = sequence.frames.map((frame) =>
      frameSettings(asset.processing, sequence, frame)
    );

    // Anything already rendered shows immediately; only the rest flickers.
    const seeded = settings.map(
      (entry, index) =>
        processor.peek(
          processor.cacheKeyFor(
            frameSourceAssetId(asset.id, sequence.frames[index]),
            entry,
            palette.length,
            effective
          )
        ) ?? null
    );

    setState({
      frames: seeded,
      loading: seeded.some((frame) => frame === null),
      error: null
    });

    let cancelled = false;
    let outstanding = 0;

    for (const [index, entry] of settings.entries()) {
      if (seeded[index]) continue;

      outstanding++;

      processor
        .process(
          projectId,
          frameSourceAssetId(asset.id, sequence.frames[index]),
          entry,
          palette,
          false,
          effective
        )
        .then((preview) => {
          if (cancelled) return;

          setState((previous) => {
            const frames = [...previous.frames];
            frames[index] = preview;
            return { ...previous, frames };
          });
        })
        .catch((error: Error) => {
          if (!cancelled) setState((previous) => ({ ...previous, error: error.message }));
        })
        .finally(() => {
          outstanding--;
          if (!cancelled && outstanding === 0) {
            setState((previous) => ({ ...previous, loading: false }));
          }
        });
    }

    if (outstanding === 0) setState((previous) => ({ ...previous, loading: false }));

    return () => {
      cancelled = true;
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
