"use client";

import { create } from "zustand";
import type { ProcessingSettings } from "@/core/settings";
import { DocSync } from "@/client/doc/sync";
import {
  setIdForJob,
  setSpecFromInputs,
  type AssetSet,
  type AssetSetView
} from "@/shared/assetSet";
import * as doc from "@/shared/doc";
import {
  DEFAULT_PROJECT_SETTINGS,
  paletteBakeAssetIds,
  type AssetEdits,
  type AssetRecord,
  type JobRecord,
  type Scene,
  type ProjectSettings,
  type PromptSnippet,
  type PromptSnippetKind,
  type RepeatGroup,
  type StagedItem,
  type TerrainGroup,
  type TerrainTile
} from "@/shared/model";
import { sequencesFromPlan } from "@/shared/animationPrompt";
import type { Sequence, SequenceFrame } from "@/shared/sequence";
import { useUi } from "./ui";

/**
 * The shared half of the app: scenes and the editable half of every
 * asset, held in a Yjs document that syncs to the server and merges with
 * whatever collaborators are doing.
 *
 * Nothing in here is fetched or saved by hand. A mutation writes to the
 * document; the document tells the sync layer, which tells the server; the
 * server tells everyone else. There is no save button and no conflict to
 * resolve, which is the whole reason for the CRDT -- the optimistic
 * concurrency this replaced answered a simultaneous edit with "your copy is
 * stale, here is theirs", and one person lost their work.
 */

interface DocState {
  sync: DocSync | null;
  ready: boolean;
  /** Bumped on every document change; what React re-renders against. */
  revision: number;

  scenes: Scene[];
  edits: Record<string, AssetEdits>;
  sets: AssetSet[];
  /** The project's prompt wrapper. Shared, so editing it is undoable. */
  project: ProjectSettings;
  snippets: PromptSnippet[];
  canUndo: boolean;
  canRedo: boolean;

  open: (projectId: string, canEdit: boolean) => void;
  close: () => void;

  patchProjectSettings: (patch: Partial<ProjectSettings>) => void;
  savePromptSnippet: (kind: PromptSnippetKind, name: string, text: string) => void;
  deletePromptSnippet: (id: string) => void;

  undo: () => void;
  redo: () => void;

  scene: (id: string | null) => Scene | null;
  createScene: (name: string) => string | null;
  deleteScene: (id: string) => void;
  patchScene: (
    id: string,
    patch: Partial<Omit<Scene, "id" | "items" | "groups" | "terrains" | "palettePool">>
  ) => void;

  addItem: (sceneId: string, item: Omit<StagedItem, "zIndex">) => void;
  patchItem: (sceneId: string, itemId: string, patch: Partial<StagedItem>) => void;
  removeItem: (sceneId: string, itemId: string) => void;
  bringToFront: (sceneId: string, itemId: string) => void;

  addGroup: (sceneId: string, group: Omit<RepeatGroup, "zIndex">) => void;
  /** Sprite → 3×3 repeater at the same origin. Returns the new group id. */
  convertItemToRepeater: (sceneId: string, itemId: string) => string | null;
  patchGroup: (sceneId: string, groupId: string, patch: Partial<RepeatGroup>) => void;
  addGroupAssets: (sceneId: string, groupId: string, assetIds: string[]) => void;
  setGroupAssets: (sceneId: string, groupId: string, assetIds: string[]) => void;
  removeGroup: (sceneId: string, groupId: string) => void;

  addTerrain: (sceneId: string, terrain: Omit<TerrainGroup, "zIndex">) => void;
  patchTerrain: (sceneId: string, terrainId: string, patch: Partial<TerrainGroup>) => void;
  setTerrainTile: (
    sceneId: string,
    terrainId: string,
    index: number,
    patch: Partial<TerrainTile>
  ) => void;
  removeTerrain: (sceneId: string, terrainId: string) => void;

  clearScene: (sceneId: string) => void;

  addPaletteToPool: (sceneId: string, paletteId: string) => void;
  removePaletteFromPool: (sceneId: string, paletteId: string) => void;

