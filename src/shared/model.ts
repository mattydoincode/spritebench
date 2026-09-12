import type { ProcessingSettings } from "@/core/settings";
import {
  DEFAULT_TERRAIN,
  emptyTiles,
  type TerrainGradientId,
  type TerrainTile
} from "@/core/terrain";
import type { DitherMode, MaskSource, Rect, Size, TemplateFitMode } from "@/core/types";
import type { AssetSet } from "./assetSet";
import type { Sequence } from "./sequence";

export const IMAGE_QUALITIES = ["auto", "low", "medium", "high", "xhigh", "max"] as const;
export type ImageQuality = (typeof IMAGE_QUALITIES)[number];
export type ImageBackground = "auto" | "transparent" | "opaque";
export type ImageModeration = "auto" | "low";

export interface GenerationParams {
  model: string;
  quality: ImageQuality;
  background: ImageBackground;
  moderation: ImageModeration;
  size: Size;
  useAutoSize: boolean;
  imageCount: number;
}

export const DEFAULT_GENERATION: GenerationParams = {
  model: "gpt-image-2.5-sunburst",
  quality: "auto",
  background: "transparent",
  moderation: "auto",
  size: { width: 1024, height: 1024 },
  useAutoSize: false,
  imageCount: 1
};

export interface PromptSpec {
  prefix: string;
  body: string;
  suffix: string;
  /**
   * Feature instructions prepended to the sent prompt (Gemini mask/reference
   * guides). Optional so older jobs still typecheck.
   */
  guide?: string;
  /** Feature instructions after the subject (iso, pixel constraint, sheets). */
  extra?: string;
}

export function composePrompt(prompt: PromptSpec): string {
  return [prompt.guide, prompt.prefix, prompt.body, prompt.extra, prompt.suffix]
    .map((part) => (part ?? "").trim())
    .filter((part) => part.length > 0)
    .join("\n\n");
}

export type ImageSource =
  | { kind: "template"; templateId: string }
  | { kind: "asset"; assetId: string };

export interface BaseSpec {
  source: ImageSource;
  fit: TemplateFitMode;
  matchAspect: boolean;
}

export interface MaskSpec {
  source: ImageSource;
  maskSource: MaskSource;
  dilatePixels: number;
  fit: TemplateFitMode;
  /** Cell count for `builtin:pixel-constraint` — the finished sprite size. */
  window?: Size;
}

export interface LoopSpec {
  steps: number;
  index: number;
}

export interface ChunkSpec {
  columns: number;
  rows: number;
  index: number;
  rect: Rect;
}

/**
 * What a job sent (or will send) as image inputs.
 *
 * `loop` / `chunk` without `index` / `rect` is a generate request still waiting
 * to be expanded. After enqueue every row has the concrete per-job fields.
 */
export interface JobInputs {
  base?: BaseSpec | null;
  mask?: MaskSpec | null;
  loop?: LoopSpec | { steps: number } | null;
  chunk?: ChunkSpec | { columns: number; rows: number } | null;
}

export function isLoopSpec(loop: JobInputs["loop"]): loop is LoopSpec {
  return loop != null && "index" in loop && typeof loop.index === "number";
}

export function isChunkSpec(chunk: JobInputs["chunk"]): chunk is ChunkSpec {
  return chunk != null && "rect" in chunk && chunk.rect != null;
}

/** Templates, starting images, and unused animation cells all go through images/edits. */
export function jobUsesEdit(job: {
  inputs?: JobInputs | null;
  sequencePlan?: SequencePlan | null;
}): boolean {
  return Boolean(
    job.inputs?.base ||
      job.inputs?.mask ||
      job.inputs?.loop ||
      job.inputs?.chunk ||
      job.sequencePlan?.actions?.length
  );
}

export function jobUsesMask(job: {
  inputs?: JobInputs | null;
  sequencePlan?: SequencePlan | null;
}): boolean {
  return Boolean(job.inputs?.mask || job.sequencePlan?.actions?.length);
}

/**
 * The grid an animation sheet was asked for.
 *
 * Provenance, not settings: it records the layout the prompt described, so the
 * client that receives the finished PNG can slice it without guessing. The
 * worker stores it and never reads it -- exactly like `JobInputs`.
 *
 * Once sliced, the resulting `Sequence` in the Yjs document is the truth. This
 * is only the seed, so re-slicing by hand is not fighting anything.
 */
