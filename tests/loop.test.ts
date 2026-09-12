import { describe, expect, it } from "vitest";
import { loopFollowUp, loopOutcome, successorInputs } from "@/shared/loop";
import type { JobInputs } from "@/shared/model";

const inputs: JobInputs = {
  base: {
    source: { kind: "asset", assetId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" },
    fit: "contain",
    matchAspect: true
  },
  mask: {
    source: { kind: "template", templateId: "builtin:iso-diamond" },
    maskSource: "keepInsideShape",
    dilatePixels: 0,
    fit: "contain"
  },
  loop: { steps: 4, index: 1 }
};

describe("loopFollowUp", () => {
  it("advances the next blocked step onto the new asset", () => {
    const follow = loopFollowUp(inputs, "batch-1", {
      ok: true,
      assetId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
    });

    expect(follow.action).toBe("advance");
    if (follow.action !== "advance") return;
    expect(follow.index).toBe(2);
    expect(follow.inputs.base?.source).toEqual({
      kind: "asset",
      assetId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
    });
    expect(follow.inputs.mask).toEqual(inputs.mask);
  });

  it("cancels the rest of the chain on failure", () => {
    expect(loopFollowUp(inputs, "batch-1", { ok: false })).toEqual({ action: "cancel-rest" });
  });

  it("stops after the last step", () => {
    expect(
      loopFollowUp({ ...inputs, loop: { steps: 4, index: 4 } }, "batch-1", {
        ok: true,
        assetId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
      })
    ).toEqual({ action: "none" });
  });

  it("ignores jobs that are not a loop chain", () => {
    expect(loopFollowUp({ base: inputs.base }, "batch-1", { ok: false })).toEqual({ action: "none" });
    expect(loopFollowUp(inputs, null, { ok: false })).toEqual({ action: "none" });
  });
});

describe("loopOutcome", () => {
  it("advances only when an asset landed", () => {
    expect(loopOutcome("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")).toEqual({
      ok: true,
      assetId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
    });
    expect(loopOutcome(null)).toEqual({ ok: false });
  });
});

describe("successorInputs", () => {
  it("keeps the mask and points base at the new asset", () => {
    const next = successorInputs(inputs, "cccccccc-cccc-cccc-cccc-cccccccccccc");
    expect(next.mask).toEqual(inputs.mask);
    expect(next.base?.source).toEqual({
      kind: "asset",
      assetId: "cccccccc-cccc-cccc-cccc-cccccccccccc"
    });
  });
});
