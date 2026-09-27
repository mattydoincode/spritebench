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
import { Button, Field, NumberInput, Row, Section, TextButton } from "./ui";

const STRIP_SIZE = 44;

/** One thumbnail in the frame strip. */
function FrameChip({
  index,
  bitmap,
  width,
  height,
  hold,
  active,
  size = STRIP_SIZE,
  onSelect
}: {
  size?: number;
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

/**
 * The inspector's animation controls.
 *
 * Sits above `size` because everything below it -- target size, cutout,
 * palette -- applies identically to every frame, whereas which frames exist is
 * what the asset *is*.
 */
export function AnimationSection({
  asset,
  sequence,
  playback
}: {
  asset: ResolvedAsset;
  sequence: Sequence | null;
  playback: Playback;
}) {
  const doc = useDoc.getState;
  const ui = useUi.getState;

  const openSlicer = () => ui().openSlicer(asset.id);

  const sequenceLabel = sequence && sequenceKind(sequence) === "set" ? "items" : "animation";

  if (asset.sequences.length === 0) {
    return (
      <Section id="inspector.sequence" label={sequenceLabel}>
        <p className="mb-2 text-[10px] leading-snug text-slate-500">
          Slice this image into frames to play it as an animation. Works on any sheet laid out on
          a grid.
        </p>

        <Button className="w-full" onClick={openSlicer}>
          slice into frames
        </Button>
      </Section>
    );
  }

  const active = sequence;
  const frameCount = active?.frames.length ?? 0;
  const current = active?.frames[playback.index] ?? null;

  return (
    <Section
      id="inspector.sequence"
      label={active && sequenceKind(active) === "set" ? "items" : "animation"}
    >
      {active ? (
        <>
          <Row className="mb-2">
            <div className="min-w-0 flex-1">
              <Field label="Name">
                <input
                  type="text"
                  value={active.name}
                  onChange={(event) =>
                    doc().patchSequence(asset.id, active.id, { name: event.target.value })
                  }
                />
              </Field>
            </div>
            <Button title="Add or rearrange actions on this sheet" onClick={openSlicer}>
              new
            </Button>
          </Row>

          {frameCount === 0 ? null : (
            <>
              <Row className="mb-2">
                <div className="flex-1">
                  <Field label="Hold" hint={`frame ${playback.index + 1} of ${frameCount}`}>
                    <NumberInput
                      integer
                      min={1}
                      max={99}
                      value={clampHold(current?.hold ?? 1)}
                      disabled={!current}
                      onChange={(hold) =>
                        current
                          ? doc().patchSequenceFrame(asset.id, active.id, current.id, { hold })
                          : undefined
                      }
                    />
                  </Field>
                </div>

                <Button
                  disabled={!current}
                  title="Crop this frame on its own, without touching the others"
                  onClick={() =>
                    current ? ui().openFrameEditor(asset.id, active.id, current.id) : undefined
                  }
                >
                  {current && current.edits.length > 0
                    ? `edit frame (${current.edits.length})`
                    : "edit frame"}
                </Button>
              </Row>
            </>
          )}

          <Row>
            <span className="flex-1" />
            <Button
              variant="danger"
              title="Remove this animation. The image itself is untouched."
              onClick={() => {
                doc().deleteSequence(asset.id, active.id);
                ui().setActiveSequence(null);
              }}
            >
              remove
            </Button>
          </Row>

        </>
      ) : null}
    </Section>
  );
}