/** One row on an animation sheet: a named cycle and how many cells it uses. */
export interface SequencePlanAction {
  name: string;
  frames: number;
}

/**
 * The grid an animation sheet was asked for.
 *
 * Provenance, not settings: it records the layout the prompt described, so the
 * client that receives the finished PNG can slice it without guessing. The
 * worker *does* read it, but only to punch a mask over unused cells -- the
 * resulting `Sequence`s in the Yjs document are the truth after that.
 */
export type SequenceKind = "animation" | "set";

export interface SequencePlan {
  columns: number;
  rows: number;
  fps: number;
  /**
   * `set` is one sequence of distinct cells (an item grid). Missing means
   * animation, which is one sequence per action row.
   */
  kind?: SequenceKind;
  /** Top to bottom, one cycle per row. Trailing cells on a short row are masked. */
  actions: SequencePlanAction[];
}

export interface TokenUsage {
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
}

/**
 * The provenance half of an asset: what the server generated and can prove.
 *
 * Deliberately carries no editable fields. The name, folder, tags, processing
 * settings and crops live in the project's Yjs document (`AssetEdits`), which
 * is what makes editing them collaborative and undoable. Merging the two
 * halves for display is `resolveAsset` in `src/shared/doc.ts`.
 */
export interface AssetRecord {
  id: string;
  /** Per-project number, allocated once. Shown as `001` when unnamed. */
  seq: number;
  createdAt: string;
  createdByUserId: string | null;
  sourceWidth: number;
  sourceHeight: number;
  prompt: PromptSpec;
  composedPrompt: string;
  generation: GenerationParams;
  /** The settings the image was generated under, for reference and rerun. */
  generatedWith: ProcessingSettings;
  /** Where the last approved export landed, if any. */
  exportPath: string | null;
  rerunOf: string | null;
  jobId: string | null;
  inputs: JobInputs | null;
  /** Set when this was generated as an animation sheet. */
  sequencePlan: SequencePlan | null;
  usage: TokenUsage | null;
  elapsedSeconds: number | null;
  /** False once the full-resolution source has been rolled off. */
  hasSource: boolean;
  /** When the source becomes eligible for roll-off, ISO 8601. */
  expiresAt: string | null;
}

export type JobStatus = "queued" | "blocked" | "running" | "done" | "error" | "cancelled";

export interface JobRecord {
  id: string;
  status: JobStatus;
  label: string;
  batchId: string | null;
  batchIndex: number;
  batchSize: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  /** Who pressed Generate. The owner's key paid for it either way. */
  userId: string | null;
  /** Which of the owner's keys paid. Null on the environment-key path. */
  providerKeyId: string | null;
  prompt: PromptSpec;
  composedPrompt: string;
  generation: GenerationParams;
  processing: ProcessingSettings;
  folder: string;
  inputs: JobInputs | null;
  sequencePlan: SequencePlan | null;
  rerunOf: string | null;
  assetIds: string[];
  resolvedSize: Size | null;
  error: string | null;
}

export interface StagedItem {
  id: string;
  assetId: string;
  x: number;
  y: number;
  footprint: Size;
  zIndex: number;
  flipHorizontal: boolean;
  flipVertical: boolean;
  /**
   * Quarter-turns in the 2:1 iso plane (world yaw). 0 is as-drawn, usually
   * SE. 1 turns that to NE. Missing reads as 0.
   */
  isoTurn: number;
  showSource: boolean;
  opacity: number;
  /**
   * When false the playground plays the chosen sequence. Missing on older
   * items, which is why the reader defaults it to false rather than true.
   */
  paused: boolean;
  /** Empty means the asset's first sequence. */
  sequenceId: string;
  /** Shown when paused. 0 is the first frame. */
  heldFrame: number;
  /**
   * How a set (item grid) draws on the scene. Missing means `cell`, so
   * existing animations keep playing a single frame.
   */
  display?: "sheet" | "cell";
  /** Degrees clockwise. 0 is upright. */
  rotation: number;
}

export const REPEATER_PLACEMENTS = ["grid", "iso", "scatter"] as const;
export type RepeaterPlacement = (typeof REPEATER_PLACEMENTS)[number];

export const REPEATER_PLACEMENT_LABELS: Record<RepeaterPlacement, string> = {
  grid: "grid",
  iso: "iso",
  scatter: "scatter"
};

