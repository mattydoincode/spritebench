import type { SheetPlan } from "@/core/sheet";
import type { Size } from "@/core/types";
import { clampFps, clampHold, type PlaybackMode, type Sequence } from "./sequence";

/**
 * What ships next to an exported animation.
 *
 * A packed PNG on its own is not importable: an engine has to be told where
 * the frames are and how long each is held. The alternative -- promising that
 * frame `n` is at `n * cell` -- only holds while every frame is the same size,
 * and stops being true the moment anything is cropped per frame.
 *
 * Durations are in milliseconds as well as ticks because most engines want
 * milliseconds and nobody should have to rediscover that a hold of 2 at 12fps
 * is 167ms.
 */

export interface ManifestFrame {
  index: number;
  /** Ticks this frame is held for. */
  hold: number;
  durationMs: number;
}

export interface SheetManifestFrame extends ManifestFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SheetManifest {
  format: "spritebench.sheet/1";
  name: string;
  fps: number;
  playback: PlaybackMode;
  frameCount: number;
  sheet: {
    file: string;
    width: number;
    height: number;
    columns: number;
    rows: number;
    cell: Size;
  };
  frames: SheetManifestFrame[];
}

export interface FramesManifestFrame extends ManifestFrame {
  file: string;
  width: number;
  height: number;
}

export interface FramesManifest {
  format: "spritebench.frames/1";
  name: string;
  fps: number;
  playback: PlaybackMode;
  frameCount: number;
  frames: FramesManifestFrame[];
}

function durationMs(hold: number, fps: number): number {
  return Math.round((clampHold(hold) / clampFps(fps)) * 1000);
}

export function buildSheetManifest(
  sequence: Sequence,
  plan: SheetPlan,
  sheetFile: string
): SheetManifest {
  const fps = clampFps(sequence.fps);

  return {
    format: "spritebench.sheet/1",
    name: sequence.name,
    fps,
    playback: sequence.playback,
    frameCount: plan.placements.length,
    sheet: {
      file: sheetFile,
      width: plan.size.width,
      height: plan.size.height,
      columns: plan.columns,
      rows: plan.rows,
      cell: plan.cell
    },
    frames: plan.placements.map((placement) => ({
      index: placement.index,
      x: placement.x,
      y: placement.y,
      width: placement.width,
      height: placement.height,
      hold: clampHold(sequence.frames[placement.index]?.hold ?? 1),
      durationMs: durationMs(sequence.frames[placement.index]?.hold ?? 1, fps)
    }))
  };
}

export function buildFramesManifest(
  sequence: Sequence,
  frames: Array<{ file: string; width: number; height: number }>
): FramesManifest {
  const fps = clampFps(sequence.fps);

  return {
    format: "spritebench.frames/1",
    name: sequence.name,
    fps,
    playback: sequence.playback,
    frameCount: frames.length,
    frames: frames.map((frame, index) => ({
      index,
      file: frame.file,
      width: frame.width,
      height: frame.height,
      hold: clampHold(sequence.frames[index]?.hold ?? 1),
      durationMs: durationMs(sequence.frames[index]?.hold ?? 1, fps)
    }))
  };
}