  /** Creates the editable half of any asset that does not have one yet. */
  backfill: (
    assets: AssetRecord[],
    context?: { folders?: Record<string, string>; jobs?: JobRecord[] }
  ) => void;
  editsFor: (assetId: string) => AssetEdits | null;
  rename: (assetId: string, name: string) => void;
  setFolder: (assetId: string, folder: string) => void;
  setTags: (assetId: string, tags: string[]) => void;
  patchProcessing: (assetId: string, patch: Partial<ProcessingSettings>) => void;
  applyProcessingToMany: (assetIds: string[], processing: ProcessingSettings) => void;
  purge: (assetId: string) => void;
  setHidden: (assetId: string, hidden: boolean) => void;
  setSetView: (setId: string, view: AssetSetView) => void;

  putSequence: (assetId: string, sequence: Sequence) => void;
  replaceSequences: (assetId: string, sequences: Sequence[]) => void;
  patchSequence: (
    assetId: string,
    sequenceId: string,
    patch: Partial<Omit<Sequence, "id" | "frames">>
  ) => void;
  deleteSequence: (assetId: string, sequenceId: string) => void;
  replaceSequenceFrames: (
    assetId: string,
    sequenceId: string,
    frames: SequenceFrame[]
  ) => void;
  patchSequenceFrame: (
    assetId: string,
    sequenceId: string,
    frameId: string,
    patch: Partial<Omit<SequenceFrame, "id">>
  ) => void;

  /**
   * Bakes the scene's preview palette into every asset on it, so what
   * exports matches what is on screen. Returns how many were changed.
   */
  commitPaletteToScene: (sceneId: string) => number;

  /**
   * Runs several document mutations as one undo step and one network update.
   * A drag that wrote per pointermove produced a hundred of each.
   */
  batch: (mutate: () => void) => void;
}