export const REPEATER_ROTATES = ["none", "quarter", "flip", "free"] as const;
export type RepeaterRotate = (typeof REPEATER_ROTATES)[number];

export const REPEATER_ROTATE_LABELS: Record<RepeaterRotate, string> = {
  none: "none",
  quarter: "quarter turns",
  flip: "flips only",
  free: "any angle"
};

export const DEFAULT_REPEATER = {
  placement: "grid" as const,
  rotate: "none" as const,
  scatterCount: 16,
  areaWidth: 192,
  areaHeight: 192,
  scaleJitter: 0,
  minGap: 0,
  edgeBias: 0
};

const DEFAULT_REPEATER_COUNTS = { countX: 3, countY: 3 } as const;

/**
 * Same defaults as "+ repeater", but already holding this sprite and sitting
 * on its origin. Cell comes from the footprint so a resized sprite tiles at
 * the size you already picked, rather than snapping back to native pixels.
 */
export function repeaterFromItem(item: StagedItem, id: string, seed: number): RepeatGroup {
  const sized = item.footprint.width > 0 && item.footprint.height > 0;
  const cell = sized
    ? { width: item.footprint.width, height: item.footprint.height }
    : { width: 0, height: 0 };

  return {
    id,
    name: "",
    assetIds: [item.assetId],
    x: item.x,
    y: item.y,
    cell,
    marginX: 0,
    marginY: 0,
    ...DEFAULT_REPEATER_COUNTS,
    fillX: false,
    fillY: false,
    ...DEFAULT_REPEATER,
    areaWidth: sized ? cell.width * DEFAULT_REPEATER_COUNTS.countX : DEFAULT_REPEATER.areaWidth,
    areaHeight: sized ? cell.height * DEFAULT_REPEATER_COUNTS.countY : DEFAULT_REPEATER.areaHeight,
    background: "",
    zIndex: item.zIndex,
    opacity: item.opacity,
    seed
  };
}

export interface TerrainGroup {
  id: string;
  /**
   * What the scene tree calls it. Empty means "no opinion", and the UI falls
   * back to describing the grid, so a terrain is never nameless.
   */
  name: string;
  x: number;
  y: number;
  zIndex: number;
  countX: number;
  countY: number;
  /** World size of one heightmap cell, in the same units as the 2D scene. */
  tileSize: number;
  /** Long-edge mesh samples per tile. 512 is the default; you can raise it. */
  samples: number;
  /** Black on the heightmap. */
  low: number;
  /** White on the heightmap. */
  high: number;
  /** Heights at or below this flatten when flattenSea is on. */
  seaLevel: number;
  flattenSea: boolean;
  gradientId: TerrainGradientId;
  /** Row-major. Length is always countX * countY. */
  tiles: TerrainTile[];
}

export type { TerrainGradientId, TerrainTile };

export function defaultTerrain(id: string, x: number, y: number): TerrainGroup {
  return {
    id,
    name: "",
    x,
    y,
    zIndex: 0,
    ...DEFAULT_TERRAIN,
    tiles: emptyTiles(DEFAULT_TERRAIN.countX, DEFAULT_TERRAIN.countY)
  };
}

export interface RepeatGroup {
  id: string;
  /**
   * What the scene tree calls it. Empty means "no opinion", and the UI falls
   * back to describing the grid, so a repeater is never nameless.
   */
  name: string;
  assetIds: string[];
  x: number;
  y: number;
  cell: Size;
  marginX: number;
  marginY: number;
  countX: number;
  countY: number;
  fillX: boolean;
  fillY: boolean;
  placement: RepeaterPlacement;
  rotate: RepeaterRotate;
  /** How many stamps to throw in scatter mode. */
  scatterCount: number;
  /** Scatter rectangle, in play units, from the origin. */
  areaWidth: number;
  areaHeight: number;
  /** 0 is uniform size. 1 lets a stamp range from nothing to double. */
  scaleJitter: number;
  /** Minimum distance between scatter stamps. 0 allows overlap. */
  minGap: number;
  /** 0 is uniform. 1 piles stamps on the rectangle's edges. */
  edgeBias: number;
  background: string;
  zIndex: number;
  opacity: number;
  seed: number;
}

