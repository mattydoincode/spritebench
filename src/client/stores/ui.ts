"use client";

import { create } from "zustand";
import { processor } from "@/client/processor";
import { clampProcessWorkers, DEFAULT_PROCESS_WORKERS } from "@/client/processQueue";
import { toggleId } from "@/client/sceneSelect";
import { MASK_SOURCES, TEMPLATE_FIT_MODES, type MaskSource, type TemplateFitMode } from "@/core/types";
import type { SlotAssignProgress } from "@/shared/assignStream";
import { appendBases, type BaseSpec, type ImageSource, type MaskSpec } from "@/shared/model";
import type { PromptVariable } from "@/shared/promptVars";
import type { RestoredGeneration } from "@/shared/restoreGeneration";

/**
 * State that belongs to one person at one keyboard: where they are looking,
 * what they have selected, what is in their prompt box.
 *
 * None of it is shared, and none of it is undoable. Camera used to live in the
 * saved document, which meant panning wrote to the server and -- once a
 * project could be shared -- would have dragged a collaborator's viewport
 * along with yours.
 *
 * Persisted to localStorage rather than the database because it is worth
 * keeping across a reload and worth nothing to anyone else. Prompt drafts
 * are keyed by project so switching does not carry one project's prompt
 * into another.
 */

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export const DEFAULT_CAMERA: Camera = { x: 0, y: 0, zoom: 4 };

export type SceneView = "2d" | "terrain";

/**
 * Animation mode for the next generation.
 *
 * Local rather than in the document: it describes what you are about to ask
 * for, the same way the prompt box does, and two people generating at once
 * should not be rewriting each other's frame count.
 */
export interface AnimationActionRow {
  name: string;
  frames: number;
}

export interface AnimationRequestSettings {
  enabled: boolean;
  actions: AnimationActionRow[];
  /** Intended final sprite size. Caps what gets generated, and downsampled to. */
  cellSize: number;
}

export const DEFAULT_ANIMATION: AnimationRequestSettings = {
  enabled: false,
  actions: [
    { name: "idle", frames: 4 },
    { name: "walk", frames: 6 }
  ],
  cellSize: 64
};

export interface ItemGridSettings {
  enabled: boolean;
  columns: number;
  rows: number;
  cellSize: number;
}

export const DEFAULT_ITEM_GRID: ItemGridSettings = {
  enabled: false,
  columns: 4,
  rows: 4,
  cellSize: 64
};

export interface LoopSettings {
  enabled: boolean;
  steps: number;
  sendStart: boolean;
  includeStart: boolean;
}

export const DEFAULT_LOOP: LoopSettings = {
  enabled: false,
  steps: 4,
  sendStart: false,
  includeStart: false
};

export interface ChunkSettings {
  enabled: boolean;
  columns: number;
  rows: number;
}

export const DEFAULT_CHUNK: ChunkSettings = {
  enabled: false,
  columns: 2,
  rows: 2
};

export interface EachSettings {
  enabled: boolean;
}

export const DEFAULT_EACH: EachSettings = {
  enabled: false
};

/**
 * The generate panel for one project: the prompt you are about to send
 * and the toggles that shape that request.
 *
 * Flat on the store so the panel can keep reading `state.promptBody`. The
 * persisted copy lives in `drafts` keyed by project id.
 */
export interface ProjectDraft {
  promptBody: string;
  folder: string;
  animation: AnimationRequestSettings;
  itemGrid: ItemGridSettings;
  loop: LoopSettings;
  chunk: ChunkSettings;
  each: EachSettings;
  variables: PromptVariable[];
  /** Variable / template jobs land as one ordered library animation. */
  animateExpansions: boolean;
  bases: BaseSpec[];
  mask: MaskSpec | null;
}

