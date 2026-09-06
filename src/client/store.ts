"use client";

import { create } from "zustand";
import type { ImageEdit } from "@/core/edits";
import { DEFAULT_PROCESSING, type ProcessingSettings } from "@/core/settings";
import type { DitherMode, Rgb } from "@/core/types";
import {
  DEFAULT_GENERATION,
  type AssetRecord,
  type Composition,
  type GenerationParams,
  type JobRecord,
  type RepeatGroup,
  type StagedItem,
  type StudioSettings,
  type TemplateSpec
} from "@/shared/model";

export interface PaletteInfo {
  file: string;
  count: number;
  preview: Rgb[];
}

export const EMPTY_PALETTE: Rgb[] = [];

export interface TemplateInfo {
  file: string;
  width: number;
  height: number;
}

const FALLBACK_SETTINGS: StudioSettings = {
  promptPrefix: "",
  promptSuffix: "",
  assetSlug: "prop",
  generation: DEFAULT_GENERATION,
  processing: DEFAULT_PROCESSING,
  activeCompositionId: null,
  cutTemplateBackgroundOnPaste: true,
  templateCutTolerance: 0.28
};

function newComposition(): Composition {
  return {
    id: crypto.randomUUID(),
    name: "playground",
    updatedAt: new Date().toISOString(),
    unitsPerCell: 64,
    camera: { x: 0, y: 0, zoom: 4 },
    items: [],
    groups: [],
    palettePool: [],
    palette: "",
    paletteDither: "none",
    paletteDitherStrength: 1
  };
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers:
      init?.body instanceof FormData
        ? undefined
        : { "Content-Type": "application/json", ...(init?.headers ?? {}) }
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error: unknown }).error)
        : `request failed (${response.status})`;
    throw new Error(message);
  }

  return payload as T;
}

async function toPngFile(file: File): Promise<File> {
  if (file.type === "image/png") return file;

  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("could not convert that image to PNG");

  return new File([blob], "template.png", { type: "image/png" });
}

const PROMPT_KEY = "art-studio.promptBody";
const SCRATCH_KEY = "art-studio.scratch";

function readStored(key: string): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(key) ?? "";
}

const assetSaveTimers = new Map<string, ReturnType<typeof setTimeout>>();
let compositionTimer: ReturnType<typeof setTimeout> | null = null;
let settingsTimer: ReturnType<typeof setTimeout> | null = null;

interface StudioState {
  ready: boolean;
  hasApiKey: boolean;
  settings: StudioSettings;
  assets: AssetRecord[];
  jobs: JobRecord[];
  palettes: PaletteInfo[];
  paletteColors: Record<string, Rgb[]>;
  templates: TemplateInfo[];
  composition: Composition;
  selectedIds: string[];
  activeItemId: string | null;
  activeGroupId: string | null;
  editingAssetId: string | null;
  promptBody: string;
  scratch: string;
  batches: number;
  folder: string;
  template: TemplateSpec | null;
  snapToGrid: boolean;
  showGrid: boolean;
  lockFootprintAspect: boolean;
  busy: string | null;
  error: string | null;
  notice: string | null;

  load: () => Promise<void>;
  refreshJobs: () => Promise<void>;
  refreshAssets: () => Promise<void>;
  refreshTemplates: () => Promise<void>;

  setError: (message: string | null) => void;
  setNotice: (message: string | null) => void;

  patchSettings: (patch: Partial<StudioSettings>) => void;
  setPromptBody: (value: string) => void;
  setScratch: (value: string) => void;
  setBatches: (value: number) => void;
  setFolder: (value: string) => void;
  setGeneration: (patch: Partial<GenerationParams>) => void;
  setDefaultProcessing: (patch: Partial<ProcessingSettings>) => void;

  generate: () => Promise<void>;
  rerunSelected: () => Promise<void>;
  clearJobs: () => Promise<void>;
  cancelJob: (id: string) => Promise<void>;
  retryJob: (id: string) => Promise<void>;

  select: (id: string, additive: boolean) => void;
  selectMany: (ids: string[]) => void;
  clearSelection: () => void;

  updateAsset: (id: string, patch: Partial<AssetRecord>) => void;
  updateProcessing: (id: string, patch: Partial<ProcessingSettings>) => void;
  applyProcessingToSelection: (patch: Partial<ProcessingSettings>) => void;
  setEdits: (id: string, edits: ImageEdit[]) => void;
  openImageEditor: (id: string) => void;
  closeImageEditor: () => void;
  deleteAsset: (id: string) => Promise<void>;
  approve: (id: string, name?: string) => Promise<void>;

