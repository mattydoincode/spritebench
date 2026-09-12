import type { ResolvedAsset } from "./model";
import { sequenceKind, type Sequence, type SequenceFrame } from "./sequence";

export interface MixEntry {
  asset: ResolvedAsset;
  sequence: Sequence | null;
  frame: SequenceFrame | null;
}

/**
 * What a repeater picks from.
 *
 * A set (item grid) contributes every cell. An ordinary or animation asset
 * contributes once — the mix is not every walk frame.
 */
export function expandRepeaterMix(assets: ResolvedAsset[]): MixEntry[] {
  const mix: MixEntry[] = [];

  for (const asset of assets) {
    const set = asset.sequences.find(
      (entry) => sequenceKind(entry) === "set" && entry.frames.length > 0
    );

    if (set) {
      for (const frame of set.frames) mix.push({ asset, sequence: set, frame });
    } else {
      mix.push({ asset, sequence: null, frame: null });
    }
  }

  return mix;
}

export function isSetAsset(asset: {
  sequences: Array<{ kind?: string; frames: unknown[] }>;
  sequencePlan?: { kind?: string } | null;
}): boolean {
  if (asset.sequencePlan?.kind === "set") return true;
  return asset.sequences.some((entry) => entry.kind === "set" && entry.frames.length > 0);
}