interface Stored extends ProjectDraft {
  activeProjectId: string | null;
  /**
   * Prompt-box state per project. The flat fields above are the working
   * copy for `activeProjectId`; switching stashes and restores from here.
   */
  drafts: Record<string, ProjectDraft>;
  snapToGrid: boolean;
  showGrid: boolean;
  lockFootprintAspect: boolean;
  /** Per project, so switching projects restores where you were. */
  activeSceneId: Record<string, string>;
  /** Per scene: two scenes are two different places. */
  camera: Record<string, Camera>;
  /** Per scene: 2D grid vs the full-canvas terrain viewer. */
  sceneView: Record<string, SceneView>;
  /**
   * Which of the owner's keys to bill, per project.
   *
   * Local rather than shared: it is a choice about money, and pushing it into
   * the document would let one collaborator silently redirect everyone else's
   * generations onto a different key. The server re-checks it on every
   * request, so a stale id here is a refusal rather than a wrong bill.
   */
  providerKeyId: Record<string, string>;
  /**
   * Which floating scene bubbles are rolled up to their title bar.
   *
   * All of them, to start. Four expanded panels over an empty canvas reads as
   * clutter before you know what any of them are for, and the title bars stay
   * visible when rolled up, so the first thing you see is the shape of the
   * tools rather than all of their controls at once.
   */
  collapsedBubbles: Record<BubbleId, boolean>;
  /**
   * Library folders rolled up to three thumbs. Missing keys collapse when
   * the folder overflows; `false` means the user opened it.
   */
  collapsedFolders: Record<string, boolean>;
  /**
   * Inspector / generate sections rolled up to their divider.
   *
   * Missing keys use DEFAULT_COLLAPSED_SECTIONS (model and cleanup start
   * closed; everything else starts open).
   */
  collapsedSections: Record<string, boolean>;
  /**
   * Docked panel sizes and which are collapsed.
   *
   * In this store rather than in the studio's own state so that a panel can
   * collapse itself from its own header without the layout being threaded
   * through every component that might want a chevron.
   */
  layout: Layout;
  /**
   * Height of the inspector bitmap preview, in pixels.
   *
   * The preview always fits the asset into this box, so raising it is how
   * you zoom in on a 32-pixel sprite instead of staring at it at 1:1.
   */
  inspectorPreview: number;
  /**
   * How many process workers this browser runs.
   *
   * Local: it is about this machine's cores, not the project. One worker is
   * one thread; the pipeline is CPU-bound, so concurrency without extra
   * workers just interleaves on the same core.
   */
  processWorkers: number;
}

export type BubbleId = "view" | "elements" | "scenes" | "tree";

/** Sections that start closed — matches the disclosures they replaced. */
export const DEFAULT_COLLAPSED_SECTIONS: Record<string, boolean> = {
  "generate.model": true,
  "inspector.cleanup": true
};

export function readCollapsedSections(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== "object") return {};

  const result: Record<string, boolean> = {};
  for (const [id, collapsed] of Object.entries(value as Record<string, unknown>)) {
    if (typeof collapsed === "boolean") result[id] = collapsed;
  }
  return result;
}

export function sectionCollapsed(
  id: string,
  stored: Record<string, boolean>,
  defaults: Record<string, boolean> = DEFAULT_COLLAPSED_SECTIONS
): boolean {
  return stored[id] ?? defaults[id] ?? false;
}

export type Pane = "left" | "right" | "library";
export type RightTab = "inspector" | "godot";

export interface Layout {
  left: number;
  right: number;
  library: number;
  collapsed: Record<Pane, boolean>;
}

export const DEFAULT_LAYOUT: Layout = {
  left: 320,
  right: 330,
  library: 380,
  collapsed: { left: false, right: false, library: false }
};

export const MIN_INSPECTOR_PREVIEW = 80;
export const MAX_INSPECTOR_PREVIEW = 480;
export const DEFAULT_INSPECTOR_PREVIEW = 180;

function clampInspectorPreview(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_INSPECTOR_PREVIEW;
  return Math.min(MAX_INSPECTOR_PREVIEW, Math.max(MIN_INSPECTOR_PREVIEW, Math.round(value)));
}

const PANE_LIMITS: Record<Pane, { min: number; max: number }> = {
  left: { min: 200, max: 900 },
  right: { min: 200, max: 900 },
  library: { min: 60, max: 1600 }
};

const KEY = "spritebench.ui";

function readAnimation(stored?: Partial<AnimationRequestSettings> & {
  action?: string;
  frameCount?: number;
}): AnimationRequestSettings {
  if (Array.isArray(stored?.actions) && stored.actions.length > 0) {
    return {
      ...DEFAULT_ANIMATION,
      ...stored,
      actions: stored.actions.map((entry) => ({
        name: entry.name ?? "",
        frames: entry.frames ?? 4
      }))
    };
  }

  if (stored && (stored.action || stored.frameCount)) {
    return {
      enabled: stored.enabled ?? false,
      actions: [{ name: stored.action ?? "animation", frames: stored.frameCount ?? 8 }],
      cellSize: stored.cellSize ?? DEFAULT_ANIMATION.cellSize
    };
  }

  return { ...DEFAULT_ANIMATION, ...stored, actions: DEFAULT_ANIMATION.actions };
}

