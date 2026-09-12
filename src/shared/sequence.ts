import type { CropEdit, ImageEdit } from "@/core/edits";
import type { ProcessingSettings } from "@/core/settings";
import type { Inset, Rect } from "@/core/types";
import type { SequenceKind } from "./model";

/**
 * Animation sequences.
 *
 * A frame is a crop. `applyPipeline` runs `settings.edits` before anything
 * else, so rendering frame 7 of a sheet is the ordinary processing pipeline
 * with the frame's rectangle pushed onto the front of the edit list. Nothing
 * in the worker or the pipeline knows sequences exist.
 */

export type { Inset, Rect };

export const NO_INSET: Inset = { top: 0, right: 0, bottom: 0, left: 0 };

export type PlaybackMode = "loop" | "pingPong" | "once";

export const PLAYBACK_MODES: PlaybackMode[] = ["loop", "pingPong", "once"];

export const PLAYBACK_LABELS: Record<PlaybackMode, string> = {
  loop: "loop",
  pingPong: "ping-pong",
  once: "play once"
};

export interface SequenceFrame {
  id: string;
  /**
   * Which asset the pixels come from.
   *
   * Always the sequence's own asset today, because the only way to make a
   * sequence is to slice one sheet. It is stored per frame rather than per
   * sequence so that assembling an animation out of separately generated
   * frames -- or dropping in a model-generated in-between -- is a creation
   * UI and not a schema change.
   */
  sourceAssetId: string;
  /**
   * The frame's rectangle in *raw* source pixels.
   *
   * Deliberately not in post-edit coordinates. The asset-level `edits` are a
   * crop of the whole sheet, and if frames were expressed relative to that,
   * cropping the sheet after slicing would silently move every frame. Raw
   * coordinates mean there is one coordinate space and re-slicing is the way
   * to fix a bad sheet.
   */
  rect: Rect;
  /** Applied after the rectangle. Crops today, strokes once there is a pen. */
  edits: ImageEdit[];
  /** How many ticks this frame is held for. 1 is one tick at the sequence fps. */
  hold: number;
}

export interface Sequence {
  id: string;
  /** "walk", "idle", "attack". One sheet usually holds several. */
  name: string;
  /** Missing means animation, so older documents stay walk cycles. */
  kind?: SequenceKind;
  fps: number;
  playback: PlaybackMode;
  /**
   * Trimmed off every frame, in raw source pixels.
   *
   * This is how a sequence loses its dead space. Per-frame `trimToContent`
   * cannot do it: each frame would get its own bounding box and its own
   * scale factor, so the sprite would jitter and change size as it played.
   * One inset shared by every frame keeps them registered.
   */
  inset: Inset;
  frames: SequenceFrame[];
}

export const DEFAULT_FPS = 6;
/** Item grids flip through objects, not poses — slower than a walk cycle. */
export const SET_FPS = 4;
export const MIN_FPS = 1;
export const MAX_FPS = 60;

export function sequenceKind(sequence: { kind?: SequenceKind | null }): SequenceKind {
  return sequence.kind === "set" ? "set" : "animation";
}

export function clampFps(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_FPS;
  return Math.min(MAX_FPS, Math.max(MIN_FPS, Math.round(value)));
}

export function clampHold(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.round(value));
}

/** The rectangle actually sampled: the frame's box less the sequence inset. */
export function insetRect(rect: Rect, inset: Inset): Rect {
  const left = Math.max(0, Math.round(inset.left));
  const top = Math.max(0, Math.round(inset.top));
  const right = Math.max(0, Math.round(inset.right));
  const bottom = Math.max(0, Math.round(inset.bottom));

  // A too-large inset would produce an empty crop, which the pipeline cannot
  // render. Collapsing to a single pixel keeps a nonsense inset visible as a
  // dot rather than as a thrown error mid-playback.
  return {
    x: Math.round(rect.x) + left,
    y: Math.round(rect.y) + top,
    width: Math.max(1, Math.round(rect.width) - left - right),
    height: Math.max(1, Math.round(rect.height) - top - bottom)
  };
}

function toCrop(rect: Rect): CropEdit {
  return { kind: "crop", x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

/**
 * The processing settings that render one frame.
 *
 * `trimToContent` is forced off: the frame rectangle is the registration, and
 * trimming would give each frame a different bounding box and a different
 * scale. Asset-level `edits` are dropped for the same reason the rectangle is
 * stored raw -- a sheet-wide crop would shift every frame out from under its
 * rectangle.
 */
export function frameSourceAssetId(assetId: string, frame: SequenceFrame): string {
  return frame.sourceAssetId || assetId;
}

export function frameSettings(
  base: ProcessingSettings,
  sequence: Sequence,
  frame: SequenceFrame
): ProcessingSettings {
  return {
    ...base,
    trimToContent: false,
    edits: [toCrop(insetRect(frame.rect, sequence.inset)), ...frame.edits]
  };
}

export function frameAt(sequence: Sequence, index: number): SequenceFrame | null {
  return sequence.frames[index] ?? null;
}

/**
 * Frame indices in the order they play.
 *
 * Ping-pong walks back without repeating the endpoints -- 0 1 2 3 2 1, not
 * 0 1 2 3 3 2 1 0 -- because holding the turnaround for two ticks is a visible
 * stutter at the ends of every cycle.
 */
export function playbackOrder(sequence: Sequence): number[] {
  const forward = [...sequence.frames.keys()];
  if (sequence.playback !== "pingPong" || forward.length < 3) return forward;

  return [...forward, ...forward.slice(1, -1).reverse()];
}

/** Total ticks in one pass, honouring per-frame holds. */
export function totalTicks(sequence: Sequence): number {
  return playbackOrder(sequence).reduce(
    (sum, index) => sum + clampHold(sequence.frames[index].hold),
    0
  );
}

/**
 * The first tick at which a frame is on screen.
 *
 * Used to resume playback from wherever the scrub bar was left, rather than
 * snapping back to frame zero every time play is pressed.
 */
export function firstTickOfIndex(sequence: Sequence, index: number): number {
  let tick = 0;

  for (const entry of playbackOrder(sequence)) {
    if (entry === index) return tick;
    tick += clampHold(sequence.frames[entry].hold);
  }

  return 0;
}

/**
 * Which frame is showing at `tick`.
 *
 * Ticks rather than seconds so this is a pure integer function a test can
 * enumerate; the caller converts elapsed time with the sequence fps.
 */
export function frameIndexAtTick(sequence: Sequence, tick: number): number {
  const count = sequence.frames.length;
  if (count === 0) return 0;

  const span = totalTicks(sequence);
  if (span <= 0) return 0;

  const raw = Math.floor(tick);

  const position =
    sequence.playback === "once"
      ? Math.min(raw, span - 1)
      : ((raw % span) + span) % span;

  // Walk the holds. Frame counts are small enough that the scan is cheaper
  // than maintaining a prefix table that could fall out of sync with edits.
  const order = playbackOrder(sequence);

  let remaining = position;
  for (const index of order) {
    const hold = clampHold(sequence.frames[index].hold);
    if (remaining < hold) return index;
    remaining -= hold;
  }

  return order[order.length - 1] ?? 0;
}