export const useDoc = create<DocState>((set, get) => {
  const refresh = (): void => {
    const { sync } = get();
    if (!sync) return;

    set({
      revision: get().revision + 1,
      ready: sync.ready,
      scenes: doc.listScenes(sync.doc),
      project: doc.readProjectSettings(sync.doc),
      snippets: doc.listPromptSnippets(sync.doc),
      edits: Object.fromEntries(
        [...doc.assetEditsMap(sync.doc).keys()].flatMap((assetId) => {
          const entry = doc.readAssetEdits(sync.doc, assetId);
          return entry ? [[assetId, entry] as const] : [];
        })
      ),
      sets: doc.listAssetSets(sync.doc),
      canUndo: sync.undoManager.canUndo(),
      canRedo: sync.undoManager.canRedo()
    });
  };

  return {
    sync: null,
    ready: false,
    revision: 0,
    scenes: [],
    edits: {},
    sets: [],
    project: DEFAULT_PROJECT_SETTINGS,
    snippets: [],
    canUndo: false,
    canRedo: false,

    open(projectId, canEdit) {
      get().sync?.stop();

      const sync = new DocSync({
        projectId,
        canEdit,
        onChange: refresh,
        onError: (message) => useUi.getState().setError(message)
      });

      set({
        sync,
        ready: false,
        scenes: [],
        edits: {},
        sets: [],
        project: DEFAULT_PROJECT_SETTINGS,
        snippets: []
      });
      void sync.start();
    },

    close() {
      get().sync?.stop();
      set({
        sync: null,
        ready: false,
        scenes: [],
        edits: {},
        sets: [],
        project: DEFAULT_PROJECT_SETTINGS,
        snippets: []
      });
    },

    patchProjectSettings(patch) {
      const { sync } = get();
      if (sync) doc.patchProjectSettings(sync.doc, patch);
    },

    savePromptSnippet(kind, name, text) {
      const { sync } = get();
      if (!sync) return;

      doc.putPromptSnippet(sync.doc, {
        id: crypto.randomUUID(),
        name,
        kind,
        text
      });
    },

    deletePromptSnippet(id) {
      const { sync } = get();
      if (sync) doc.deletePromptSnippet(sync.doc, id);
    },

    undo() {
      get().sync?.undoManager.undo();
    },

    redo() {
      get().sync?.undoManager.redo();
    },

    scene(id) {
      const { sync } = get();
      return sync && id ? doc.readScene(sync.doc, id) : null;
    },

    createScene(name) {
      const { sync } = get();
      if (!sync) return null;

      const id = crypto.randomUUID();
      doc.createScene(sync.doc, id, name);

      return id;
    },

    deleteScene(id) {
      const { sync } = get();
      if (sync) doc.deleteScene(sync.doc, id);
    },

    patchScene(id, patch) {
      const { sync } = get();
      if (sync) doc.patchScene(sync.doc, id, patch);
    },

    addItem(sceneId, item) {
      const { sync } = get();
      if (!sync) return;

      doc.addItem(sync.doc, sceneId, {
        ...item,
        zIndex: doc.topZIndex(sync.doc, sceneId) + 1
      });
    },

    patchItem(sceneId, itemId, patch) {
      const { sync } = get();
      if (sync) doc.patchItem(sync.doc, sceneId, itemId, patch);
    },

    removeItem(sceneId, itemId) {
      const { sync } = get();
      if (sync) doc.removeItem(sync.doc, sceneId, itemId);
    },

    bringToFront(sceneId, itemId) {
      const { sync } = get();
      if (!sync) return;

      doc.patchItem(sync.doc, sceneId, itemId, {
        zIndex: doc.topZIndex(sync.doc, sceneId) + 1
      });
    },

    addGroup(sceneId, group) {
      const { sync } = get();
      if (!sync) return;

      doc.addGroup(sync.doc, sceneId, {
        ...group,
        zIndex: doc.topZIndex(sync.doc, sceneId) + 1
      });
    },

    convertItemToRepeater(sceneId, itemId) {
      const { sync } = get();
      if (!sync) return null;

      const id = crypto.randomUUID();
      const group = doc.convertItemToRepeater(
        sync.doc,
        sceneId,
        itemId,
        id,
        Math.floor(Math.random() * 0xffffffff)
      );
      return group?.id ?? null;
    },

    patchGroup(sceneId, groupId, patch) {
      const { sync } = get();
      if (sync) doc.patchGroup(sync.doc, sceneId, groupId, patch);
    },

    addGroupAssets(sceneId, groupId, assetIds) {
      const { sync } = get();
      if (sync) doc.addGroupAssets(sync.doc, sceneId, groupId, assetIds);
    },

    setGroupAssets(sceneId, groupId, assetIds) {
      const { sync } = get();
      if (sync) doc.setGroupAssets(sync.doc, sceneId, groupId, assetIds);
    },

    removeGroup(sceneId, groupId) {
      const { sync } = get();
      if (sync) doc.removeGroup(sync.doc, sceneId, groupId);
    },

    addTerrain(sceneId, terrain) {
      const { sync } = get();
      if (!sync) return;

      doc.addTerrain(sync.doc, sceneId, {
        ...terrain,
        zIndex: doc.topZIndex(sync.doc, sceneId) + 1
      });
    },

    patchTerrain(sceneId, terrainId, patch) {
      const { sync } = get();
      if (sync) doc.patchTerrain(sync.doc, sceneId, terrainId, patch);
    },

    setTerrainTile(sceneId, terrainId, index, patch) {
      const { sync } = get();
      if (sync) doc.setTerrainTile(sync.doc, sceneId, terrainId, index, patch);
    },

    removeTerrain(sceneId, terrainId) {
      const { sync } = get();
      if (sync) doc.removeTerrain(sync.doc, sceneId, terrainId);
    },

    clearScene(sceneId) {
      const { sync } = get();
      if (sync) doc.clearScene(sync.doc, sceneId);
    },

    addPaletteToPool(sceneId, paletteId) {
      const { sync } = get();
      if (sync) doc.addPaletteToPool(sync.doc, sceneId, paletteId);
    },

    removePaletteFromPool(sceneId, paletteId) {
      const { sync } = get();
      if (sync) doc.removePaletteFromPool(sync.doc, sceneId, paletteId);
    },

    /**
     * The worker writes asset rows but cannot write Yjs updates, so the first
     * client to notice a new asset creates its editable half, seeded from the
     * settings it was generated under. Every client tries; the document makes
     * that harmless.
     */
    backfill(assets, context = {}) {
      const { sync } = get();
      if (!sync) return;

      const folders = context.folders ?? {};
      const jobs = new Map((context.jobs ?? []).map((job) => [job.id, job]));

      for (const asset of assets) {
        const job = asset.jobId ? jobs.get(asset.jobId) : undefined;
        const spec = setSpecFromInputs(job?.inputs ?? asset.inputs);

        doc.ensureAssetEdits(sync.doc, asset.id, {
          folder: (asset.jobId && folders[asset.jobId]) || "",
          processing: asset.generatedWith,
          hidden: Boolean(spec)
        });

        if (spec && job) {
          doc.upsertSetMember(sync.doc, { id: setIdForJob(job), ...spec }, {
            assetId: asset.id,
            index: spec.index,
            col: spec.col,
            row: spec.row
          });
        }

        // A sheet generated as an animation arrives already sliced: the grid
        // it was drawn to is recorded on the row, so the rectangles follow
        // without fetching the PNG. Guarded on the asset having no sequence
        // rather than on the asset being new, because this runs on every
        // client and on every poll -- otherwise re-slicing by hand would be
        // undone a second later.
        if (!asset.sequencePlan) continue;

        const edits = doc.readAssetEdits(sync.doc, asset.id);
        if (!edits || Object.keys(edits.sequences).length > 0) continue;

        doc.replaceSequences(
          sync.doc,
          asset.id,
          sequencesFromPlan(
            asset.id,
            { width: asset.sourceWidth, height: asset.sourceHeight },
            asset.sequencePlan,
            () => crypto.randomUUID()
          )
        );
      }
    },

    editsFor(assetId) {
      return get().edits[assetId] ?? null;
    },

    rename(assetId, name) {
      const { sync } = get();
      if (sync) doc.patchAssetEdits(sync.doc, assetId, { name });
    },

    setFolder(assetId, folder) {
      const { sync } = get();
      if (sync) doc.patchAssetEdits(sync.doc, assetId, { folder });
    },

    setTags(assetId, tags) {
      const { sync } = get();
      if (sync) doc.setAssetTags(sync.doc, assetId, tags);
    },

    patchProcessing(assetId, patch) {
      const { sync } = get();
      if (sync) doc.patchAssetProcessing(sync.doc, assetId, patch);
    },

    applyProcessingToMany(assetIds, processing) {
      const { sync } = get();
      if (!sync) return;

      // One transaction, so copying settings onto forty sprites is one
      // Ctrl+Z rather than forty.
      doc.transactLocal(sync.doc, () => {
        for (const assetId of assetIds) {
          doc.patchAssetProcessing(sync.doc, assetId, processing);
        }
      });
    },

    purge(assetId) {
      const { sync } = get();
      if (sync) doc.purgeAsset(sync.doc, assetId);
    },

    setHidden(assetId, hidden) {
      const { sync } = get();
      if (sync) doc.setAssetHidden(sync.doc, assetId, hidden);
    },

    setSetView(setId, view) {
      const { sync } = get();
      if (sync) doc.patchAssetSet(sync.doc, setId, { view });
    },

    putSequence(assetId, sequence) {
      const { sync } = get();
      if (sync) doc.putSequence(sync.doc, assetId, sequence);
    },

    replaceSequences(assetId, sequences) {
      const { sync } = get();
      if (sync) doc.replaceSequences(sync.doc, assetId, sequences);
    },

    patchSequence(assetId, sequenceId, patch) {
      const { sync } = get();
      if (sync) doc.patchSequence(sync.doc, assetId, sequenceId, patch);
    },

    deleteSequence(assetId, sequenceId) {
      const { sync } = get();
      if (sync) doc.deleteSequence(sync.doc, assetId, sequenceId);
    },

    replaceSequenceFrames(assetId, sequenceId, frames) {
      const { sync } = get();
      if (sync) doc.replaceSequenceFrames(sync.doc, assetId, sequenceId, frames);
    },

    patchSequenceFrame(assetId, sequenceId, frameId, patch) {
      const { sync } = get();
      if (sync) doc.patchSequenceFrame(sync.doc, assetId, sequenceId, frameId, patch);
    },

    commitPaletteToScene(sceneId) {
      const { sync } = get();
      if (!sync) return 0;

      const scene = doc.readScene(sync.doc, sceneId);
      if (!scene?.palette) return 0;

      const assetIds = paletteBakeAssetIds(scene);

      doc.transactLocal(sync.doc, () => {
        for (const assetId of assetIds) {
          doc.patchAssetProcessing(sync.doc, assetId, {
            paletteId: scene.palette,
            dither: scene.paletteDither,
            ditherStrength: scene.paletteDitherStrength
          });
        }
      });

      return assetIds.length;
    },

    batch(mutate) {
      const { sync } = get();
      if (sync) doc.transactLocal(sync.doc, mutate);
      else mutate();
    }
  };
});
