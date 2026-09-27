"use client";

import { useSequenceFrames, type Playback } from "@/client/sequence";
import { useDoc } from "@/client/stores/doc";
import { useUi } from "@/client/stores/ui";
import type { ResolvedAsset } from "@/shared/model";
import {
  MAX_FPS,
  MIN_FPS,
  PLAYBACK_LABELS,
  PLAYBACK_MODES,
  clampHold,
  sequenceKind,
  type PlaybackMode,
  type Sequence
} from "@/shared/sequence";
import { BitmapCanvas } from "./AssetBitmap";
import { Button, NumberInput, TextButton } from "./ui";

/** One thumbnail in the frame strip. */
function FrameChip({
  index,
  bitmap,
  width,
  height,
  hold,
  active,
  size,
  onSelect
}: {
  size: number;
  index: number;
  bitmap: ImageBitmap | null;
  width: number;
  height: number;
  hold: number;
  active: boolean;
  onSelect: () => void;
}) {
  const scale = width > 0 && height > 0 ? Math.min(size / width, size / height) : 1;

  return (
    <button
      type="button"
      title={`Frame ${index + 1}${hold > 1 ? `, held ${hold} ticks` : ""}`}
      onClick={onSelect}
      className={`relative shrink-0 rounded border p-0.5 ${
        active
          ? "border-[var(--color-accent)] bg-[var(--color-ink-700)]"
          : "border-[var(--color-edge)] bg-[var(--color-ink-800)]"
      }`}
    >
      <div
        className="checkerboard flex items-center justify-center rounded"
        style={{ width: size, height: size }}
      >
        {bitmap ? (
          <BitmapCanvas
            bitmap={bitmap}
            width={width}
            height={height}
            pixelated={scale >= 1}
            style={{
              width: Math.max(1, Math.round(width * scale)),
              height: Math.max(1, Math.round(height * scale))
            }}
          />
        ) : null}
      </div>

      <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[8px] leading-tight text-slate-300">
        {index + 1}
      </span>

      {hold > 1 ? (
        <span className="absolute bottom-1 right-1 rounded bg-black/60 px-1 text-[8px] leading-tight text-amber-300">
          x{hold}
        </span>
      ) : null}
    </button>
  );
}

const BAR_STRIP_SIZE = 32;

/**
 * Playback for an animated image, pinned over the inspector preview: which
 * animation, play/pause, speed, playback mode and re-slice on one line, and
 * the frames as a strip to click through. The rest (names, holds, per-frame
 * crops) stays in the Animation section below.
 */
export function AnimationBar({
  asset,
  sequence,
  playback,
  frames
}: {
  asset: ResolvedAsset;
  sequence: Sequence;
  playback: Playback;
  frames: ReturnType<typeof useSequenceFrames>;
}) {
  const doc = useDoc.getState;
  const ui = useUi.getState;
  // Item sets share the frame data but do not play: just the strip to pick from.
  const animated = sequenceKind(sequence) !== "set";

  return (
    <div className="mb-2 shrink-0">
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
        <select
          value={sequence.id}
          title="Which animation"
          style={{ width: "auto", flex: "1 1 6rem", minWidth: "6rem" }}
          onChange={(event) => ui().setActiveSequence(event.target.value)}
        >
          {asset.sequences.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name} ({entry.frames.length})
            </option>
          ))}
        </select>
        {animated ? (
          <>
            <Button
              variant={playback.playing ? "primary" : "default"}
              title={playback.playing ? "Pause" : "Play"}
              disabled={sequence.frames.length === 0}
              onClick={playback.toggle}
            >
              {playback.playing ? "\u275a\u275a" : "\u25b6"}
            </Button>
            <label className="flex items-center gap-1 text-[10px] text-slate-500" title="Frames per second">
              <NumberInput
                integer
                min={MIN_FPS}
                max={MAX_FPS}
                width={40}
                value={sequence.fps}
                onChange={(fps) => doc().patchSequence(asset.id, sequence.id, { fps })}
              />
              fps
            </label>
            <select
              value={sequence.playback}
              title="How it plays"
              style={{ width: "auto" }}
              onChange={(event) =>
                doc().patchSequence(asset.id, sequence.id, { playback: event.target.value as PlaybackMode })
              }
            >
              {PLAYBACK_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {PLAYBACK_LABELS[mode]}
                </option>
              ))}
            </select>
          </>
        ) : null}
        <TextButton title="Slice the sheet into frames again" onClick={() => ui().openSlicer(asset.id)}>
          re-slice
        </TextButton>
      </div>

      {sequence.frames.length > 0 ? (
        <div className="flex gap-1 overflow-x-auto pb-1">
          {sequence.frames.map((frame, index) => (
            <FrameChip
              key={frame.id}
              index={index}
              size={BAR_STRIP_SIZE}
              bitmap={frames.frames[index]?.processed ?? null}
              width={frames.frames[index]?.width ?? 0}
              height={frames.frames[index]?.height ?? 0}
              hold={clampHold(frame.hold)}
              active={index === playback.index}
              onSelect={() => playback.seek(index)}
            />
          ))}
        </div>
      ) : (
        <p className="text-[10px] text-slate-500">No frames yet. Re-slice the sheet to fill it.</p>
      )}

      {frames.error ? <p className="mt-1 text-[10px] text-rose-300">{frames.error}</p> : null}
    </div>
  );
}
