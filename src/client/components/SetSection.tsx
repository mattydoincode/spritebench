"use client";

import { useSequenceFrames, type Playback } from "@/client/sequence";
import { useDoc } from "@/client/stores/doc";
import type { Rgb } from "@/core/types";
import { faceId, setBadge, type AssetSet } from "@/shared/assetSet";
import type { ResolvedAsset } from "@/shared/model";
import { sequenceKind, type Sequence } from "@/shared/sequence";
import { BitmapCanvas } from "./AssetBitmap";
import { Button, Divider, Field, Row } from "./ui";

const STRIP_SIZE = 44;

export function SetSection({
  set,
  sequence,
  playback,
  frames
}: {
  asset: ResolvedAsset;
  set: AssetSet;
  sequence: Sequence | null;
  palette: Rgb[];
  playback: Playback;
  frames: ReturnType<typeof useSequenceFrames>;
}) {
  const edits = useDoc((state) => state.edits);
  const doc = useDoc.getState;
  const face = faceId(set);
  const current = sequence?.frames[playback.index] ?? null;
  const canExtract = Boolean(current && current.sourceAssetId && current.sourceAssetId !== face);
  const extracted = Boolean(
    current?.sourceAssetId && edits[current.sourceAssetId]?.hidden === false
  );

  const grid = set.view === "grid";

  return (
    <>
      <Divider label={grid ? "tileset" : "set"} />

      <p className="mb-2 text-[10px] leading-snug text-slate-500">
        {set.kind === "grid"
          ? "Chunk outputs, slotted back onto the source grid."
          : "Loop outputs, in step order."}{" "}
        {setBadge(set)}
        {set.members.length < set.columns * set.rows
          ? ` · ${set.members.length} landed`
          : ""}
      </p>

      <Row className="mb-2">
        <Button
          variant={set.view === "animate" ? "primary" : "ghost"}
          onClick={() => doc().setSetView(set.id, "animate")}
        >
          Animate
        </Button>
        <Button
          variant={set.view === "grid" ? "primary" : "ghost"}
          onClick={() => doc().setSetView(set.id, "grid")}
        >
          Grid
        </Button>
      </Row>

      {sequence && sequence.frames.length > 0 ? (
        <div
          className={`mb-2 ${grid ? "grid gap-1" : "flex gap-1 overflow-x-auto pb-1"}`}
          style={
            grid
              ? { gridTemplateColumns: `repeat(${set.columns}, minmax(0, 1fr))` }
              : undefined
          }
        >
          {sequence.frames.map((frame, index) => {
            const preview = frames.frames[index];
            const scale =
              preview && preview.width > 0 && preview.height > 0
                ? Math.min(STRIP_SIZE / preview.width, STRIP_SIZE / preview.height)
                : 1;

            return (
              <button
                key={frame.id}
                type="button"
                title={grid ? `Cell ${index + 1}` : `Frame ${index + 1}`}
                onClick={() => playback.seek(index)}
                className={`relative rounded border p-0.5 ${
                  index === playback.index
                    ? "border-[var(--color-accent)] bg-[var(--color-ink-700)]"
                    : "border-[var(--color-edge)] bg-[var(--color-ink-800)]"
                }`}
              >
                <div
                  className="checkerboard flex items-center justify-center rounded"
                  style={{ width: STRIP_SIZE, height: STRIP_SIZE }}
                >
                  {preview?.processed ? (
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
                  ) : null}
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <p className="mb-2 text-[10px] text-slate-500">Waiting for the first image to land.</p>
      )}

      <Button
        className="mb-2 w-full"
        disabled={!canExtract || extracted}
        title={
          !canExtract
            ? "This cell is the set card"
            : extracted
              ? "Already in the library"
              : "Show this image as its own library asset"
        }
        onClick={() => {
          if (current?.sourceAssetId) doc().setHidden(current.sourceAssetId, false);
        }}
      >
        {extracted ? "saved as image" : "Save as image"}
      </Button>

      {sequence && sequenceKind(sequence) === "animation" ? (
        <Field label="Speed" hint="frames per second">
          <p className="text-[10px] text-slate-500">{sequence.fps} fps</p>
        </Field>
      ) : null}

      {frames.error ? <p className="mt-2 text-[10px] text-rose-300">{frames.error}</p> : null}
    </>
  );
}
