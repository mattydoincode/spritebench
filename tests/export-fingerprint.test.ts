import { describe, expect, it } from "vitest";
import { DEFAULT_PROCESSING } from "@/core/settings";
import { slotExportFingerprint } from "@/shared/exportFingerprint";

const edits = { a: { processing: DEFAULT_PROCESSING, sequences: {} } };

describe("slotExportFingerprint", () => {
  it("is stable for the same edits, whatever the key order", () => {
    const reordered = {
      a: { sequences: {}, processing: Object.fromEntries(Object.entries(DEFAULT_PROCESSING).reverse()) }
    } as unknown as typeof edits;
    expect(slotExportFingerprint(["a"], edits)).toBe(slotExportFingerprint(["a"], reordered));
  });

  it("changes when processing or the assignment changes", () => {
    const before = slotExportFingerprint(["a"], edits);
    const edited = { a: { ...edits.a, processing: { ...DEFAULT_PROCESSING, erodePixels: 2 } } };
    expect(slotExportFingerprint(["a"], edited)).not.toBe(before);
    expect(slotExportFingerprint(["a", "b"], edits)).not.toBe(before);
  });
});