function readItemGrid(stored?: Partial<ItemGridSettings>): ItemGridSettings {
  if (!stored || typeof stored !== "object") return { ...DEFAULT_ITEM_GRID };

  return {
    enabled: stored.enabled === true,
    columns: Math.max(1, Math.min(32, Math.floor(stored.columns ?? DEFAULT_ITEM_GRID.columns) || 1)),
    rows: Math.max(1, Math.min(32, Math.floor(stored.rows ?? DEFAULT_ITEM_GRID.rows) || 1)),
    cellSize: Math.max(8, Math.floor(stored.cellSize ?? DEFAULT_ITEM_GRID.cellSize) || 64)
  };
}

function readCollapsedFolders(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== "object") return {};

  const result: Record<string, boolean> = {};
  for (const [folder, collapsed] of Object.entries(value as Record<string, unknown>)) {
    if (typeof collapsed === "boolean") result[folder] = collapsed;
  }
  return result;
}

function readLoop(stored?: Partial<LoopSettings>): LoopSettings {
  if (!stored || typeof stored !== "object") return { ...DEFAULT_LOOP };

  return {
    enabled: stored.enabled === true,
    steps: Math.max(2, Math.min(20, Math.floor(stored.steps ?? DEFAULT_LOOP.steps) || 2)),
    sendStart: stored.sendStart === true,
    includeStart: stored.includeStart === true
  };
}

function readChunk(stored?: Partial<ChunkSettings>): ChunkSettings {
  if (!stored || typeof stored !== "object") return { ...DEFAULT_CHUNK };

  return {
    enabled: stored.enabled === true,
    columns: Math.max(1, Math.min(16, Math.floor(stored.columns ?? DEFAULT_CHUNK.columns) || 1)),
    rows: Math.max(1, Math.min(16, Math.floor(stored.rows ?? DEFAULT_CHUNK.rows) || 1))
  };
}

function readEach(stored?: Partial<EachSettings>): EachSettings {
  if (!stored || typeof stored !== "object") return { ...DEFAULT_EACH };
  return { enabled: stored.enabled === true };
}

function readSceneView(stored?: Record<string, unknown>): Record<string, SceneView> {
  if (!stored || typeof stored !== "object") return {};

  const result: Record<string, SceneView> = {};
  for (const [id, value] of Object.entries(stored)) {
    if (value === "2d" || value === "terrain") result[id] = value;
  }
  return result;
}

function readVariables(stored?: PromptVariable[]): PromptVariable[] {
  if (!Array.isArray(stored)) return [];

  return stored
    .filter((entry) => entry && typeof entry.name === "string")
    .map((entry) => ({
      name: entry.name.trim(),
      values: typeof entry.values === "string" ? entry.values : ""
    }))
    .filter((entry) => entry.name.length > 0);
}

function readImageSource(value: unknown): ImageSource | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  if (source.kind === "template" && typeof source.templateId === "string" && source.templateId) {
    return { kind: "template", templateId: source.templateId };
  }
  if (source.kind === "asset" && typeof source.assetId === "string" && source.assetId) {
    return { kind: "asset", assetId: source.assetId };
  }
  return null;
}

function readBaseSpec(value: unknown): BaseSpec | null {
  if (!value || typeof value !== "object") return null;
  const entry = value as Record<string, unknown>;
  const source = readImageSource(entry.source);
  if (!source) return null;
  const fit = TEMPLATE_FIT_MODES.includes(entry.fit as TemplateFitMode)
    ? (entry.fit as TemplateFitMode)
    : "contain";
  return {
    source,
    fit,
    matchAspect: entry.matchAspect !== false
  };
}

function readMaskSpec(value: unknown): MaskSpec | null {
  if (!value || typeof value !== "object") return null;
  const entry = value as Record<string, unknown>;
  const source = readImageSource(entry.source);
  if (!source) return null;
  const maskSource = MASK_SOURCES.includes(entry.maskSource as MaskSource)
    ? (entry.maskSource as MaskSource)
    : "keepOutsideShape";
  const fit = TEMPLATE_FIT_MODES.includes(entry.fit as TemplateFitMode)
    ? (entry.fit as TemplateFitMode)
    : "contain";
  const rawWindow = entry.window;
  const window =
    rawWindow && typeof rawWindow === "object"
      ? {
          width: Math.max(0, Math.floor(Number((rawWindow as { width?: unknown }).width)) || 0),
          height: Math.max(0, Math.floor(Number((rawWindow as { height?: unknown }).height)) || 0)
        }
      : undefined;
  return {
    source,
    maskSource,
    dilatePixels: Math.max(0, Math.floor(Number(entry.dilatePixels)) || 0),
    fit,
    ...(window && (window.width > 0 || window.height > 0) ? { window } : {})
  };
}

function readBases(value: unknown): BaseSpec[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(readBaseSpec)
    .filter((entry): entry is BaseSpec => entry !== null)
    .slice(0, 20);
}

