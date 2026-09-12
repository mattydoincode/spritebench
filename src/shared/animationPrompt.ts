import { padGridForAspect, planSheetRequestForGrid, type SheetRequest } from "@/core/sheet";
import { cellUsed, sliceGrid } from "@/core/slice";
import type { Size } from "@/core/types";
import type { SequencePlan, SequencePlanAction } from "./model";
import { DEFAULT_FPS, SET_FPS, clampFps, type Sequence } from "./sequence";

/**
 * Turning a table of actions into one gridded request.
 *
 * One row per action, columns = the longest cycle. Unused cells -- a 2-frame
 * idle sitting next to a 4-frame walk, or empty rows added so the canvas
 * aspect is legal -- are masked so the model cannot fill them with companions.
 */

export interface AnimationRequest {
  /** What the character or object is. The ordinary prompt body. */
  subject: string;
  actions: SequencePlanAction[];
  /** Intended final sprite size, used only to cap what is generated. */
  cellSize: number;
}

const SUPERSAMPLE = 4;

export interface AnimationGeneration {
  plan: SequencePlan;
  sheet: SheetRequest;
  instructions: string;
}

export function normalizeActions(raw: SequencePlanAction[]): SequencePlanAction[] {
  const source = raw.length > 0 ? raw : [{ name: "animation", frames: 4 }];

  return source.map((entry, index) => ({
    name: entry.name.trim() || (index === 0 ? "animation" : `animation ${index + 1}`),
    frames: Math.max(1, Math.min(32, Math.floor(entry.frames) || 1))
  }));
}

export function actionGrid(actions: SequencePlanAction[]): { columns: number; rows: number } {
  const cleaned = normalizeActions(actions);
  const columns = Math.max(1, ...cleaned.map((entry) => entry.frames));
  return padGridForAspect(columns, cleaned.length);
}

export function gridInstructions(actions: SequencePlanAction[], columns: number, rows: number): string {
  const cleaned = normalizeActions(actions);

  const lines = [
    `Draw a ${columns} by ${rows} sprite sheet: equal cells in a strict grid, one action per row, frames left to right.`,
    "Exactly one character per used cell. Covered cells are masked out -- leave them empty, do not draw anything there.",
    "Keep the character identical across the whole sheet: same design, same colours, same proportions, same line weight. Only the pose changes.",
    "Draw the character at the same scale in every used cell, centred horizontally, standing on the same baseline, so the frames of one row line up when played.",
    "Transparent background. No grid lines, borders, gutters, drop shadows, ground shadows, frame numbers, labels or captions anywhere in the image."
  ];

  for (const [index, action] of cleaned.entries()) {
    const leftover = columns - action.frames;
    const row = `Row ${index + 1} is "${action.name}": ${action.frames} consecutive frames of that cycle.`;
    lines.push(
      leftover > 0
        ? `${row} The last ${leftover} cell${leftover === 1 ? "" : "s"} of this row ${
            leftover === 1 ? "is" : "are"
          } covered -- leave ${leftover === 1 ? "it" : "them"} empty.`
        : row
    );
  }

  if (rows > cleaned.length) {
    const extra = rows - cleaned.length;
    lines.push(
      `The bottom ${extra} row${extra === 1 ? "" : "s"} ${extra === 1 ? "is" : "are"} covered padding. Leave ${
        extra === 1 ? "it" : "them"
      } completely empty.`
    );
  }

  return lines.join(" ");
}

export function planAnimation(request: AnimationRequest): AnimationGeneration {
  const actions = normalizeActions(request.actions);
  const cellSize = Math.max(8, Math.floor(request.cellSize));
  const shape = actionGrid(actions);
  const sheet = planSheetRequestForGrid(shape, cellSize * SUPERSAMPLE);
  const used = actions.reduce((sum, entry) => sum + entry.frames, 0);

  return {
    sheet: { ...sheet, spare: sheet.columns * sheet.rows - used },
    plan: {
      kind: "animation",
      columns: sheet.columns,
      rows: sheet.rows,
      fps: DEFAULT_FPS,
      actions
    },
    instructions: gridInstructions(actions, sheet.columns, sheet.rows)
  };
}

export function animationPromptBody(request: AnimationRequest): string {
  const subject = request.subject.trim();
  const { instructions } = planAnimation(request);

  return subject ? `${subject}\n\n${instructions}` : instructions;
}

