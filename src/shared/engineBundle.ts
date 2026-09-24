import { faceId, type AssetSet } from "./assetSet";
import type { EngineSlotIntent } from "./engineSlot";
import { sanitizeName } from "./naming";
import type { Sequence } from "./sequence";
import {
  clampFps,
  clampHold,
  playbackOrder,
  sequenceKind
} from "./sequence";

/**
 * Canonical bundle text hashed as the slot's local/remote digest.
 *
 * Godot's hasher.gd must emit the same bytes. Clips are sorted by name
 * with plain `<` string order (UTF-16 code units / Godot String).
 */
export const BUNDLE_VERSION = "spritebench.bundle/1";

export interface BundleAsset {
  id: string;
  sequences: Sequence[];
  set: AssetSet | null;
}

export interface HashedClipFrame {
  hold: number;
  sha256: string;
}

export interface HashedClip {
  name: string;
  fps: number;
  loop: boolean;
  frames: HashedClipFrame[];
}

export type PlannedFrame =
  | { mode: "still"; assetId: string; hold: number; file: string }
  | {
      mode: "sequence";
      assetId: string;
      sequence: Sequence;
      frameIndex: number;
      hold: number;
      file: string;
    };

export interface PlannedClip {
  name: string;
  fps: number;
  loop: boolean;
  frames: PlannedFrame[];
}

export type BundlePlan =
  | { intent: "texture"; assetId: string }
  | { intent: "sprite_frames"; clips: PlannedClip[] }
  | { intent: "textures"; frames: PlannedFrame[] };

function compareNames(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function clipFileName(name: string, index: number): string {
  return `${sanitizeName(name, "clip")}_${String(index).padStart(2, "0")}.png`;
}

export function bagFileName(index: number): string {
  return `${String(index).padStart(2, "0")}.png`;
}

export function clipLoops(playback: Sequence["playback"]): boolean {
  return playback !== "once";
}

function animationSequences(asset: BundleAsset): Sequence[] {
  return asset.sequences
    .filter((sequence) => sequenceKind(sequence) === "animation")
    .sort((left, right) => compareNames(left.name, right.name));
}

function setSequences(asset: BundleAsset): Sequence[] {
  return asset.sequences
    .filter((sequence) => sequenceKind(sequence) === "set")
    .sort((left, right) => compareNames(left.name, right.name));
}

function expandSequenceFrames(sequence: Sequence): PlannedFrame[] {
  return playbackOrder(sequence).map((frameIndex, index) => {
    const frame = sequence.frames[frameIndex];
    return {
      mode: "sequence" as const,
      assetId: frame.sourceAssetId || "",
      sequence,
      frameIndex,
      hold: clampHold(frame.hold),
      file: clipFileName(sequence.name, index)
    };
  });
}

function stillFrame(assetId: string, file: string, hold = 1): PlannedFrame {
  return { mode: "still", assetId, hold, file };
}

export function planBundle(intent: EngineSlotIntent, asset: BundleAsset): BundlePlan {
  if (intent === "texture") {
    return { intent: "texture", assetId: asset.id };
  }

  if (intent === "sprite_frames") {
    const clips = animationSequences(asset).map((sequence) => ({
      name: sequence.name,
      fps: clampFps(sequence.fps),
      loop: clipLoops(sequence.playback),
      frames: expandSequenceFrames(sequence).map((frame) => ({
        ...frame,
        assetId: frame.mode === "sequence" ? frame.assetId || asset.id : asset.id
      }))
    }));

    if (clips.length === 0) {
      return {
        intent: "sprite_frames",
        clips: [
          {
            name: "default",
            fps: 6,
            loop: true,
            frames: [stillFrame(asset.id, clipFileName("default", 0))]
          }
        ]
      };
    }

    return { intent: "sprite_frames", clips };
  }

  const setClips = setSequences(asset);
  if (setClips.length > 0) {
    const frames: PlannedFrame[] = [];
    for (const sequence of setClips) {
      for (let frameIndex = 0; frameIndex < sequence.frames.length; frameIndex += 1) {
        const frame = sequence.frames[frameIndex];
        frames.push({
          mode: "sequence",
          assetId: frame.sourceAssetId || asset.id,
          sequence,
          frameIndex,
          hold: clampHold(frame.hold),
          file: bagFileName(frames.length)
        });
      }
    }
    return { intent: "textures", frames };
  }

  const set = asset.set;
  if (set && faceId(set) === asset.id) {
    const ordered = [...set.members].sort((left, right) => left.index - right.index);
    return {
      intent: "textures",
      frames: ordered.map((member, index) => stillFrame(member.assetId, bagFileName(index)))
    };
  }

  return {
    intent: "textures",
    frames: [stillFrame(asset.id, bagFileName(0))]
  };
}

export function planTexturesBag(
  assets: readonly BundleAsset[]
): Extract<BundlePlan, { intent: "textures" }> {
  const frames: PlannedFrame[] = [];
  for (const asset of assets) {
    const planned = planBundle("textures", asset);
    if (planned.intent !== "textures") continue;
    for (const frame of planned.frames) {
      frames.push({ ...frame, file: bagFileName(frames.length) });
    }
  }
  return { intent: "textures", frames };
}

export function describeShipment(
  intent: EngineSlotIntent,
  assets: readonly BundleAsset[]
): string {
  if (intent === "texture") return "still";
  if (intent === "sprite_frames") {
    const plan = assets[0] ? planBundle(intent, assets[0]) : null;
    if (!plan || plan.intent !== "sprite_frames") return "clips";
    return `clips · ${plan.clips.map((clip) => clip.name).join(", ")}`;
  }

  const plan = planTexturesBag(assets);
  const count = plan.frames.length;
  if (count === 0) return "array";
  return count === 1 ? "array · 1 texture" : `array · ${count} textures`;
}

export function spriteFramesBundleText(clips: HashedClip[]): string {
  const lines = [BUNDLE_VERSION, "intent sprite_frames"];
  const ordered = [...clips].sort((left, right) => compareNames(left.name, right.name));

  for (const clip of ordered) {
    lines.push(`clip ${clip.name} ${clampFps(clip.fps)} ${clip.loop ? 1 : 0}`);
    for (const frame of clip.frames) {
      lines.push(`  ${clampHold(frame.hold)} ${frame.sha256}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

export function texturesBundleText(hashes: string[]): string {
  const lines = [BUNDLE_VERSION, "intent textures"];
  for (const sha256 of hashes) {
    lines.push(`  1 ${sha256}`);
  }
  return `${lines.join("\n")}\n`;
}

export function hashBundleText(text: string, digest: (bytes: Uint8Array) => string): string {
  return digest(new TextEncoder().encode(text));
}
