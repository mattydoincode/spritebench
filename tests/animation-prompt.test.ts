import { describe, expect, it } from "vitest";
import {
  actionGrid,
  animationPromptBody,
  gridInstructions,
  itemGridPromptBody,
  planAnimation,
  planItemGrid,
  sequencesFromPlan
} from "@/shared/animationPrompt";
import { isValidFlexibleSize } from "@/core/size";
import type { SequencePlan } from "@/shared/model";

function ids() {
  let n = 0;
  return () => `id-${n++}`;
}

const trio = [
  { name: "idle", frames: 2 },
  { name: "run", frames: 4 },
  { name: "attack", frames: 3 }
];

describe("actionGrid", () => {
  it("is one row per action and columns equal the longest cycle", () => {
    expect(actionGrid(trio)).toEqual({ columns: 4, rows: 3 });
  });

  it("pads an 8-frame strip so the aspect is legal", () => {
    const shape = actionGrid([{ name: "walk", frames: 8 }]);

    expect(shape.columns).toBe(8);
    expect(shape.rows).toBeGreaterThanOrEqual(3);
    expect(Math.max(shape.columns / shape.rows, shape.rows / shape.columns)).toBeLessThanOrEqual(3);
  });
});

describe("gridInstructions", () => {
  const text = gridInstructions(trio, 4, 3);

  it("names each row and its leftover cells", () => {
    expect(text).toContain('Row 1 is "idle": 2 consecutive frames');
    expect(text).toContain("The last 2 cells of this row are covered");
    expect(text).toContain('Row 2 is "run": 4 consecutive frames');
    expect(text).toContain('Row 3 is "attack": 3 consecutive frames');
    expect(text).toContain("The last 1 cell of this row is covered");
  });

  it("mentions padded rows when the aspect force-adds them", () => {
    expect(gridInstructions([{ name: "walk", frames: 8 }], 8, 3)).toContain("bottom 2 rows");
  });
});

describe("planAnimation", () => {
  it("asks for a canvas the provider will accept", () => {
    const { sheet } = planAnimation({ subject: "a knight", actions: trio, cellSize: 64 });

    expect(isValidFlexibleSize(sheet.size)).toBe(true);
    expect(sheet.columns).toBe(4);
    expect(sheet.rows).toBe(3);
    expect(sheet.spare).toBe(3);
  });

  it("records one plan action per table row", () => {
    const { plan } = planAnimation({
      subject: "a knight",
      actions: [
        { name: "  idle  ", frames: 2 },
        { name: "run", frames: 4 }
      ],
      cellSize: 64
    });

    expect(plan.actions).toEqual([
      { name: "idle", frames: 2 },
      { name: "run", frames: 4 }
    ]);
  });

  it("generates well above the sprite size", () => {
    const { sheet } = planAnimation({
      subject: "a knight",
      actions: [{ name: "walk", frames: 4 }],
      cellSize: 64
    });

    expect(sheet.cell).toBeGreaterThanOrEqual(64 * 4);
  });
});

describe("animationPromptBody", () => {
  it("leads with the subject", () => {
    const body = animationPromptBody({
      subject: "a rusty knight in plate armour",
      actions: trio,
      cellSize: 64
    });

    expect(body.startsWith("a rusty knight in plate armour")).toBe(true);
    expect(body).toContain("sprite sheet");
  });
});

describe("planItemGrid", () => {
  it("asks for a legal canvas and records a set plan", () => {
    const { plan, sheet } = planItemGrid({
      subject: "things on a city street",
      columns: 4,
      rows: 3,
      cellSize: 64
    });

    expect(isValidFlexibleSize(sheet.size)).toBe(true);
    expect(plan.kind).toBe("set");
    expect(plan.actions).toHaveLength(3);
    expect(plan.actions.every((entry) => entry.frames === 4)).toBe(true);
    expect(sheet.spare).toBe(0);
  });

  it("masks leftover cells when aspect padding is needed", () => {
    const { plan, sheet } = planItemGrid({
      subject: "signs",
      columns: 8,
      rows: 1,
      cellSize: 32
    });

    expect(sheet.rows).toBeGreaterThan(1);
    expect(sheet.spare).toBeGreaterThan(0);
    expect(plan.actions).toEqual([{ name: "items", frames: 8 }]);
  });
});

describe("itemGridPromptBody", () => {
  it("asks for distinct objects, not one character in poses", () => {
    const body = itemGridPromptBody({
      subject: "things you would find on a city street",
      columns: 4,
      rows: 4,
      cellSize: 64
    });

    expect(body.startsWith("things you would find on a city street")).toBe(true);
    expect(body).toContain("different object");
    expect(body).not.toContain("Only the pose changes");
  });
});

describe("sequencesFromPlan", () => {
  const plan: SequencePlan = {
    columns: 4,
    rows: 3,
    fps: 12,
    actions: trio
  };

  it("makes one sequence per action, using that row's cells", () => {
    const sequences = sequencesFromPlan("sheet", { width: 400, height: 300 }, plan, ids());

    expect(sequences.map((entry) => [entry.name, entry.frames.length])).toEqual([
      ["idle", 2],
      ["run", 4],
      ["attack", 3]
    ]);

    expect(sequences[0].frames[0].rect).toEqual({ x: 0, y: 0, width: 100, height: 100 });
    expect(sequences[1].frames[0].rect).toEqual({ x: 0, y: 100, width: 100, height: 100 });
    expect(sequences[2].frames[2].rect).toEqual({ x: 200, y: 200, width: 100, height: 100 });
  });

  it("does not invent frames for masked cells", () => {
    const sequences = sequencesFromPlan("sheet", { width: 400, height: 300 }, plan, ids());

    expect(sequences[0].frames).toHaveLength(2);
    expect(sequences[0].frames[1].rect.x).toBe(100);
  });

  it("points every frame at the sheet it came from", () => {
    const sequences = sequencesFromPlan("sheet-9", { width: 400, height: 300 }, plan, ids());

    expect(sequences.every((seq) => seq.frames.every((frame) => frame.sourceAssetId === "sheet-9"))).toBe(
      true
    );
  });

  it("round-trips a real plan", () => {
    const { plan: generated, sheet } = planAnimation({
      subject: "a knight",
      actions: trio,
      cellSize: 64
    });

    const sequences = sequencesFromPlan("sheet", sheet.size, generated, ids());

    expect(sequences).toHaveLength(3);
    expect(sequences.every((entry) => entry.kind === "animation")).toBe(true);
    expect(sequences[1].frames).toHaveLength(4);
    for (const frame of sequences.flatMap((entry) => entry.frames)) {
      expect(frame.rect.width).toBe(sheet.cell);
      expect(frame.rect.x + frame.rect.width).toBeLessThanOrEqual(sheet.size.width);
    }
  });

  it("flattens a set plan into one items sequence, row-major", () => {
    const { plan, sheet } = planItemGrid({
      subject: "street things",
      columns: 4,
      rows: 3,
      cellSize: 64
    });
    const [sequence] = sequencesFromPlan("sheet", sheet.size, plan, ids());

    expect(sequence.kind).toBe("set");
    expect(sequence.name).toBe("items");
    expect(sequence.frames).toHaveLength(12);
    expect(sequence.frames[0].rect).toEqual({ x: 0, y: 0, width: sheet.cell, height: sheet.cell });
    expect(sequence.frames[4].rect).toEqual({
      x: 0,
      y: sheet.cell,
      width: sheet.cell,
      height: sheet.cell
    });
  });
});