/**
 * One scene, as read out of the Yjs document.
 *
 * `camera` is absent on purpose: where you are looking is yours, not the
 * project's. It used to live here, which meant panning wrote to the shared
 * document and would have dragged every collaborator's viewport along.
 */
export interface Scene {
  id: string;
  name: string;
  unitsPerCell: number;
  items: StagedItem[];
  groups: RepeatGroup[];
  terrains: TerrainGroup[];
  palettePool: string[];
  palette: string;
  paletteDither: DitherMode;
  paletteDitherStrength: number;
}

/**
 * Assets the scene palette should be written into.
 *
 * Heightmaps are data, not art — quantizing them would flatten the elevation.
 * Colour maps are optional albedo and can take the palette.
 */
export function paletteBakeAssetIds(scene: Pick<Scene, "items" | "groups" | "terrains">): string[] {
  const ids = new Set<string>();

  for (const item of scene.items) {
    if (item.assetId) ids.add(item.assetId);
  }

  for (const group of scene.groups) {
    for (const id of group.assetIds) {
      if (id) ids.add(id);
    }
  }

  for (const terrain of scene.terrains) {
    for (const tile of terrain.tiles) {
      if (tile.colorAssetId) ids.add(tile.colorAssetId);
    }
  }

  return [...ids];
}

/** The editable half of an asset, stored in the Yjs document. */
export interface AssetEdits {
  /** Empty means "show the number instead". */
  name: string;
  folder: string;
  tags: string[];
  processing: ProcessingSettings;
  /**
   * Animations sliced out of this asset, keyed by id.
   *
   * A map rather than a single sequence because one sheet usually holds
   * several: a 4x4 grid is far more often idle, walk, run and attack than it
   * is one sixteen-frame cycle.
   */
  sequences: Record<string, Sequence>;
  /**
   * Hidden set members stay out of the library until extracted. The set's
   * face is always shown, even when this is true.
   */
  hidden: boolean;
}

/** An asset with its two halves merged, which is what components render. */
export interface ResolvedAsset extends AssetRecord {
  /** Pretty name if set, otherwise the zero-padded number. */
  label: string;
  name: string;
  folder: string;
  tags: string[];
  processing: ProcessingSettings;
  /** Sorted by name, so the inspector's picker has a stable order. */
  sequences: Sequence[];
  hidden: boolean;
  /** Loop/chunk group this asset belongs to, if any. */
  set: AssetSet | null;
}

/**
 * Per-user preferences. Everything here is one person's UI choice, which is
 * why none of it is shared: two collaborators can hold different generation
 * defaults in the same project.
 *
 * Prompt prefix and suffix used to live here and are now `ProjectSettings` in
 * the shared document -- a project's house style belongs to the project, not
 * to whoever happens to be typing. Job concurrency is server configuration
 * (`WORKER_CONCURRENCY`), and the asset naming slug was replaced by numbers.
 */
export interface StudioSettings {
  generation: GenerationParams;
  processing: ProcessingSettings;
  cutTemplateBackgroundOnPaste: boolean;
  templateCutTolerance: number;
}

/** Project-wide settings from the Yjs document. Shared, and undoable. */
export interface ProjectSettings {
  promptPrefix: string;
  promptSuffix: string;
}

/**
 * A named version of a prompt part, saved on the project.
 *
 * Shared rather than personal: a house style someone likes enough to name is
 * useful to the next person who opens the same project. The working prefix,
 * suffix and scratch stay where they are -- this is just the library you
 * load from and save into.
 */
export type PromptSnippetKind = "prefix" | "suffix" | "scratch";

export interface PromptSnippet {
  id: string;
  name: string;
  kind: PromptSnippetKind;
  text: string;
}

/**
 * What a project generates under until someone changes it.
 *
 * Applied when the field is absent from the document rather than written in at
 * creation, so a new project needs no seeding step. Clearing the prefix stores
 * an empty string, which is a different thing from absent and stays cleared.
 */
export const DEFAULT_PROJECT_SETTINGS: ProjectSettings = {
  promptPrefix:
    "You are generating game art from a 100% top-down perspective. This means we'll only see the tops of objects, never the sides. Schematic like, no perspective, perfectly top down.",
  promptSuffix: "Transparent Background"
};

export interface ProjectSummary {
  id: string;
  name: string;
  role: "owner" | "editor" | "viewer";
  canGenerate: boolean;
  isOwner: boolean;
  createdAt: string;
}
