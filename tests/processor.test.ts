import { describe, expect, it } from "vitest";
import {
  bitmapLive,
  isProcessCancelled,
  previewUsable,
  ProcessCancelledError,
  type ProcessedPreview
} from "@/client/processor";

function preview(patch: Partial<ProcessedPreview> = {}): ProcessedPreview {
  return {
    processed: { width: 16, height: 16 } as ImageBitmap,
    width: 16,
    height: 16,
    sourceWidth: 64,
    sourceHeight: 64,
    description: "",
    ...patch
  };
}

describe("bitmapLive", () => {
  it("accepts a bitmap with a real size", () => {
    expect(bitmapLive({ width: 16, height: 16 })).toBe(true);
  });

  it("rejects a closed or empty bitmap", () => {
    expect(bitmapLive({ width: 0, height: 0 })).toBe(false);
    expect(bitmapLive(null)).toBe(false);
  });

  it("rejects a detached bitmap whose size throws", () => {
    expect(
      bitmapLive({
        get width(): number {
          throw new Error("detached");
        },
        get height(): number {
          throw new Error("detached");
        }
      })
    ).toBe(false);
  });
});

describe("previewUsable", () => {
  it("accepts a processed-only result when the source bitmap is not required", () => {
    expect(previewUsable(preview(), false)).toBe(true);
    expect(previewUsable(preview(), true)).toBe(false);
  });

  it("requires a live source bitmap when asked", () => {
    expect(previewUsable(preview({ sourceBitmap: { width: 64, height: 64 } as ImageBitmap }), true)).toBe(
      true
    );
    expect(previewUsable(preview({ sourceBitmap: { width: 0, height: 0 } as ImageBitmap }), true)).toBe(
      false
    );
  });
});

describe("isProcessCancelled", () => {
  it("recognizes a silent abort and ignores other errors", () => {
    expect(isProcessCancelled(new ProcessCancelledError())).toBe(true);
    expect(isProcessCancelled(new Error("could not load source"))).toBe(false);
  });
});