  ensurePalette: (file: string) => Promise<Rgb[]>;

  stageAsset: (assetId: string, at?: { x: number; y: number }) => void;
  updateItem: (itemId: string, patch: Partial<StagedItem>) => void;
  removeItem: (itemId: string) => void;
  setActiveItem: (itemId: string | null) => void;

  addGroup: () => void;
  updateGroup: (groupId: string, patch: Partial<RepeatGroup>) => void;
  removeGroup: (groupId: string) => void;
  setActiveGroup: (groupId: string | null) => void;
  setGroupAssets: (groupId: string, assetIds: string[]) => void;
  addToGroup: (groupId: string, assetIds: string[]) => void;
  setCamera: (camera: Partial<Composition["camera"]>) => void;
  setUnitsPerCell: (value: number) => void;
  clearStage: () => void;
  bringToFront: (itemId: string) => void;
  toggleSnap: () => void;
  toggleGrid: () => void;
  toggleFootprintLock: () => void;

  addPalettes: (files: File[]) => Promise<void>;
  addPaletteToPool: (file: string) => void;
  removePaletteFromPool: (file: string) => void;
  setPlaygroundPalette: (file: string) => void;
  setPaletteDither: (patch: { dither?: DitherMode; strength?: number }) => void;
  commitPaletteToStaged: () => void;

  uploadTemplate: (file: File) => Promise<void>;
  setTemplate: (template: TemplateSpec | null) => void;
  deleteTemplate: (file: string) => Promise<void>;
  importLegacy: () => Promise<void>;
}