export const DEFAULT_PROJECT_DRAFT: ProjectDraft = {
  promptBody: "",
  folder: "",
  animation: DEFAULT_ANIMATION,
  itemGrid: DEFAULT_ITEM_GRID,
  loop: DEFAULT_LOOP,
  chunk: DEFAULT_CHUNK,
  each: DEFAULT_EACH,
  variables: [],
  animateExpansions: false,
  bases: [],
  mask: null
};

export function cloneProjectDraft(draft: ProjectDraft): ProjectDraft {
  return {
    promptBody: draft.promptBody,
    folder: draft.folder,
    animation: {
      ...draft.animation,
      actions: draft.animation.actions.map((entry) => ({ ...entry }))
    },
    itemGrid: { ...draft.itemGrid },
    loop: { ...draft.loop },
    chunk: { ...draft.chunk },
    each: { ...draft.each },
    variables: draft.variables.map((entry) => ({ ...entry })),
    animateExpansions: Boolean(draft.animateExpansions),
    bases: draft.bases.map((entry) => ({ ...entry, source: { ...entry.source } })),
    mask: draft.mask
      ? { ...draft.mask, source: { ...draft.mask.source }, window: draft.mask.window ? { ...draft.mask.window } : undefined }
      : null
  };
}

export function extractProjectDraft(state: ProjectDraft): ProjectDraft {
  return cloneProjectDraft(state);
}

export function readProjectDraft(stored?: Partial<ProjectDraft> | null): ProjectDraft {
  if (!stored || typeof stored !== "object") return cloneProjectDraft(DEFAULT_PROJECT_DRAFT);

  return {
    promptBody: typeof stored.promptBody === "string" ? stored.promptBody : "",
    folder: typeof stored.folder === "string" ? stored.folder : "",
    animation: readAnimation(stored.animation),
    itemGrid: readItemGrid(stored.itemGrid),
    loop: readLoop(stored.loop),
    chunk: readChunk(stored.chunk),
    each: readEach(stored.each),
    variables: readVariables(stored.variables),
    animateExpansions: stored.animateExpansions === true,
    bases: readBases(stored.bases),
    mask: readMaskSpec(stored.mask)
  };
}

/**
 * Rebuild the per-project map. A pre-split localStorage blob has one prompt
 * at the top level; that becomes the draft for the last open project.
 */
export function readProjectDrafts(stored: {
  activeProjectId?: string | null;
  drafts?: unknown;
} & Partial<ProjectDraft>): Record<string, ProjectDraft> {
  if (stored.drafts && typeof stored.drafts === "object" && !Array.isArray(stored.drafts)) {
    const result: Record<string, ProjectDraft> = {};
    for (const [id, value] of Object.entries(stored.drafts as Record<string, unknown>)) {
      if (value && typeof value === "object") {
        result[id] = readProjectDraft(value as Partial<ProjectDraft>);
      }
    }
    return result;
  }

  if (typeof stored.activeProjectId === "string" && stored.activeProjectId.length > 0) {
    return { [stored.activeProjectId]: readProjectDraft(stored) };
  }

  return {};
}

export function persistProjectDrafts(
  state: ProjectDraft & { activeProjectId: string | null; drafts: Record<string, ProjectDraft> }
): Record<string, ProjectDraft> {
  if (!state.activeProjectId) return state.drafts;
  return { ...state.drafts, [state.activeProjectId]: extractProjectDraft(state) };
}

export function switchProjectDraft(
  state: ProjectDraft & { activeProjectId: string | null; drafts: Record<string, ProjectDraft> },
  nextId: string | null
): ProjectDraft & { activeProjectId: string | null; drafts: Record<string, ProjectDraft> } {
  if (nextId === state.activeProjectId) {
    return {
      ...extractProjectDraft(state),
      activeProjectId: nextId,
      drafts: state.drafts
    };
  }

  const drafts = persistProjectDrafts(state);
  const next =
    (nextId && drafts[nextId]) ||
    (state.activeProjectId ? DEFAULT_PROJECT_DRAFT : extractProjectDraft(state));

  return {
    ...cloneProjectDraft(next),
    activeProjectId: nextId,
    drafts
  };
}

const DEFAULTS: Stored = {
  activeProjectId: null,
  ...cloneProjectDraft(DEFAULT_PROJECT_DRAFT),
  drafts: {},
  snapToGrid: true,
  showGrid: true,
  lockFootprintAspect: true,
  activeSceneId: {},
  camera: {},
  sceneView: {},
  providerKeyId: {},
  collapsedBubbles: { view: true, elements: true, scenes: true, tree: true },
  collapsedFolders: {},
  collapsedSections: {},
  layout: DEFAULT_LAYOUT,
  inspectorPreview: DEFAULT_INSPECTOR_PREVIEW,
  processWorkers: DEFAULT_PROCESS_WORKERS
};

