import { describe, expect, it } from "vitest";
import {
  framesAfterSignatureChange,
  keysToCancel,
  previewAfterKeyChange,
  shouldDebounceProcess
} from "@/client/processPreview";

describe("previewAfterKeyChange", () => {
  it("uses a cache hit immediately", () => {
    expect(
      previewAfterKeyChange({ previous: "old", nextPeek: "hit", assetChanged: false })
    ).toEqual({ preview: "hit", loading: false });
  });

  it("clears when the asset changes and nothing is cached", () => {
    expect(
      previewAfterKeyChange({ previous: "old", nextPeek: null, assetChanged: true })
    ).toEqual({ preview: null, loading: true });
  });

  it("keeps the last-good bitmap while settings change", () => {
    expect(
      previewAfterKeyChange({ previous: "old", nextPeek: null, assetChanged: false })
    ).toEqual({ preview: "old", loading: true });
  });
});

describe("framesAfterSignatureChange", () => {
  it("prefers peeked frames and keeps last-good on a miss", () => {
    expect(framesAfterSignatureChange(["a", "b", null], [null, "B", null])).toEqual([
      "a",
      "B",
      null
    ]);
  });

  it("drops leftover frames when the sequence shrinks", () => {
    expect(framesAfterSignatureChange(["a", "b", "c"], [null])).toEqual(["a"]);
  });
});

describe("keysToCancel", () => {
  it("cancels keys that left the next set and keeps siblings", () => {
    expect(keysToCancel(["a:1", "a:2", "a:3"], ["a:2", "a:4"])).toEqual(["a:1", "a:3"]);
  });

  it("cancels everything when the next set is empty", () => {
    expect(keysToCancel(["a", "b"], [])).toEqual(["a", "b"]);
  });
});

describe("shouldDebounceProcess", () => {
  it("waits only when something is already on screen", () => {
    expect(shouldDebounceProcess(true)).toBe(true);
    expect(shouldDebounceProcess(false)).toBe(false);
  });
});