export interface ItemGridRequest {
  subject: string;
  columns: number;
  rows: number;
  cellSize: number;
}

export function clampGridAxis(value: number): number {
  return Math.max(1, Math.min(32, Math.floor(value) || 1));
}

export function itemGridInstructions(
  contentColumns: number,
  contentRows: number,
  columns: number,
  rows: number
): string {
  const lines = [
    `Draw a ${columns} by ${rows} sprite sheet: equal cells in a strict grid.`,
    "Each used cell is a different object matching the subject. Do not repeat the same object.",
    "Exactly one object per used cell, centred, same style, same scale, same lighting across the sheet.",
    "Covered cells are masked out -- leave them empty, do not draw anything there.",
    "Transparent background. No grid lines, borders, gutters, drop shadows, ground shadows, frame numbers, labels or captions anywhere in the image."
  ];

  if (columns !== contentColumns || rows !== contentRows) {
    const spare = columns * rows - contentColumns * contentRows;
    lines.push(
      `Only the first ${contentRows} row${contentRows === 1 ? "" : "s"} and ${contentColumns} column${
        contentColumns === 1 ? "" : "s"
      } are used (${contentColumns * contentRows} objects). The remaining ${spare} cell${
        spare === 1 ? "" : "s"
      } ${spare === 1 ? "is" : "are"} covered padding -- leave ${spare === 1 ? "it" : "them"} empty.`
    );
  }

  return lines.join(" ");
}

export function planItemGrid(request: ItemGridRequest): AnimationGeneration {
  const columns = clampGridAxis(request.columns);
  const rows = clampGridAxis(request.rows);
  const cellSize = Math.max(8, Math.floor(request.cellSize));
  const shape = padGridForAspect(columns, rows);
  const sheet = planSheetRequestForGrid(shape, cellSize * SUPERSAMPLE);
  const actions: SequencePlanAction[] = Array.from({ length: rows }, (_, index) => ({
    name: rows === 1 ? "items" : `row ${index + 1}`,
    frames: columns
  }));

  return {
    sheet: { ...sheet, spare: sheet.columns * sheet.rows - columns * rows },
    plan: {
      kind: "set",
      columns: sheet.columns,
      rows: sheet.rows,
      fps: SET_FPS,
      actions
    },
    instructions: itemGridInstructions(columns, rows, sheet.columns, sheet.rows)
  };
}

export function itemGridPromptBody(request: ItemGridRequest): string {
  const subject = request.subject.trim();
  const { instructions } = planItemGrid(request);

  return subject ? `${subject}\n\n${instructions}` : instructions;
}

/**
 * One sequence per action, rectangles taken from that action's row.
 *
 * No pixels required -- the canvas is the size that was asked for -- so this
 * can run the moment the asset row arrives.
 */
export function sequencesFromPlan(
  assetId: string,
  size: Size,
  plan: SequencePlan,
  newId: () => string
): Sequence[] {
  const actions = normalizeActions(plan.actions ?? []);
  const columns = Math.max(1, plan.columns);
  const rows = Math.max(actions.length, plan.rows);
  const rects = sliceGrid(size, {
    columns,
    rows,
    marginX: 0,
    marginY: 0,
    spacingX: 0,
    spacingY: 0
  });

  const frameAt = (row: number, column: number) => ({
    id: newId(),
    sourceAssetId: assetId,
    rect: rects[row * columns + column] ?? { x: 0, y: 0, width: 1, height: 1 },
    edits: [],
    hold: 1
  });

  if (plan.kind === "set") {
    const frames = [];

    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        if (cellUsed(row, column, actions)) frames.push(frameAt(row, column));
      }
    }

    return [
      {
        id: newId(),
        name: "items",
        kind: "set" as const,
        fps: clampFps(plan.fps || SET_FPS),
        playback: "loop" as const,
        inset: { top: 0, right: 0, bottom: 0, left: 0 },
        frames
      }
    ];
  }

  return actions.map((action, row) => ({
    id: newId(),
    name: action.name,
    kind: "animation" as const,
    fps: clampFps(plan.fps || DEFAULT_FPS),
    playback: "loop" as const,
    inset: { top: 0, right: 0, bottom: 0, left: 0 },
    frames: Array.from({ length: action.frames }, (_, column) => frameAt(row, column)).filter(
      (_, column) => cellUsed(row, column, actions)
    )
  }));
}
