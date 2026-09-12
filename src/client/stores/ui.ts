"use client";

import { create } from "zustand";
import type { BaseSpec, MaskSpec } from "@/shared/model";
import type { PromptVariable } from "@/shared/promptVars";

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
}

export const DEFAULT_LOOP: LoopSettings = {
  enabled: false,
  steps: 4
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

/**
 * The generate panel for one project: the prompt you are about to send,
 * the scratch pad next to it, and the toggles that shape that request.
 *
 * Flat on the store so the panel can keep reading `state.promptBody`. The
 * persisted copy lives in `drafts` keyed by project id.
 */
export interface ProjectDraft {
  promptBody: string;
  scratch: string;
  folder: string;
  animation: AnimationRequestSettings;
  itemGrid: ItemGridSettings;
  loop: LoopSettings;
  chunk: ChunkSettings;
  variables: PromptVariable[];
  /** Edited feature extras, keyed by FeaturePromptId. Missing means the default. */
  featurePrompts: Record<string, string>;
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
  /** Library folders rolled up to a header plus a few thumbs. */
  collapsedFolders: Record<string, boolean>;
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
}

export type BubbleId = "view" | "elements" | "scenes" | "tree";

export type Pane = "left" | "right" | "library";

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
    steps: Math.max(2, Math.min(20, Math.floor(stored.steps ?? DEFAULT_LOOP.steps) || 2))
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

function readFeaturePrompts(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") return {};

  const result: Record<string, string> = {};
  for (const [id, text] of Object.entries(value as Record<string, unknown>)) {
    if (typeof text === "string") result[id] = text;
  }
  return result;
}

export const DEFAULT_PROJECT_DRAFT: ProjectDraft = {
  promptBody: "",
  scratch: "",
  folder: "",
  animation: DEFAULT_ANIMATION,
  itemGrid: DEFAULT_ITEM_GRID,
  loop: DEFAULT_LOOP,
  chunk: DEFAULT_CHUNK,
  variables: [],
  featurePrompts: {}
};

export function cloneProjectDraft(draft: ProjectDraft): ProjectDraft {
  return {
    promptBody: draft.promptBody,
    scratch: draft.scratch,
    folder: draft.folder,
    animation: {
      ...draft.animation,
      actions: draft.animation.actions.map((entry) => ({ ...entry }))
    },
    itemGrid: { ...draft.itemGrid },
    loop: { ...draft.loop },
    chunk: { ...draft.chunk },
    variables: draft.variables.map((entry) => ({ ...entry })),
    featurePrompts: { ...draft.featurePrompts }
  };
}

export function extractProjectDraft(state: ProjectDraft): ProjectDraft {
  return cloneProjectDraft(state);
}

export function readProjectDraft(stored?: Partial<ProjectDraft> | null): ProjectDraft {
  if (!stored || typeof stored !== "object") return cloneProjectDraft(DEFAULT_PROJECT_DRAFT);

  return {
    promptBody: typeof stored.promptBody === "string" ? stored.promptBody : "",
    scratch: typeof stored.scratch === "string" ? stored.scratch : "",
    folder: typeof stored.folder === "string" ? stored.folder : "",
    animation: readAnimation(stored.animation),
    itemGrid: readItemGrid(stored.itemGrid),
    loop: readLoop(stored.loop),
    chunk: readChunk(stored.chunk),
    variables: readVariables(stored.variables),
    featurePrompts: readFeaturePrompts(stored.featurePrompts)
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
  layout: DEFAULT_LAYOUT,
  inspectorPreview: DEFAULT_INSPECTOR_PREVIEW
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
      layout: {
        ...DEFAULT_LAYOUT,
        ...stored.layout,
        collapsed: { ...DEFAULT_LAYOUT.collapsed, ...stored.layout?.collapsed }
      },
      inspectorPreview: clampInspectorPreview(stored.inspectorPreview),
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
          layout: state.layout,
          inspectorPreview: state.inspectorPreview
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
  activeItemId: string | null;
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
  batches: number;
  /** Reference / starting image for the next job. */
  base: BaseSpec | null;
  /** Independent mask. Optional, including next to a starting image. */
  mask: MaskSpec | null;
  busy: string | null;
  error: string | null;
  notice: string | null;

  hydrate: () => void;

  setBatches: (value: number) => void;
  setBase: (base: BaseSpec | null) => void;
  setMask: (mask: MaskSpec | null) => void;

  setActiveProject: (projectId: string | null) => void;
  setPromptBody: (value: string) => void;
  setScratch: (value: string) => void;
  setFolder: (value: string) => void;

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
  setPaneSize: (pane: Pane, size: number) => void;
  togglePane: (pane: Pane) => void;
  setInspectorPreview: (size: number) => void;

  setProviderKey: (projectId: string, providerKeyId: string) => void;

  cameraFor: (sceneId: string) => Camera;
  setCamera: (sceneId: string, patch: Partial<Camera>) => void;
  sceneViewFor: (sceneId: string) => SceneView;
  setSceneView: (sceneId: string, view: SceneView) => void;

  select: (id: string, additive: boolean) => void;
  selectMany: (ids: string[]) => void;
  clearSelection: () => void;

  setActiveItem: (itemId: string | null) => void;
  setActiveGroup: (groupId: string | null) => void;
  setActiveTerrain: (terrainId: string | null) => void;
  setAnimation: (patch: Partial<AnimationRequestSettings>) => void;
  setItemGrid: (patch: Partial<ItemGridSettings>) => void;
  setLoop: (patch: Partial<LoopSettings>) => void;
  setChunk: (patch: Partial<ChunkSettings>) => void;
  setVariables: (variables: PromptVariable[]) => void;
  setFeaturePrompt: (id: string, value: string) => void;
  resetFeaturePrompt: (id: string) => void;

  openImageEditor: (id: string) => void;
  openFrameEditor: (assetId: string, sequenceId: string, frameId: string) => void;
  closeImageEditor: () => void;

  setActiveSequence: (sequenceId: string | null) => void;
  openSlicer: (assetId: string) => void;
  closeSlicer: () => void;

  toggleSnap: () => void;
  toggleGrid: () => void;
  toggleFootprintLock: () => void;

  setBusy: (value: string | null) => void;
  setError: (message: string | null) => void;
  setNotice: (message: string | null) => void;
}

export const useUi = create<UiState>((set, get) => {
  const save = () => persist(get());

  return {
    ...DEFAULTS,

    selectedIds: [],
    activeItemId: null,
    activeGroupId: null,
    activeTerrainId: null,
    editingAssetId: null,
    activeSequenceId: null,
    editingFrame: null,
    slicingAssetId: null,
    batches: 1,
    base: null,
    mask: null,
    busy: null,
    error: null,
    notice: null,

    // Called from an effect rather than at module load: reading localStorage
    // during render would make the server and client markup disagree.
    hydrate() {
      set(read());
    },

    setBatches(value) {
      set({ batches: Math.max(1, Math.min(20, Math.floor(value) || 1)) });
    },

    setBase(base) {
      set({ base });
    },

    setMask(mask) {
      set({ mask });
    },

    setActiveProject(projectId) {
      const current = get();
      const switched = switchProjectDraft(current, projectId);
      const same = projectId === current.activeProjectId;
      set({
        ...switched,
        selectedIds: [],
        activeItemId: null,
        activeGroupId: null,
        activeTerrainId: null,
        base: same ? current.base : null,
        mask: same ? current.mask : null
      });
      save();
    },

    setPromptBody(value) {
      set({ promptBody: value });
      save();
    },

    setScratch(value) {
      set({ scratch: value });
      save();
    },

    setFolder(value) {
      set({ folder: value });
      save();
    },

    setAnimation(patch) {
      const animation = { ...get().animation, ...patch };
      set({
        animation,
        itemGrid: animation.enabled ? { ...get().itemGrid, enabled: false } : get().itemGrid,
        loop: animation.enabled ? { ...get().loop, enabled: false } : get().loop,
        chunk: animation.enabled ? { ...get().chunk, enabled: false } : get().chunk
      });
      save();
    },

    setItemGrid(patch) {
      const itemGrid = { ...get().itemGrid, ...patch };
      set({
        itemGrid,
        animation: itemGrid.enabled ? { ...get().animation, enabled: false } : get().animation,
        loop: itemGrid.enabled ? { ...get().loop, enabled: false } : get().loop,
        chunk: itemGrid.enabled ? { ...get().chunk, enabled: false } : get().chunk
      });
      save();
    },

    setLoop(patch) {
      const loop = { ...get().loop, ...patch };
      set({
        loop,
        chunk: loop.enabled ? { ...get().chunk, enabled: false } : get().chunk,
        animation: loop.enabled ? { ...get().animation, enabled: false } : get().animation,
        itemGrid: loop.enabled ? { ...get().itemGrid, enabled: false } : get().itemGrid
      });
      save();
    },

    setChunk(patch) {
      const chunk = { ...get().chunk, ...patch };
      set({
        chunk,
        loop: chunk.enabled ? { ...get().loop, enabled: false } : get().loop,
        animation: chunk.enabled ? { ...get().animation, enabled: false } : get().animation,
        itemGrid: chunk.enabled ? { ...get().itemGrid, enabled: false } : get().itemGrid
      });
      save();
    },

    setVariables(variables) {
      set({ variables });
      save();
    },

    setFeaturePrompt(id, value) {
      set({ featurePrompts: { ...get().featurePrompts, [id]: value } });
      save();
    },

    resetFeaturePrompt(id) {
      const { [id]: _dropped, ...featurePrompts } = get().featurePrompts;
      set({ featurePrompts });
      save();
    },

    activeScene(projectId) {
      return get().activeSceneId[projectId] ?? null;
    },

    setActiveScene(projectId, sceneId) {
      set({
        activeSceneId: { ...get().activeSceneId, [projectId]: sceneId },
        activeItemId: null,
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
      set({ collapsedFolders: { ...current, [folder]: !current[folder] } });
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
        activeGroupId: itemId === null ? get().activeGroupId : null,
        activeTerrainId: itemId === null ? get().activeTerrainId : null
      });
    },

    setActiveGroup(groupId) {
      set({
        activeGroupId: groupId,
        activeItemId: groupId === null ? get().activeItemId : null,
        activeTerrainId: groupId === null ? get().activeTerrainId : null
      });
    },

    setActiveTerrain(terrainId) {
      set({
        activeTerrainId: terrainId,
        activeItemId: terrainId === null ? get().activeItemId : null,
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
      set({ busy: value });
    },

    setError(message) {
      set({ error: message });
    },

    setNotice(message) {
      set({ notice: message });
    }
  };
});
