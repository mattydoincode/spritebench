import { describe, expect, it } from "vitest";
import { DEFAULT_GENERATION, isChunkSpec, isLoopSpec } from "@/shared/model";
import {
  InvalidInputsError,
  attachFanoutAnimation,
  chunkRects,
  isExpandingMultistep,
  nextLoopIndex,
  planFanout,
  shouldRememberGeneration,
  validateGenerateInputs
} from "@/shared/multistep";

const START = {
  base: {
    source: { kind: "asset" as const, assetId: "11111111-1111-1111-1111-111111111111" },
    fit: "contain" as const,
    matchAspect: true
  }
};

describe("chunkRects", () => {
  it("slices a tight grid in row-major order", () => {
    const rects = chunkRects({ width: 64, height: 32 }, 2, 2);
    expect(rects).toEqual([
      { x: 0, y: 0, width: 32, height: 16 },
      { x: 32, y: 0, width: 32, height: 16 },
      { x: 0, y: 16, width: 32, height: 16 },
      { x: 32, y: 16, width: 32, height: 16 }
    ]);
  });

  it("keeps leftover pixels on the last cell of an uneven grid", () => {
    const rects = chunkRects({ width: 64, height: 32 }, 3, 2);
    expect(rects).toHaveLength(6);
    expect(rects[0]).toEqual({ x: 0, y: 0, width: 21, height: 16 });
    expect(rects[2]).toEqual({ x: 43, y: 0, width: 21, height: 16 });
    expect(rects[2].x + rects[2].width).toBe(64);
    expect(rects[5].y + rects[5].height).toBe(32);
  });
});

describe("planFanout", () => {
  it("keeps stills as one group of batch copies, all dispatched", () => {
    const [group] = planFanout({
      generation: DEFAULT_GENERATION,
      inputs: { base: START.base },
      batches: 3
    });

    expect(group.rows).toHaveLength(3);
    expect(group.rows.every((row) => row.dispatch && row.status === "queued")).toBe(true);
    expect(group.rows.map((row) => row.batchIndex)).toEqual([1, 2, 3]);
  });

  it("keeps the each flag on still jobs", () => {
    const [group] = planFanout({
      generation: DEFAULT_GENERATION,
      inputs: { base: START.base, each: true },
      batches: 2
    });

    expect(group.rows).toHaveLength(2);
    expect(group.rows.every((row) => row.inputs?.each === true)).toBe(true);
    expect(group.rows.every((row) => row.inputs?.base)).toBeTruthy();
  });

  it("inserts a loop chain: first queued, the rest blocked", () => {
    const groups = planFanout({
      generation: { ...DEFAULT_GENERATION, imageCount: 4 },
      inputs: { ...START, loop: { steps: 4 } },
      batches: 1
    });

    expect(groups).toHaveLength(1);
    expect(groups[0].rows).toHaveLength(4);
    expect(groups[0].rows.map((row) => row.status)).toEqual(["queued", "blocked", "blocked", "blocked"]);
    expect(groups[0].rows.map((row) => row.dispatch)).toEqual([true, false, false, false]);
    expect(groups[0].rows.every((row) => row.generation.imageCount === 1)).toBe(true);
    expect(groups[0].rows[2].inputs?.loop).toEqual({ steps: 4, index: 3 });
    expect(groups[0].rows[2].inputs?.start).toEqual(START.base);
  });

  it("copies sendStart and includeStart onto every step", () => {
    const groups = planFanout({
      generation: DEFAULT_GENERATION,
      inputs: { ...START, loop: { steps: 3, sendStart: true, includeStart: true } },
      batches: 1
    });

    expect(groups[0].rows.map((row) => row.inputs?.loop)).toEqual([
      { steps: 3, index: 1, sendStart: true, includeStart: true },
      { steps: 3, index: 2, sendStart: true, includeStart: true },
      { steps: 3, index: 3, sendStart: true, includeStart: true }
    ]);
    expect(groups[0].rows[0].inputs?.start).toEqual(START.base);
  });

  it("gives each loop batch copy its own chain", () => {
    const groups = planFanout({
      generation: DEFAULT_GENERATION,
      inputs: { ...START, loop: { steps: 3 } },
      batches: 2
    });

    expect(groups).toHaveLength(2);
    expect(groups[0].rows).toHaveLength(3);
    expect(groups[1].rows[0].dispatch).toBe(true);
    expect(groups[1].rows[1].dispatch).toBe(false);
  });

  it("dispatches every chunk cell immediately", () => {
    const groups = planFanout({
      generation: DEFAULT_GENERATION,
      inputs: { ...START, chunk: { columns: 2, rows: 2 } },
      batches: 1,
      originSize: { width: 64, height: 64 }
    });

    expect(groups).toHaveLength(1);
    expect(groups[0].rows).toHaveLength(4);
    expect(groups[0].rows.every((row) => row.dispatch && row.status === "queued")).toBe(true);
    expect(groups[0].rows[0].inputs?.chunk).toMatchObject({
      columns: 2,
      rows: 2,
      index: 0,
      rect: { x: 0, y: 0, width: 32, height: 32 }
    });
    expect(groups[0].rows[3].inputs?.chunk).toMatchObject({
      index: 3,
      rect: { x: 32, y: 32, width: 32, height: 32 }
    });
  });

  it("refuses a chunk without an origin size", () => {
    expect(() =>
      planFanout({
        generation: DEFAULT_GENERATION,
        inputs: { ...START, chunk: { columns: 2, rows: 2 } },
        batches: 1
      })
    ).toThrow(InvalidInputsError);
  });

  it("refuses a loop without a starting asset", () => {
    expect(() =>
      planFanout({
        generation: DEFAULT_GENERATION,
        inputs: { loop: { steps: 3 } },
        batches: 1
      })
    ).toThrow(/starting image/);
  });

  it("replays a concrete loop step as a single job", () => {
    const groups = planFanout({
      generation: DEFAULT_GENERATION,
      inputs: { ...START, loop: { steps: 5, index: 3 } },
      batches: 4
    });

    expect(groups).toHaveLength(1);
    expect(groups[0].rows).toHaveLength(1);
    expect(groups[0].rows[0].dispatch).toBe(true);
    expect(groups[0].rows[0].inputs?.loop).toEqual({ steps: 5, index: 3 });
  });
});

