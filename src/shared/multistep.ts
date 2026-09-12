import { sliceGrid } from "@/core/slice";
import type { Rect, Size } from "@/core/types";
import { snapRequestSize } from "@/providers/models";
import {
  isChunkSpec,
  isLoopSpec,
  type GenerationParams,
  type JobInputs,
  type JobStatus,
  type SequencePlan
} from "./model";

/** Tight grid over the origin, no margin or gutter. */
export function chunkRects(size: Size, columns: number, rows: number): Rect[] {
  return sliceGrid(size, {
    columns,
    rows,
    marginX: 0,
    marginY: 0,
    spacingX: 0,
    spacingY: 0
  });
}

export interface PlannedRow {
  inputs: JobInputs | null;
  generation: GenerationParams;
  status: Extract<JobStatus, "queued" | "blocked">;
  dispatch: boolean;
  batchIndex: number;
  batchSize: number;
}

export interface PlannedGroup {
  rows: PlannedRow[];
}

export class InvalidInputsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidInputsError";
  }
}

export function isExpandingLoop(inputs: JobInputs | null | undefined): boolean {
  return Boolean(inputs?.loop && !isLoopSpec(inputs.loop));
}

export function isExpandingChunk(inputs: JobInputs | null | undefined): boolean {
  return Boolean(inputs?.chunk && !isChunkSpec(inputs.chunk));
}

export function isExpandingMultistep(inputs: JobInputs | null | undefined): boolean {
  return isExpandingLoop(inputs) || isExpandingChunk(inputs);
}

export function startingAssetId(inputs: JobInputs | null | undefined): string | null {
  const source = inputs?.base?.source;
  return source?.kind === "asset" ? source.assetId : null;
}

export function validateGenerateInputs(input: {
  inputs?: JobInputs | null;
  sequencePlan?: SequencePlan | null;
}): void {
  const inputs = input.inputs ?? null;
  const expandingLoop = isExpandingLoop(inputs);
  const expandingChunk = isExpandingChunk(inputs);

  if (expandingLoop && expandingChunk) {
    throw new InvalidInputsError("loop and chunk cannot run in the same request");
  }

  if ((expandingLoop || expandingChunk) && input.sequencePlan?.actions?.length) {
    throw new InvalidInputsError("loop and chunk cannot run with a sheet");
  }

  if ((expandingLoop || expandingChunk) && !startingAssetId(inputs)) {
    throw new InvalidInputsError("pick a starting image first");
  }
}

/** Sheets, loops, and chunks pin size or imageCount for one request only. */
export function shouldRememberGeneration(input: {
  remember?: boolean;
  sheet?: boolean;
  loop?: boolean;
  chunk?: boolean;
}): boolean {
  if (input.remember === false) return false;
  return !input.sheet && !input.loop && !input.chunk;
}

function requireStartingAsset(inputs: JobInputs | null): void {
  if (!startingAssetId(inputs)) throw new InvalidInputsError("pick a starting image first");
}

/**
 * Expands one prompt variant into the jobs it should insert.
 *
 * Stills stay one group of `batches` copies. Loop and chunk each get one
 * group per batch copy, so the jobs bar shows a chain or a grid, not a mix.
 *
 * A row that already has a loop index or chunk rect is a replay: one job,
 * no further fan-out.
 */
export function planFanout(input: {
  generation: GenerationParams;
  inputs?: JobInputs | null;
  batches: number;
  originSize?: Size | null;
}): PlannedGroup[] {
  const batches = Math.max(1, Math.min(20, Math.floor(input.batches)));
  const inputs = input.inputs ?? null;

  if (isLoopSpec(inputs?.loop) || isChunkSpec(inputs?.chunk)) {
    return [
      {
        rows: [
          {
            inputs,
            generation: { ...input.generation, imageCount: 1 },
            status: "queued",
            dispatch: true,
            batchIndex: 1,
            batchSize: 1
          }
        ]
      }
    ];
  }

  const loop = inputs?.loop;
  if (loop && "steps" in loop) {
    requireStartingAsset(inputs);
    const steps = Math.max(2, Math.min(20, Math.floor(loop.steps)));
    const generation = { ...input.generation, imageCount: 1 };

    return Array.from({ length: batches }, () => ({
      rows: Array.from({ length: steps }, (_, offset) => {
        const index = offset + 1;
        return {
          inputs: {
            base: inputs?.base ?? null,
            mask: inputs?.mask ?? null,
            loop: { steps, index }
          },
          generation,
          status: index === 1 ? ("queued" as const) : ("blocked" as const),
          dispatch: index === 1,
          batchIndex: index,
          batchSize: steps
        };
      })
    }));
  }

  const chunk = inputs?.chunk;
  if (chunk && "columns" in chunk) {
    requireStartingAsset(inputs);
    const columns = Math.max(1, Math.floor(chunk.columns));
    const rows = Math.max(1, Math.floor(chunk.rows));
    const origin = input.originSize;
    if (!origin) throw new InvalidInputsError("chunk jobs need a starting image");

    const rects = chunkRects(origin, columns, rows);
    if (rects.length === 0) throw new InvalidInputsError("that grid produced no cells");

    return Array.from({ length: batches }, () => ({
      rows: rects.map((rect, offset) => ({
        inputs: {
          base: inputs?.base ?? null,
          mask: inputs?.mask ?? null,
          chunk: { columns, rows, index: offset, rect }
        },
        generation: {
          ...input.generation,
          imageCount: 1,
          useAutoSize: false,
          size: snapRequestSize({ width: rect.width, height: rect.height }, input.generation.model)
        },
        status: "queued" as const,
        dispatch: true,
        batchIndex: offset + 1,
        batchSize: rects.length
      }))
    }));
  }

  const still = inputs?.base || inputs?.mask ? { base: inputs?.base ?? null, mask: inputs?.mask ?? null } : null;

  return [
    {
      rows: Array.from({ length: batches }, (_, offset) => ({
        inputs: still,
        generation: input.generation,
        status: "queued" as const,
        dispatch: true,
        batchIndex: offset + 1,
        batchSize: batches
      }))
    }
  ];
}

export function nextLoopIndex(inputs: JobInputs | null): number | null {
  const loop = inputs?.loop;
  if (!isLoopSpec(loop)) return null;
  return loop.index < loop.steps ? loop.index + 1 : null;
}
