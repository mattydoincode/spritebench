"use client";

import { useSequenceFrames, type Playback } from "@/client/sequence";
import { useDoc } from "@/client/stores/doc";
import { useUi } from "@/client/stores/ui";
import type { Rgb } from "@/core/types";
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
import { Button, Divider, Field, NumberInput, Row, Select } from "./ui";

const STRIP_SIZE = 44;

/** One thumbnail in the frame strip. */
function FrameChip({
  index,
  bitmap,
  width,
  height,
  hold,
  active,
  onSelect
}: {
  index: number;
  bitmap: ImageBitmap | null;
  width: number;
  height: number;
  hold: number;
  active: boolean;
  onSelect: () => void;
}) {
  const scale = width > 0 && height > 0 ? Math.min(STRIP_SIZE / width, STRIP_SIZE / height) : 1;

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
        style={{ width: STRIP_SIZE, height: STRIP_SIZE }}
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
  palette,
  playback,
  frames
}: {
  asset: ResolvedAsset;
  sequence: Sequence | null;
  palette: Rgb[];
  playback: Playback;
  frames: ReturnType<typeof useSequenceFrames>;
}) {
  const doc = useDoc.getState;
  const ui = useUi.getState;

  const openSlicer = () => ui().openSlicer(asset.id);

  if (asset.sequences.length === 0) {
    return (
      <>
        <Divider label={sequence && sequenceKind(sequence) === "set" ? "items" : "animation"} />

        <p className="mb-2 text-[10px] leading-snug text-slate-500">
          Slice this image into frames to play it as an animation. Works on any sheet laid out on
          a grid.
        </p>

        <Button className="w-full" onClick={openSlicer}>
          slice into frames
        </Button>
      </>
    );
  }

  const active = sequence;
  const frameCount = active?.frames.length ?? 0;
  const current = active?.frames[playback.index] ?? null;

  return (
    <>
      <Divider label={active && sequenceKind(active) === "set" ? "items" : "animation"} />

      <Row className="mb-2">
        <div className="min-w-0 flex-1">
          <Select
            value={active?.id ?? ""}
            options={asset.sequences.map((entry) => entry.id)}
            labels={Object.fromEntries(
              asset.sequences.map((entry) => [
                entry.id,
                `${entry.name} (${entry.frames.length})`
              ])
            )}
            onChange={(id) => ui().setActiveSequence(id)}
          />
        </div>

        <Button title="Add or rearrange actions on this sheet" onClick={openSlicer}>
          new
        </Button>
      </Row>

      {active ? (
        <>
          <Field label="Name">
            <input
              type="text"
              value={active.name}
              onChange={(event) =>
                doc().patchSequence(asset.id, active.id, { name: event.target.value })
              }
            />
          </Field>

          <Row>
            <div className="flex-1">
              <Field label="Speed" hint="frames per second">
                <NumberInput
                  integer
                  min={MIN_FPS}
                  max={MAX_FPS}
                  value={active.fps}
                  onChange={(fps) => doc().patchSequence(asset.id, active.id, { fps })}
                />
              </Field>
            </div>
            <div className="flex-1">
              <Field label="Playback">
                <Select
                  value={active.playback}
                  options={PLAYBACK_MODES}
                  labels={PLAYBACK_LABELS}
                  onChange={(mode: PlaybackMode) =>
                    doc().patchSequence(asset.id, active.id, { playback: mode })
                  }
                />
              </Field>
            </div>
          </Row>

          {frameCount === 0 ? (
            <p className="mb-2 text-[10px] text-slate-500">
              No frames yet. Slice the sheet to fill this animation.
            </p>
          ) : (
            <>
              <div className="mb-2 flex gap-1 overflow-x-auto pb-1">
                {active.frames.map((frame, index) => (
                  <FrameChip
                    key={frame.id}
                    index={index}
                    bitmap={frames.frames[index]?.processed ?? null}
                    width={frames.frames[index]?.width ?? 0}
                    height={frames.frames[index]?.height ?? 0}
                    hold={clampHold(frame.hold)}
                    active={index === playback.index}
                    onSelect={() => playback.seek(index)}
                  />
                ))}
              </div>

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
            <Button className="flex-1" onClick={() => ui().openSlicer(asset.id)}>
              re-slice
            </Button>

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

          {frames.error ? (
            <p className="mt-2 text-[10px] text-rose-300">{frames.error}</p>
          ) : null}
        </>
      ) : null}
    </>
  );
}