function read(): Stored {
  if (typeof window === "undefined") return DEFAULTS;

  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;

    const stored = JSON.parse(raw) as Partial<Stored>;
    const drafts = readProjectDrafts(stored);
    const draft =
      (stored.activeProjectId && drafts[stored.activeProjectId]) ||
      readProjectDraft(stored);
    return {
      ...DEFAULTS,
      ...stored,
      ...cloneProjectDraft(draft),
      drafts,
      collapsedBubbles: { ...DEFAULTS.collapsedBubbles, ...stored.collapsedBubbles },
      collapsedFolders: readCollapsedFolders(stored.collapsedFolders),
      collapsedSections: readCollapsedSections(stored.collapsedSections),
      layout: {
        ...DEFAULT_LAYOUT,
        ...stored.layout,
        collapsed: { ...DEFAULT_LAYOUT.collapsed, ...stored.layout?.collapsed }
      },
      inspectorPreview: clampInspectorPreview(stored.inspectorPreview),
      processWorkers: clampProcessWorkers(stored.processWorkers),
      sceneView: readSceneView(stored.sceneView)
    };
  } catch {
    return DEFAULTS;
  }
}

let writeTimer: ReturnType<typeof setTimeout> | null = null;

function persist(state: Stored): void {
  if (typeof window === "undefined") return;

  // Debounced because camera writes arrive on every animation frame of a pan.
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    writeTimer = null;
    try {
      window.localStorage.setItem(
        KEY,
        JSON.stringify({
          activeProjectId: state.activeProjectId,
          drafts: persistProjectDrafts(state),
          snapToGrid: state.snapToGrid,
          showGrid: state.showGrid,
          lockFootprintAspect: state.lockFootprintAspect,
          activeSceneId: state.activeSceneId,
          camera: state.camera,
          sceneView: state.sceneView,
          providerKeyId: state.providerKeyId,
          collapsedBubbles: state.collapsedBubbles,
          collapsedFolders: state.collapsedFolders,
          collapsedSections: state.collapsedSections,
          layout: state.layout,
          inspectorPreview: state.inspectorPreview,
          processWorkers: state.processWorkers
        })
      );
    } catch {
      // A full or disabled localStorage costs a preference, not a session.
    }
  }, 250);
}

interface UiState extends Stored {
  /** Transient: never persisted, never shared. */
  selectedIds: string[];
  rightTab: RightTab;
  activeItemId: string | null;
  /** Staged sprites in the scene selection. Last id is `activeItemId`. */
  selectedItemIds: string[];
  /** Repeaters in the scene selection. Last id is `activeGroupId`. */
  selectedGroupIds: string[];
  activeGroupId: string | null;
  activeTerrainId: string | null;
  editingAssetId: string | null;
  /**
   * Which animation the inspector is showing, when the selected asset has
   * more than one. Falls back to the first when this names one the asset does
   * not have, which is what happens after switching selection.
   */
  activeSequenceId: string | null;
  /** Set when the image editor is scoped to one frame instead of the sheet. */
  editingFrame: { sequenceId: string; frameId: string } | null;
  /** Which asset the slice dialog is open over. */
  slicingAssetId: string | null;
  projectSettingsOpen: boolean;
  templateBuilderOpen: boolean;
  batches: number;
  busy: string | null;
  assigning: SlotAssignProgress | null;
  error: string | null;
  notice: string | null;

  hydrate: () => void;

  setBatches: (value: number) => void;
  setBases: (bases: BaseSpec[]) => void;
  addBases: (bases: BaseSpec[]) => void;
  removeBase: (index: number) => void;
  patchBases: (patch: Partial<Pick<BaseSpec, "fit" | "matchAspect">>) => void;
  setMask: (mask: MaskSpec | null) => void;

  setActiveProject: (projectId: string | null) => void;
  setPromptBody: (value: string) => void;
  setFolder: (value: string) => void;
  applyGenerationSetup: (setup: RestoredGeneration) => void;

  activeScene: (projectId: string) => string | null;
  setActiveScene: (projectId: string, sceneId: string) => void;

  /**
   * Drops any error and notice left over from another screen.
   *
   * This store outlives navigation, so without it a failed request in the
   * studio -- the last jobs poll as you leave, say -- surfaces as a banner on
   * the dashboard, where it is not true and cannot be acted on.
   */
  clearMessages: () => void;