describe("isLoopSpec / isChunkSpec", () => {
  it("treats a missing or non-numeric index as a request still to expand", () => {
    expect(isLoopSpec({ steps: 4 })).toBe(false);
    expect(isLoopSpec({ steps: 4, index: undefined as unknown as number })).toBe(false);
    expect(isLoopSpec({ steps: 4, index: 2 })).toBe(true);
    expect(isExpandingMultistep({ loop: { steps: 4, index: undefined as unknown as number } })).toBe(true);
  });

  it("needs a rect before a chunk is concrete", () => {
    expect(isChunkSpec({ columns: 2, rows: 2 })).toBe(false);
    expect(
      isChunkSpec({ columns: 2, rows: 2, index: 0, rect: { x: 0, y: 0, width: 8, height: 8 } })
    ).toBe(true);
    expect(isExpandingMultistep({ chunk: { columns: 2, rows: 2 } })).toBe(true);
  });
});

describe("validateGenerateInputs", () => {
  it("rejects loop and chunk together, or either with a sheet", () => {
    expect(() =>
      validateGenerateInputs({
        inputs: { ...START, loop: { steps: 3 }, chunk: { columns: 2, rows: 2 } }
      })
    ).toThrow(/cannot run in the same request/);

    expect(() =>
      validateGenerateInputs({
        inputs: { ...START, loop: { steps: 3 } },
        sequencePlan: { columns: 4, rows: 1, fps: 8, actions: [{ name: "walk", frames: 3 }] }
      })
    ).toThrow(/cannot run with a sheet/);
  });

  it("rejects an expanding loop without an asset start", () => {
    expect(() => validateGenerateInputs({ inputs: { loop: { steps: 3 } } })).toThrow(/starting image/);
    expect(() =>
      validateGenerateInputs({
        inputs: {
          base: { source: { kind: "template", templateId: "t1" }, fit: "contain", matchAspect: true },
          loop: { steps: 3 }
        }
      })
    ).toThrow(/starting image/);
  });

  it("rejects a template in a loop start list", () => {
    expect(() =>
      validateGenerateInputs({
        inputs: { loop: { steps: 3 } },
        bases: [
          START.base,
          {
            source: { kind: "template", templateId: "t1" },
            fit: "contain",
            matchAspect: true
          }
        ]
      })
    ).toThrow(/starting image/);
  });

  it("accepts several starting assets on the request", () => {
    expect(() =>
      validateGenerateInputs({
        inputs: { loop: { steps: 3 } },
        bases: [
          START.base,
          {
            source: { kind: "asset", assetId: "22222222-2222-2222-2222-222222222222" },
            fit: "contain",
            matchAspect: true
          }
        ]
      })
    ).not.toThrow();
  });

  it("rejects each without images, or with loop or a sheet", () => {
    expect(() => validateGenerateInputs({ inputs: { each: true } })).toThrow(/add images/);

    expect(() =>
      validateGenerateInputs({
        inputs: { ...START, each: true, loop: { steps: 3 } }
      })
    ).toThrow(/each cannot run with loop/);

    expect(() =>
      validateGenerateInputs({
        inputs: { ...START, each: true },
        sequencePlan: { columns: 4, rows: 1, fps: 8, actions: [{ name: "walk", frames: 3 }] }
      })
    ).toThrow(/each cannot run with a sheet/);
  });

  it("accepts each with a template or asset start", () => {
    expect(() =>
      validateGenerateInputs({
        inputs: { each: true },
        bases: [
          {
            source: { kind: "template", templateId: "t1" },
            fit: "contain",
            matchAspect: true
          },
          START.base
        ]
      })
    ).not.toThrow();
  });

  it("lets a concrete replay through without a start check", () => {
    expect(() =>
      validateGenerateInputs({
        inputs: { loop: { steps: 3, index: 2 } }
      })
    ).not.toThrow();
  });
});

