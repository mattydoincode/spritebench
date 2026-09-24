import { DEFAULT_PROCESSING, type ProcessingSettings } from "@/core/settings";
import { SHEET_SUPERSAMPLE } from "./animationPrompt";
import {
  composePrompt,
  DEFAULT_GENERATION,
  type BaseSpec,
  type GenerationParams,
  type JobInputs,
  type MaskSpec,
  type PromptSpec,
  type SequencePlan
} from "./model";

export interface RestoredAnimation {
  enabled: boolean;
  actions: { name: string; frames: number }[];
  cellSize: number;
}

export interface RestoredItemGrid {
  enabled: boolean;
  columns: number;
  rows: number;
  cellSize: number;
}

export interface RestoredLoop {
  enabled: boolean;
  steps: number;
  sendStart: boolean;
  includeStart: boolean;
}

export interface RestoredChunk {
  enabled: boolean;
  columns: number;
  rows: number;
}

export interface RestoredEach {
  enabled: boolean;
}

export interface RestoredGeneration {
  promptBody: string;
  bases: BaseSpec[];
  mask: MaskSpec | null;
  animation: RestoredAnimation;
  itemGrid: RestoredItemGrid;
  loop: RestoredLoop;
  chunk: RestoredChunk;
  each: RestoredEach;
  animateExpansions: boolean;
  folder: string;
  generation: GenerationParams;
  processing: ProcessingSettings;
}

export interface RestoreGenerationInput {
  prompt: PromptSpec;
  generation: GenerationParams;
  generatedWith: ProcessingSettings;
  inputs: JobInputs | null;
  sequencePlan: SequencePlan | null;
  folder?: string;
}

const DEFAULT_ANIMATION: RestoredAnimation = {
  enabled: false,
  actions: [
    { name: "idle", frames: 4 },
    { name: "walk", frames: 6 }
  ],
  cellSize: 64
};

const DEFAULT_ITEM_GRID: RestoredItemGrid = {
  enabled: false,
  columns: 4,
  rows: 4,
  cellSize: 64
};

const DEFAULT_LOOP: RestoredLoop = {
  enabled: false,
  steps: 4,
  sendStart: false,
  includeStart: false
};

const DEFAULT_CHUNK: RestoredChunk = {
  enabled: false,
  columns: 2,
  rows: 2
};

const DEFAULT_EACH: RestoredEach = {
  enabled: false
};

export function cellSizeFromPlan(
  plan: SequencePlan,
  generation: Pick<GenerationParams, "size">
): number {
  const sprite = plan.plate?.sprite;
  if (sprite && (sprite.width > 0 || sprite.height > 0)) {
    return Math.max(8, Math.floor(sprite.width || sprite.height));
  }

  const columns = Math.max(1, plan.columns);
  return Math.max(8, Math.floor(generation.size.width / columns / SHEET_SUPERSAMPLE));
}

function offModes(): Pick<RestoredGeneration, "animation" | "itemGrid" | "loop" | "chunk" | "each"> {
  return {
    animation: { ...DEFAULT_ANIMATION, actions: DEFAULT_ANIMATION.actions.map((entry) => ({ ...entry })) },
    itemGrid: { ...DEFAULT_ITEM_GRID },
    loop: { ...DEFAULT_LOOP },
    chunk: { ...DEFAULT_CHUNK },
    each: { ...DEFAULT_EACH }
  };
}

export function defaultGenerateSetup(model: string): RestoredGeneration {
  return {
    promptBody: "",
    bases: [],
    mask: null,
    ...offModes(),
    animateExpansions: false,
    folder: "",
    generation: { ...DEFAULT_GENERATION, model },
    processing: { ...DEFAULT_PROCESSING }
  };
}

export function restoreGeneration(asset: RestoreGenerationInput): RestoredGeneration {
  const inputs = asset.inputs;
  const plan = asset.sequencePlan;
  const modes = offModes();

  if (inputs?.loop) {
    modes.loop = {
      enabled: true,
      steps: Math.max(2, Math.floor(inputs.loop.steps) || 2),
      sendStart: Boolean(inputs.loop.sendStart),
      includeStart: Boolean(inputs.loop.includeStart)
    };
  } else if (inputs?.chunk) {
    modes.chunk = {
      enabled: true,
      columns: Math.max(1, Math.floor(inputs.chunk.columns) || 1),
      rows: Math.max(1, Math.floor(inputs.chunk.rows) || 1)
    };
  } else if (inputs?.each) {
    modes.each = { enabled: true };
  } else if (plan?.actions?.length) {
    const cellSize = cellSizeFromPlan(plan, asset.generation);
    if (plan.kind === "set") {
      modes.itemGrid = {
        enabled: true,
        columns: Math.max(1, plan.columns),
        rows: Math.max(1, plan.rows),
        cellSize
      };
    } else {
      modes.animation = {
        enabled: true,
        actions: plan.actions.map((entry) => ({
          name: entry.name,
          frames: Math.max(1, entry.frames)
        })),
        cellSize
      };
    }
  }

  const start = inputs?.start ?? inputs?.base ?? null;
  const bases = start ? [start] : [];

  return {
    promptBody: composePrompt(asset.prompt),
    bases,
    mask: inputs?.mask ?? null,
    ...modes,
    animateExpansions: Boolean(inputs?.animate),
    folder: asset.folder ?? "",
    generation: { ...DEFAULT_GENERATION, ...asset.generation },
    processing: { ...DEFAULT_PROCESSING, ...asset.generatedWith }
  };
}