  toggleBubble: (bubble: BubbleId) => void;
  toggleFolder: (folder: string) => void;
  toggleSection: (id: string) => void;
  setPaneSize: (pane: Pane, size: number) => void;
  togglePane: (pane: Pane) => void;
  setRightTab: (tab: RightTab) => void;
  setInspectorPreview: (size: number) => void;
  setProcessWorkers: (count: number) => void;

  setProviderKey: (projectId: string, providerKeyId: string) => void;

  cameraFor: (sceneId: string) => Camera;
  setCamera: (sceneId: string, patch: Partial<Camera>) => void;
  sceneViewFor: (sceneId: string) => SceneView;
  setSceneView: (sceneId: string, view: SceneView) => void;

  select: (id: string, additive: boolean) => void;
  selectMany: (ids: string[]) => void;
  clearSelection: () => void;

  setActiveItem: (itemId: string | null) => void;
  selectItems: (ids: string[]) => void;
  selectScene: (itemIds: string[], groupIds: string[]) => void;
  toggleItemSelection: (id: string) => void;
  setActiveGroup: (groupId: string | null) => void;
  setActiveTerrain: (terrainId: string | null) => void;
  setAnimation: (patch: Partial<AnimationRequestSettings>) => void;
  setItemGrid: (patch: Partial<ItemGridSettings>) => void;
  setLoop: (patch: Partial<LoopSettings>) => void;
  setChunk: (patch: Partial<ChunkSettings>) => void;
  setEach: (patch: Partial<EachSettings>) => void;
  setVariables: (variables: PromptVariable[]) => void;
  setAnimateExpansions: (value: boolean) => void;

  openImageEditor: (id: string) => void;
  openFrameEditor: (assetId: string, sequenceId: string, frameId: string) => void;
  closeImageEditor: () => void;

  setActiveSequence: (sequenceId: string | null) => void;
  openSlicer: (assetId: string) => void;
  closeSlicer: () => void;
  openProjectSettings: () => void;
  closeProjectSettings: () => void;
  openTemplateBuilder: () => void;
  closeTemplateBuilder: () => void;

  toggleSnap: () => void;
  toggleGrid: () => void;
  toggleFootprintLock: () => void;

  setBusy: (value: string | null) => void;
  setAssigning: (value: SlotAssignProgress | null) => void;
  setError: (message: string | null) => void;
  setNotice: (message: string | null) => void;
}