describe("shouldRememberGeneration", () => {
  it("skips the write when a sheet, loop, or chunk pinned the request", () => {
    expect(shouldRememberGeneration({})).toBe(true);
    expect(shouldRememberGeneration({ sheet: true })).toBe(false);
    expect(shouldRememberGeneration({ loop: true })).toBe(false);
    expect(shouldRememberGeneration({ chunk: true })).toBe(false);
    expect(shouldRememberGeneration({ animate: true })).toBe(false);
    expect(shouldRememberGeneration({ remember: false })).toBe(false);
  });
});

describe("attachFanoutAnimation", () => {
  it("tags stills with one id per batch copy and the expansion as the frame", () => {
    const planned = [
      planFanout({ generation: DEFAULT_GENERATION, inputs: {}, batches: 2 }),
      planFanout({
        generation: { ...DEFAULT_GENERATION, imageCount: 3 },
        inputs: {},
        batches: 2
      })
    ];
    const tagged = attachFanoutAnimation(planned, true);
    const first = tagged[0][0].rows;
    const second = tagged[1][0].rows;

    expect(first[0].inputs?.animate).toMatchObject({ index: 0, count: 2 });
    expect(second[0].inputs?.animate).toMatchObject({ index: 1, count: 2 });
    expect(first[0].inputs?.animate?.id).toBe(second[0].inputs?.animate?.id);
    expect(first[1].inputs?.animate?.id).toBe(second[1].inputs?.animate?.id);
    expect(first[0].inputs?.animate?.id).not.toBe(first[1].inputs?.animate?.id);
    expect(first.every((row) => row.generation.imageCount === 1)).toBe(true);
  });

  it("leaves loop rows alone", () => {
    const planned = [
      planFanout({
        generation: DEFAULT_GENERATION,
        inputs: { ...START, loop: { steps: 2 } },
        batches: 1
      }),
      planFanout({
        generation: DEFAULT_GENERATION,
        inputs: { ...START, loop: { steps: 2 } },
        batches: 1
      })
    ];

    expect(attachFanoutAnimation(planned, true)[0][0].rows[0].inputs?.animate).toBeUndefined();
  });

  it("is a no-op when disabled or there is only one expansion", () => {
    const planned = [planFanout({ generation: DEFAULT_GENERATION, inputs: {}, batches: 1 })];
    expect(attachFanoutAnimation(planned, true)).toBe(planned);
    expect(attachFanoutAnimation([planned[0], planned[0]], false)).toEqual([
      planned[0],
      planned[0]
    ]);
  });
});

describe("nextLoopIndex", () => {
  it("advances until the last step", () => {
    expect(nextLoopIndex({ loop: { steps: 3, index: 1 } })).toBe(2);
    expect(nextLoopIndex({ loop: { steps: 3, index: 3 } })).toBeNull();
    expect(nextLoopIndex({ loop: { steps: 3 } })).toBeNull();
  });
});
