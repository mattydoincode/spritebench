import { isLoopSpec, type JobInputs } from "./model";
import { nextLoopIndex } from "./multistep";

export type LoopFollowUp =
  | { action: "advance"; index: number; inputs: JobInputs }
  | { action: "cancel-rest" }
  | { action: "none" };

export function successorInputs(inputs: JobInputs, assetId: string): JobInputs {
  return {
    ...inputs,
    base: {
      source: { kind: "asset", assetId },
      fit: inputs.base?.fit ?? "contain",
      matchAspect: inputs.base?.matchAspect ?? true
    }
  };
}

/**
 * What the worker should do after a loop step settles.
 *
 * Advance only on success with an output asset and a remaining step.
 * Any terminal failure cancels the rest of the chain.
 */
export function loopFollowUp(
  inputs: JobInputs | null,
  batchId: string | null,
  outcome: { ok: true; assetId: string } | { ok: false }
): LoopFollowUp {
  if (!inputs || !batchId || !isLoopSpec(inputs.loop)) return { action: "none" };

  if (!outcome.ok) return { action: "cancel-rest" };

  const index = nextLoopIndex(inputs);
  if (index == null) return { action: "none" };

  return { action: "advance", index, inputs: successorInputs(inputs, outcome.assetId) };
}

/**
 * Whether a settled job should advance or cancel its chain.
 *
 * Empty output is a failure: there is nothing to feed forward, so the rest of
 * the chain must not sit blocked.
 */
export function loopOutcome(landedAssetId: string | null): { ok: true; assetId: string } | { ok: false } {
  return landedAssetId ? { ok: true, assetId: landedAssetId } : { ok: false };
}