export const useStudio = create<StudioState>((set, get) => ({
  ready: false,
  hasApiKey: false,
  settings: FALLBACK_SETTINGS,
  assets: [],
  jobs: [],
  palettes: [],
  paletteColors: {},
  templates: [],
  composition: newComposition(),
  selectedIds: [],
  activeItemId: null,
  activeGroupId: null,
  editingAssetId: null,
  promptBody: "",
  scratch: "",
  batches: 1,
  folder: "",
  template: null,
  snapToGrid: true,
  showGrid: true,
  lockFootprintAspect: true,
  busy: null,
  error: null,
  notice: null,

  async load() {
    try {
      const [settingsRes, assetsRes, jobsRes, palettesRes, compositionsRes, templatesRes] =
        await Promise.all([
          api<{ settings: StudioSettings; hasApiKey: boolean }>("/api/settings"),
          api<{ assets: AssetRecord[] }>("/api/assets"),
          api<{ jobs: JobRecord[] }>("/api/jobs"),
          api<{ palettes: PaletteInfo[] }>("/api/palettes"),
          api<{ compositions: Composition[] }>("/api/compositions"),
          api<{ templates: TemplateInfo[] }>("/api/templates")
        ]);

      const activeId = settingsRes.settings.activeCompositionId;
      const composition =
        compositionsRes.compositions.find((entry) => entry.id === activeId) ??
        compositionsRes.compositions[0] ??
        newComposition();

      set({
        ready: true,
        promptBody: readStored(PROMPT_KEY),
        scratch: readStored(SCRATCH_KEY),
        hasApiKey: settingsRes.hasApiKey,
        settings: settingsRes.settings,
        assets: assetsRes.assets,
        jobs: jobsRes.jobs,
        palettes: palettesRes.palettes,
        templates: templatesRes.templates,
        composition,
        error: null
      });

      const neededPalettes = new Set([
        settingsRes.settings.processing.paletteFile,
        ...composition.palettePool,
        composition.palette
      ]);

      for (const file of neededPalettes) {
        if (file) void get().ensurePalette(file);
      }
    } catch (error) {
      set({
        ready: true,
        promptBody: readStored(PROMPT_KEY),
        scratch: readStored(SCRATCH_KEY),
        error: error instanceof Error ? error.message : String(error)
      });
    }
  },

  async refreshJobs() {
    try {
      const { jobs } = await api<{ jobs: JobRecord[] }>("/api/jobs");
      const previous = get().jobs;

      const finishedNow = jobs.some((job) => {
        const before = previous.find((entry) => entry.id === job.id);
        return before && before.status !== job.status && job.status === "done";
      });

      set({ jobs });
      if (finishedNow) await get().refreshAssets();
    } catch {
      // polling is best effort
    }
  },

  async refreshAssets() {
    const { assets } = await api<{ assets: AssetRecord[] }>("/api/assets");
    set({ assets });
  },

  async refreshTemplates() {
    const { templates } = await api<{ templates: TemplateInfo[] }>("/api/templates");
    set({ templates });
  },

  setError(message) {
    set({ error: message });
  },

  setNotice(message) {
    set({ notice: message });
  },

  patchSettings(patch) {
    set({ settings: { ...get().settings, ...patch } });

    if (settingsTimer) clearTimeout(settingsTimer);
    settingsTimer = setTimeout(() => {
      settingsTimer = null;
      void api("/api/settings", {
        method: "PUT",
        body: JSON.stringify(get().settings)
      }).catch(() => undefined);
    }, 400);
  },

  setPromptBody(value) {
    set({ promptBody: value });
    if (typeof window !== "undefined") window.localStorage.setItem(PROMPT_KEY, value);
  },

  setScratch(value) {
    set({ scratch: value });
    if (typeof window !== "undefined") window.localStorage.setItem(SCRATCH_KEY, value);
  },

  setBatches(value) {
    set({ batches: Math.max(1, Math.min(20, Math.floor(value) || 1)) });
  },

  setFolder(value) {
    set({ folder: value });
  },

  setGeneration(patch) {
    get().patchSettings({ generation: { ...get().settings.generation, ...patch } });
  },

  setDefaultProcessing(patch) {
    get().patchSettings({ processing: { ...get().settings.processing, ...patch } });
  },

  async generate() {
    const { promptBody, settings, batches, folder, template } = get();

    if (promptBody.trim().length === 0) {
      set({ error: "write a prompt first" });
      return;
    }

    set({ busy: "queueing", error: null });

    try {
      await api("/api/generate", {
        method: "POST",
        body: JSON.stringify({
          promptBody,
          promptPrefix: settings.promptPrefix,
          promptSuffix: settings.promptSuffix,
          generation: settings.generation,
          processing: settings.processing,
          folder,
          template,
          batches
        })
      });

      await get().refreshJobs();
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    } finally {
      set({ busy: null });
    }
  },

  async rerunSelected() {
    const { selectedIds, settings } = get();
    if (selectedIds.length === 0) {
      set({ error: "select assets in the library to rerun" });
      return;
    }

    set({ busy: "queueing reruns", error: null });

    try {
      await api("/api/rerun", {
        method: "POST",
        body: JSON.stringify({
          assetIds: selectedIds,
          promptPrefix: settings.promptPrefix,
          promptSuffix: settings.promptSuffix
        })
      });

      await get().refreshJobs();
      set({ notice: `queued ${selectedIds.length} rerun(s) with the current prefix and suffix` });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    } finally {
      set({ busy: null });
    }
  },

  async clearJobs() {
    const { jobs } = await api<{ jobs: JobRecord[] }>("/api/jobs", { method: "DELETE" });
    set({ jobs });
  },

  async cancelJob(id) {
    try {
      await api(`/api/jobs/${id}`, { method: "DELETE" });
      await get().refreshJobs();
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    }
  },

  async retryJob(id) {
    const job = get().jobs.find((entry) => entry.id === id);
    if (!job) return;

    set({ busy: "queueing", error: null });

    try {
      await api("/api/generate", {
        method: "POST",
        body: JSON.stringify({
          promptBody: job.prompt.body,
          promptPrefix: job.prompt.prefix,
          promptSuffix: job.prompt.suffix,
          generation: job.generation,
          processing: job.processing,
          folder: job.folder,
          template: job.template,
          label: job.label,
          batches: 1,
          remember: false
        })
      });

      await get().refreshJobs();
      set({ notice: `requeued ${job.label}` });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    } finally {
      set({ busy: null });
    }
  },

  select(id, additive) {
    const { selectedIds, composition, activeItemId } = get();

    if (!additive) {
      const staged = composition.items.filter((item) => item.assetId === id);
      const alreadyActive = staged.some((item) => item.id === activeItemId);

      set({
        selectedIds: [id],
        activeItemId: alreadyActive ? activeItemId : (staged[0]?.id ?? null)
      });
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

  updateAsset(id, patch) {
    set({
      assets: get().assets.map((asset) => (asset.id === id ? { ...asset, ...patch } : asset))
    });

    const existing = assetSaveTimers.get(id);
    if (existing) clearTimeout(existing);

    assetSaveTimers.set(
      id,
      setTimeout(() => {
        assetSaveTimers.delete(id);
        const asset = get().assets.find((entry) => entry.id === id);
        if (!asset) return;

        void api(`/api/assets/${id}`, {
          method: "PATCH",
          body: JSON.stringify({
            name: asset.name,
            folder: asset.folder,
            tags: asset.tags,
            processing: asset.processing,
            approvedName: asset.approvedName
          })
        }).catch((error) => set({ error: String(error) }));
      }, 400)
    );
  },

  updateProcessing(id, patch) {
    const asset = get().assets.find((entry) => entry.id === id);
    if (!asset) return;

    const processing = { ...asset.processing, ...patch };
    get().updateAsset(id, { processing });

    if (patch.paletteFile) void get().ensurePalette(patch.paletteFile);
  },

  applyProcessingToSelection(patch) {
    const shared = { ...patch };
    delete shared.edits;

    for (const id of get().selectedIds) get().updateProcessing(id, shared);
  },

  setEdits(id, edits) {
    get().updateProcessing(id, { edits });
  },

  openImageEditor(id) {
    set({ editingAssetId: id });
  },

  closeImageEditor() {
    set({ editingAssetId: null });
  },

  async deleteAsset(id) {
    await api(`/api/assets/${id}?files=true`, { method: "DELETE" });

    set({
      assets: get().assets.filter((asset) => asset.id !== id),
      selectedIds: get().selectedIds.filter((entry) => entry !== id),
      editingAssetId: get().editingAssetId === id ? null : get().editingAssetId,
      composition: {
        ...get().composition,
        items: get().composition.items.filter((item) => item.assetId !== id),
        groups: get()
          .composition.groups.map((group) => ({
            ...group,
            assetIds: group.assetIds.filter((entry) => entry !== id)
          }))
          .filter((group) => group.assetIds.length > 0)
      }
    });

    get().setCamera({});
  },

  async approve(id, name) {
    set({ busy: "exporting", error: null });

    try {
      const { asset, exported } = await api<{
        asset: AssetRecord;
        exported: { path: string; width: number; height: number };
      }>("/api/approve", {
        method: "POST",
        body: JSON.stringify({ assetId: id, name })
      });

      set({
        assets: get().assets.map((entry) => (entry.id === asset.id ? asset : entry)),
        notice: `exported ${exported.path} at ${exported.width}x${exported.height}`
      });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    } finally {
      set({ busy: null });
    }
  },

  async ensurePalette(file) {
    if (!file) return [];

    const cached = get().paletteColors[file];
    if (cached) return cached;

    try {
      const { colors } = await api<{ colors: Rgb[] }>(
        `/api/palettes?file=${encodeURIComponent(file)}`
      );
      set({ paletteColors: { ...get().paletteColors, [file]: colors } });
      return colors;
    } catch {
      return [];
    }
  },

  stageAsset(assetId, at) {
    const { composition, assets } = get();
    const asset = assets.find((entry) => entry.id === assetId);
    if (!asset) return;

    const existing = composition.items.length;
    const maxZ = [...composition.items, ...composition.groups].reduce(
      (top, entry) => Math.max(top, entry.zIndex),
      0
    );

    const item: StagedItem = {
      id: crypto.randomUUID(),
      assetId,
      x: at ? at.x : (existing % 6) * 96,
      y: at ? at.y : Math.floor(existing / 6) * 96,
      footprint: { width: 0, height: 0 },
      zIndex: maxZ + 1,
      flipHorizontal: false,
      flipVertical: false,
      showSource: false,
      opacity: 1
    };

    persistComposition(set, get, { ...composition, items: [...composition.items, item] });
    set({ activeItemId: item.id });
  },

  updateItem(itemId, patch) {
    const { composition } = get();
    persistComposition(set, get, {
      ...composition,
      items: composition.items.map((item) => (item.id === itemId ? { ...item, ...patch } : item))
    });
  },

  removeItem(itemId) {
    const { composition } = get();
    persistComposition(set, get, {
      ...composition,
      items: composition.items.filter((item) => item.id !== itemId)
    });
    if (get().activeItemId === itemId) set({ activeItemId: null });
  },

  setActiveItem(itemId) {
    set({ activeItemId: itemId, activeGroupId: itemId === null ? get().activeGroupId : null });
    if (itemId === null) return;

    const item = get().composition.items.find((entry) => entry.id === itemId);
    if (item) set({ selectedIds: [item.assetId] });
  },

  addGroup() {
    const { composition, selectedIds, assets } = get();

    const assetIds = selectedIds.filter((id) => assets.some((asset) => asset.id === id));

    const maxZ = [...composition.items, ...composition.groups].reduce(
      (top, entry) => Math.max(top, entry.zIndex),
      0
    );

    const group: RepeatGroup = {
      id: crypto.randomUUID(),
      assetIds,
      x: Math.round(composition.camera.x),
      y: Math.round(composition.camera.y),
      cell: { width: 0, height: 0 },
      marginX: 0,
      marginY: 0,
      countX: 8,
      countY: 8,
      fillX: false,
      fillY: false,
      randomRotate: false,
      background: "",
      zIndex: maxZ + 1,
      opacity: 1,
      seed: Math.floor(Math.random() * 1e9)
    };

    persistComposition(set, get, { ...composition, groups: [...composition.groups, group] });
    set({ activeGroupId: group.id, activeItemId: null });
  },

  updateGroup(groupId, patch) {
    const { composition } = get();
    persistComposition(set, get, {
      ...composition,
      groups: composition.groups.map((group) =>
        group.id === groupId ? { ...group, ...patch } : group
      )
    });
  },

  removeGroup(groupId) {
    const { composition } = get();
    persistComposition(set, get, {
      ...composition,
      groups: composition.groups.filter((group) => group.id !== groupId)
    });
    if (get().activeGroupId === groupId) set({ activeGroupId: null });
  },

  setActiveGroup(groupId) {
    set({ activeGroupId: groupId, activeItemId: groupId === null ? get().activeItemId : null });
    if (groupId === null) return;

    const group = get().composition.groups.find((entry) => entry.id === groupId);
    if (group && group.assetIds.length > 0) set({ selectedIds: [...group.assetIds] });
  },

  setGroupAssets(groupId, assetIds) {
    if (assetIds.length === 0) return;
    get().updateGroup(groupId, { assetIds });
  },

  addToGroup(groupId, assetIds) {
    const group = get().composition.groups.find((entry) => entry.id === groupId);
    if (!group) return;

    const known = get().assets;
    const additions = assetIds.filter(
      (id) => !group.assetIds.includes(id) && known.some((asset) => asset.id === id)
    );

    if (additions.length === 0) return;

    get().updateGroup(groupId, { assetIds: [...group.assetIds, ...additions] });
    set({ activeGroupId: groupId, activeItemId: null });
  },

  setCamera(camera) {
    const { composition } = get();
    persistComposition(set, get, {
      ...composition,
      camera: { ...composition.camera, ...camera }
    });
  },

  setUnitsPerCell(value) {
    const { composition } = get();
    persistComposition(set, get, {
      ...composition,
      unitsPerCell: Math.max(1, Math.floor(value) || 1)
    });
  },

  clearStage() {
    const { composition } = get();
    persistComposition(set, get, { ...composition, items: [], groups: [] });
    set({ activeItemId: null, activeGroupId: null });
  },

  bringToFront(itemId) {
    const { composition } = get();
    const maxZ = [...composition.items, ...composition.groups].reduce(
      (top, entry) => Math.max(top, entry.zIndex),
      0
    );
    get().updateItem(itemId, { zIndex: maxZ + 1 });
  },

  toggleSnap() {
    set({ snapToGrid: !get().snapToGrid });
  },

  toggleGrid() {
    set({ showGrid: !get().showGrid });
  },

  toggleFootprintLock() {
    set({ lockFootprintAspect: !get().lockFootprintAspect });
  },

  async addPalettes(files) {
    if (files.length === 0) return;

    set({ busy: "adding palettes", error: null });

    try {
      const form = new FormData();
      for (const file of files) form.append("palette", file);

      const { added, failed, palettes } = await api<{
        added: string[];
        failed: string[];
        palettes: PaletteInfo[];
      }>("/api/palettes", { method: "POST", body: form });

      set({ palettes, error: failed.length > 0 ? failed.join("; ") : null });

      for (const file of added) get().addPaletteToPool(file);
      if (added.length > 0) get().setPlaygroundPalette(added[added.length - 1]);
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    } finally {
      set({ busy: null });
    }
  },

  addPaletteToPool(file) {
    if (!file) return;

    const { composition } = get();
    if (composition.palettePool.includes(file)) {
      get().setPlaygroundPalette(file);
      return;
    }

    persistComposition(set, get, {
      ...composition,
      palettePool: [...composition.palettePool, file],
      palette: file
    });

    void get().ensurePalette(file);
  },

  removePaletteFromPool(file) {
    const { composition } = get();

    persistComposition(set, get, {
      ...composition,
      palettePool: composition.palettePool.filter((entry) => entry !== file),
      palette: composition.palette === file ? "" : composition.palette
    });
  },

  setPlaygroundPalette(file) {
    const { composition } = get();
    persistComposition(set, get, { ...composition, palette: file });

    if (file) void get().ensurePalette(file);
  },

  setPaletteDither(patch) {
    const { composition } = get();

    persistComposition(set, get, {
      ...composition,
      paletteDither: patch.dither ?? composition.paletteDither,
      paletteDitherStrength: patch.strength ?? composition.paletteDitherStrength
    });
  },

  commitPaletteToStaged() {
    const { composition } = get();
    const paletteFile = composition.palette;
    if (!paletteFile) return;

    const assetIds = new Set([
      ...composition.items.map((item) => item.assetId),
      ...composition.groups.flatMap((group) => group.assetIds)
    ]);
    for (const id of assetIds) {
      get().updateProcessing(id, {
        paletteFile,
        dither: composition.paletteDither,
        ditherStrength: composition.paletteDitherStrength
      });
    }

    set({ notice: `${assetIds.size} asset(s) now export with ${paletteFile}` });
  },

  async uploadTemplate(file) {
    const { settings } = get();
    set({ busy: "saving template", error: null });

    try {
      const form = new FormData();
      form.append("image", await toPngFile(file));
      form.append("cutBackground", String(settings.cutTemplateBackgroundOnPaste));

      const { template } = await api<{ template: TemplateInfo }>("/api/templates", {
        method: "POST",
        body: form
      });

      await get().refreshTemplates();

      set({
        template: {
          file: template.file,
          fit: "contain",
          maskSource: "keepOutsideShape",
          matchAspect: true,
          dilatePixels: 0,
          useAsMask: true
        },
        notice: `template ready at ${template.width}x${template.height}`
      });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    } finally {
      set({ busy: null });
    }
  },

  setTemplate(template) {
    set({ template });
  },

  async deleteTemplate(file) {
    await api(`/api/templates?file=${encodeURIComponent(file)}`, { method: "DELETE" });
    await get().refreshTemplates();
    if (get().template?.file === file) set({ template: null });
  },

  async importLegacy() {
    set({ busy: "importing", error: null });

    try {
      const result = await api<{ imported: number; total: number }>("/api/import", {
        method: "POST"
      });
      await get().refreshAssets();
      set({ notice: `imported ${result.imported} existing asset(s)` });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    } finally {
      set({ busy: null });
    }
  }
}));

function persistComposition(
  set: (partial: Partial<StudioState>) => void,
  get: () => StudioState,
  composition: Composition
): void {
  set({ composition });

  if (compositionTimer) clearTimeout(compositionTimer);
  compositionTimer = setTimeout(() => {
    compositionTimer = null;
    void saveComposition(set, get);
  }, 500);
}

/**
 * Writes the composition, sending the version we last saw so the server can
 * refuse a write that would clobber another tab. On conflict we adopt the
 * server's copy rather than silently overwriting it.
 */
async function saveComposition(
  set: (partial: Partial<StudioState>) => void,
  get: () => StudioState
): Promise<void> {
  const local = get().composition;

  const response = await fetch("/api/compositions", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      ...(local.version !== undefined ? { "If-Match": String(local.version) } : {})
    },
    body: JSON.stringify(local)
  }).catch(() => null);

  if (!response) return;

  const payload = (await response.json().catch(() => null)) as {
    composition?: Composition;
    error?: string;
  } | null;

  if (response.status === 409 && payload?.composition) {
    set({
      composition: payload.composition,
      notice: "this composition changed elsewhere, so the newer version was loaded"
    });
    return;
  }

  if (!response.ok || !payload?.composition) return;

  // Adopt the new version number so the next save carries it.
  const saved = payload.composition;
  if (get().composition.id === saved.id) {
    set({ composition: { ...get().composition, version: saved.version } });
  }
}