export const useUi = create<UiState>((set, get) => {
  const save = () => persist(get());

  return {
    ...DEFAULTS,

    selectedIds: [],
    rightTab: "inspector",
    activeItemId: null,
    selectedItemIds: [],
    selectedGroupIds: [],
    activeGroupId: null,
    activeTerrainId: null,
    editingAssetId: null,
    activeSequenceId: null,
    editingFrame: null,
    slicingAssetId: null,
    projectSettingsOpen: false,
    templateBuilderOpen: false,
    batches: 1,
    bases: [],
    mask: null,
    busy: null,
    assigning: null,
    error: null,
    notice: null,

    // Called from an effect rather than at module load: reading localStorage
    // during render would make the server and client markup disagree.
    hydrate() {
      const stored = read();
      set(stored);
      processor.setWorkers(stored.processWorkers);
    },

    setProcessWorkers(count) {
      const processWorkers = clampProcessWorkers(count);
      set({ processWorkers });
      processor.setWorkers(processWorkers);
      save();
    },

    setBatches(value) {
      set({ batches: Math.max(1, Math.min(20, Math.floor(value) || 1)) });
    },

    setBases(bases) {
      set({ bases: bases.slice(0, 20) });
      save();
    },

    addBases(bases) {
      set({ bases: appendBases(get().bases, bases).slice(0, 20) });
      save();
    },

    removeBase(index) {
      set({ bases: get().bases.filter((_, entry) => entry !== index) });
      save();
    },

    patchBases(patch) {
      set({
        bases: get().bases.map((entry) => ({
          ...entry,
          ...patch
        }))
      });
      save();
    },

    setMask(mask) {
      set({ mask });
      save();
    },

    setActiveProject(projectId) {
      const current = get();
      const switched = switchProjectDraft(current, projectId);
      set({
        ...switched,
        selectedIds: [],
        activeItemId: null,
        selectedItemIds: [],
        selectedGroupIds: [],
        activeGroupId: null,
        activeTerrainId: null
      });
      save();
    },

    setPromptBody(value) {
      set({ promptBody: value });
      save();
    },

    setFolder(value) {
      set({ folder: value });
      save();
    },

    applyGenerationSetup(setup) {
      set({
        promptBody: setup.promptBody,
        folder: setup.folder,
        animation: {
          ...setup.animation,
          actions: setup.animation.actions.map((entry) => ({ ...entry }))
        },
        itemGrid: { ...setup.itemGrid },
        loop: { ...setup.loop },
        chunk: { ...setup.chunk },
        each: { ...setup.each },
        animateExpansions: setup.animateExpansions,
        bases: setup.bases.slice(0, 20),
        mask: setup.mask,
        variables: []
      });
      save();
    },

    setAnimation(patch) {
      const animation = { ...get().animation, ...patch };
      set({
        animation,
        itemGrid: animation.enabled ? { ...get().itemGrid, enabled: false } : get().itemGrid,
        loop: animation.enabled ? { ...get().loop, enabled: false } : get().loop,
        chunk: animation.enabled ? { ...get().chunk, enabled: false } : get().chunk,
        each: animation.enabled ? { ...get().each, enabled: false } : get().each
      });
      save();
    },

    setItemGrid(patch) {
      const itemGrid = { ...get().itemGrid, ...patch };
      set({
        itemGrid,
        animation: itemGrid.enabled ? { ...get().animation, enabled: false } : get().animation,
        loop: itemGrid.enabled ? { ...get().loop, enabled: false } : get().loop,
        chunk: itemGrid.enabled ? { ...get().chunk, enabled: false } : get().chunk,
        each: itemGrid.enabled ? { ...get().each, enabled: false } : get().each
      });
      save();
    },

    setLoop(patch) {
      const loop = { ...get().loop, ...patch };
      set({
        loop,
        chunk: loop.enabled ? { ...get().chunk, enabled: false } : get().chunk,
        animation: loop.enabled ? { ...get().animation, enabled: false } : get().animation,
        itemGrid: loop.enabled ? { ...get().itemGrid, enabled: false } : get().itemGrid,
        each: loop.enabled ? { ...get().each, enabled: false } : get().each
      });
      save();
    },

    setChunk(patch) {
      const chunk = { ...get().chunk, ...patch };
      set({
        chunk,
        loop: chunk.enabled ? { ...get().loop, enabled: false } : get().loop,
        animation: chunk.enabled ? { ...get().animation, enabled: false } : get().animation,
        itemGrid: chunk.enabled ? { ...get().itemGrid, enabled: false } : get().itemGrid,
        each: chunk.enabled ? { ...get().each, enabled: false } : get().each
      });
      save();
    },

    setEach(patch) {
      const each = { ...get().each, ...patch };
      set({
        each,
        loop: each.enabled ? { ...get().loop, enabled: false } : get().loop,
        chunk: each.enabled ? { ...get().chunk, enabled: false } : get().chunk,
        animation: each.enabled ? { ...get().animation, enabled: false } : get().animation,
        itemGrid: each.enabled ? { ...get().itemGrid, enabled: false } : get().itemGrid
      });
      save();
    },

    setVariables(variables) {
      set({ variables });
      save();
    },

    setAnimateExpansions(value) {
      set({ animateExpansions: value });
      save();
    },

    activeScene(projectId) {
      return get().activeSceneId[projectId] ?? null;
    },

    setActiveScene(projectId, sceneId) {
      set({
        activeSceneId: { ...get().activeSceneId, [projectId]: sceneId },
        activeItemId: null,
        selectedItemIds: [],
        selectedGroupIds: [],
        activeGroupId: null,
        activeTerrainId: null
      });
      save();
    },

    clearMessages() {
      set({ error: null, notice: null });
    },

    toggleBubble(bubble) {
      const current = get().collapsedBubbles;
      set({ collapsedBubbles: { ...current, [bubble]: !current[bubble] } });
      save();
    },

    toggleFolder(folder) {
      const current = get().collapsedFolders;
      const collapsed = current[folder] !== false;
      set({ collapsedFolders: { ...current, [folder]: !collapsed } });
      save();
    },

    toggleSection(id) {
      const current = get().collapsedSections;
      set({ collapsedSections: { ...current, [id]: !sectionCollapsed(id, current) } });
      save();
    },

    setPaneSize(pane, size) {
      const { min, max } = PANE_LIMITS[pane];
      set({
        layout: { ...get().layout, [pane]: Math.min(max, Math.max(min, Math.round(size))) }
      });
      save();
    },

    setInspectorPreview(size) {
      set({ inspectorPreview: clampInspectorPreview(size) });
      save();
    },

    setRightTab(tab) {
      set({ rightTab: tab });
    },

    togglePane(pane) {
      const layout = get().layout;
      set({
        layout: {
          ...layout,
          collapsed: { ...layout.collapsed, [pane]: !layout.collapsed[pane] }
        }
      });
      save();
    },

    setProviderKey(projectId, providerKeyId) {
      set({ providerKeyId: { ...get().providerKeyId, [projectId]: providerKeyId } });
      save();
    },

    cameraFor(sceneId) {
      return get().camera[sceneId] ?? DEFAULT_CAMERA;
    },

    setCamera(sceneId, patch) {
      const current = get().camera[sceneId] ?? DEFAULT_CAMERA;
      set({ camera: { ...get().camera, [sceneId]: { ...current, ...patch } } });
      save();
    },

    sceneViewFor(sceneId) {
      return get().sceneView[sceneId] ?? "2d";
    },

    setSceneView(sceneId, view) {
      set({ sceneView: { ...get().sceneView, [sceneId]: view } });
      save();
    },

    select(id, additive) {
      const { selectedIds } = get();

      if (!additive) {
        set({ selectedIds: [id] });
        return;
      }

      set({
        selectedIds: selectedIds.includes(id)
          ? selectedIds.filter((entry) => entry !== id)
          : [...selectedIds, id]
      });
    },

    selectMany(ids) {
      set({ selectedIds: ids });
    },

    clearSelection() {
      set({ selectedIds: [] });
    },

    setActiveItem(itemId) {
      set({
        activeItemId: itemId,
        selectedItemIds: itemId ? [itemId] : [],
        selectedGroupIds: itemId === null ? get().selectedGroupIds : [],
        activeGroupId: itemId === null ? get().activeGroupId : null,
        activeTerrainId: itemId === null ? get().activeTerrainId : null
      });
    },

    selectItems(ids) {
      get().selectScene(ids, []);
    },

    selectScene(itemIds, groupIds) {
      set({
        selectedItemIds: itemIds,
        selectedGroupIds: groupIds,
        activeItemId: itemIds[itemIds.length - 1] ?? null,
        activeGroupId: groupIds[groupIds.length - 1] ?? null,
        activeTerrainId: null
      });
    },

    toggleItemSelection(id) {
      const selectedItemIds = toggleId(get().selectedItemIds, id);
      const selectedGroupIds = get().selectedGroupIds;
      set({
        selectedItemIds,
        selectedGroupIds,
        activeItemId: selectedItemIds[selectedItemIds.length - 1] ?? null,
        activeGroupId: selectedGroupIds[selectedGroupIds.length - 1] ?? null,
        activeTerrainId: selectedItemIds.length || selectedGroupIds.length ? null : get().activeTerrainId
      });
    },

    setActiveGroup(groupId) {
      set({
        activeGroupId: groupId,
        selectedGroupIds: groupId ? [groupId] : [],
        activeItemId: groupId === null ? get().activeItemId : null,
        selectedItemIds: groupId === null ? get().selectedItemIds : [],
        activeTerrainId: groupId === null ? get().activeTerrainId : null
      });
    },

    setActiveTerrain(terrainId) {
      set({
        activeTerrainId: terrainId,
        activeItemId: terrainId === null ? get().activeItemId : null,
        selectedItemIds: terrainId === null ? get().selectedItemIds : [],
        selectedGroupIds: terrainId === null ? get().selectedGroupIds : [],
        activeGroupId: terrainId === null ? get().activeGroupId : null
      });
    },

    openImageEditor(id) {
      set({ editingAssetId: id, editingFrame: null });
    },

    openFrameEditor(assetId, sequenceId, frameId) {
      set({ editingAssetId: assetId, editingFrame: { sequenceId, frameId } });
    },

    closeImageEditor() {
      set({ editingAssetId: null, editingFrame: null });
    },

    setActiveSequence(sequenceId) {
      set({ activeSequenceId: sequenceId });
    },

    openSlicer(assetId) {
      set({ slicingAssetId: assetId });
    },

    closeSlicer() {
      set({ slicingAssetId: null });
    },

    openProjectSettings() {
      set({ projectSettingsOpen: true });
    },

    closeProjectSettings() {
      set({ projectSettingsOpen: false });
    },

    openTemplateBuilder() {
      set({ templateBuilderOpen: true });
    },

    closeTemplateBuilder() {
      set({ templateBuilderOpen: false });
    },

    toggleSnap() {
      set({ snapToGrid: !get().snapToGrid });
      save();
    },

    toggleGrid() {
      set({ showGrid: !get().showGrid });
      save();
    },

    toggleFootprintLock() {
      set({ lockFootprintAspect: !get().lockFootprintAspect });
      save();
    },

    setBusy(value) {
      set({ busy: value, assigning: value === null ? null : get().assigning });
    },

    setAssigning(value) {
      set({ assigning: value, busy: value ? "uploading" : get().busy });
    },

    setError(message) {
      set({ error: message });
    },

    setNotice(message) {
      set({ notice: message });
    }
  };
});
