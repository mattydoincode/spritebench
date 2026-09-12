import { describe, expect, it } from "vitest";
import { DEFAULT_PROCESSING } from "@/core/settings";
import {
  firstTickOfIndex,
  frameIndexAtTick,
  frameSettings,
  insetRect,
  playbackOrder,
  totalTicks,
  type Sequence,
  type SequenceFrame
} from "@/shared/sequence";

function frame(id: string, x: number, hold = 1): SequenceFrame {
  return {
    id,
    sourceAssetId: "sheet",
    rect: { x, y: 0, width: 20, height: 20 },
    edits: [],
    hold
  };
}

function sequence(overrides: Partial<Sequence> = {}): Sequence {
  return {
    id: "seq",
    name: "walk",
    fps: 12,
    playback: "loop",
    inset: { top: 0, right: 0, bottom: 0, left: 0 },
    frames: [frame("a", 0), frame("b", 20), frame("c", 40), frame("d", 60)],
    ...overrides
  };
}

describe("insetRect", () => {
  it("shrinks the rectangle from every edge", () => {
    const rect = insetRect(
      { x: 10, y: 10, width: 20, height: 20 },
      { top: 1, right: 2, bottom: 3, left: 4 }
    );

    expect(rect).toEqual({ x: 14, y: 11, width: 14, height: 16 });
  });

  it("collapses rather than inverting when the inset is larger than the frame", () => {
    const rect = insetRect(
      { x: 0, y: 0, width: 10, height: 10 },
      { top: 99, right: 99, bottom: 99, left: 99 }
    );

    expect(rect.width).toBe(1);
    expect(rect.height).toBe(1);
  });
});

describe("frameSettings", () => {
  it("puts the frame rectangle in front as a crop", () => {
    const settings = frameSettings(DEFAULT_PROCESSING, sequence(), frame("b", 20));

    expect(settings.edits[0]).toEqual({ kind: "crop", x: 20, y: 0, width: 20, height: 20 });
  });

  it("forces trim off, because the rectangle is the registration", () => {
    expect(DEFAULT_PROCESSING.trimToContent).toBe(true);

    const settings = frameSettings(DEFAULT_PROCESSING, sequence(), frame("a", 0));

    expect(settings.trimToContent).toBe(false);
  });

  it("applies the sequence inset to the rectangle", () => {
    const withInset = sequence({ inset: { top: 2, right: 2, bottom: 2, left: 2 } });
    const settings = frameSettings(DEFAULT_PROCESSING, withInset, frame("b", 20));

    expect(settings.edits[0]).toEqual({ kind: "crop", x: 22, y: 2, width: 16, height: 16 });
  });

  it("keeps per-frame edits after the rectangle", () => {
    const cropped: SequenceFrame = {
      ...frame("a", 0),
      edits: [{ kind: "crop", x: 1, y: 1, width: 5, height: 5 }]
    };

    const settings = frameSettings(DEFAULT_PROCESSING, sequence(), cropped);

    expect(settings.edits).toHaveLength(2);
    expect(settings.edits[1]).toEqual({ kind: "crop", x: 1, y: 1, width: 5, height: 5 });
  });

  it("drops sheet-level edits so a sheet crop cannot shift every frame", () => {
    const base = {
      ...DEFAULT_PROCESSING,
      edits: [{ kind: "crop" as const, x: 100, y: 100, width: 10, height: 10 }]
    };

    const settings = frameSettings(base, sequence(), frame("a", 0));

    expect(settings.edits).toEqual([{ kind: "crop", x: 0, y: 0, width: 20, height: 20 }]);
  });

  it("leaves every other processing setting alone", () => {
    const base = { ...DEFAULT_PROCESSING, paletteId: "pal", targetSize: { width: 0, height: 32 } };
    const settings = frameSettings(base, sequence(), frame("a", 0));

    expect(settings.paletteId).toBe("pal");
    expect(settings.targetSize).toEqual({ width: 0, height: 32 });
  });
});

describe("totalTicks", () => {
  it("sums the holds for a loop", () => {
    expect(totalTicks(sequence())).toBe(4);
    expect(totalTicks(sequence({ frames: [frame("a", 0, 3), frame("b", 20, 2)] }))).toBe(5);
  });

  it("does not repeat the endpoints of a ping-pong", () => {
    // 0 1 2 3 2 1, not 0 1 2 3 3 2 1 0.
    expect(totalTicks(sequence({ playback: "pingPong" }))).toBe(6);
  });

  it("treats a two-frame ping-pong as a plain loop", () => {
    const two = sequence({ playback: "pingPong", frames: [frame("a", 0), frame("b", 20)] });

    expect(totalTicks(two)).toBe(2);
  });
});

describe("firstTickOfIndex", () => {
  it("accounts for the holds before the frame", () => {
    const seq = sequence({ frames: [frame("a", 0, 3), frame("b", 20, 2), frame("c", 40)] });

    expect(firstTickOfIndex(seq, 0)).toBe(0);
    expect(firstTickOfIndex(seq, 1)).toBe(3);
    expect(firstTickOfIndex(seq, 2)).toBe(5);
  });

  it("agrees with frameIndexAtTick, so resuming lands on the same frame", () => {
    for (const playback of ["loop", "pingPong", "once"] as const) {
      const seq = sequence({ playback, frames: [frame("a", 0, 2), frame("b", 20), frame("c", 40, 3)] });

      for (let index = 0; index < seq.frames.length; index++) {
        expect(frameIndexAtTick(seq, firstTickOfIndex(seq, index)), `${playback} ${index}`).toBe(index);
      }
    }
  });
});

describe("playbackOrder", () => {
  it("is a plain walk for a loop", () => {
    expect(playbackOrder(sequence())).toEqual([0, 1, 2, 3]);
  });

  it("turns around without repeating the endpoints", () => {
    expect(playbackOrder(sequence({ playback: "pingPong" }))).toEqual([0, 1, 2, 3, 2, 1]);
  });
});

describe("frameIndexAtTick", () => {
  it("advances one frame per tick and wraps", () => {
    const seq = sequence();
    const seen = [0, 1, 2, 3, 4, 5].map((tick) => frameIndexAtTick(seq, tick));

    expect(seen).toEqual([0, 1, 2, 3, 0, 1]);
  });

  it("holds a frame for its hold count", () => {
    const seq = sequence({ frames: [frame("a", 0, 3), frame("b", 20, 1)] });
    const seen = [0, 1, 2, 3, 4].map((tick) => frameIndexAtTick(seq, tick));

    expect(seen).toEqual([0, 0, 0, 1, 0]);
  });

  it("walks back down for a ping-pong", () => {
    const seq = sequence({ playback: "pingPong" });
    const seen = [0, 1, 2, 3, 4, 5, 6].map((tick) => frameIndexAtTick(seq, tick));

    expect(seen).toEqual([0, 1, 2, 3, 2, 1, 0]);
  });

  it("stops on the last frame when playing once", () => {
    const seq = sequence({ playback: "once" });

    expect(frameIndexAtTick(seq, 3)).toBe(3);
    expect(frameIndexAtTick(seq, 40)).toBe(3);
  });

  it("handles a negative tick without going out of bounds", () => {
    expect(frameIndexAtTick(sequence(), -1)).toBe(3);
  });

  it("returns zero for a sequence with no frames", () => {
    expect(frameIndexAtTick(sequence({ frames: [] }), 5)).toBe(0);
  });
});
