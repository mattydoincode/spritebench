"use client";

import { create } from "zustand";
import type { ProcessingSettings } from "@/core/settings";
import { DEFAULT_PROCESSING } from "@/core/settings";
import type { Rgb } from "@/core/types";
import { ApiError, api, projectApi, rejectIfNotOk, sourceUrl } from "@/client/api";
import { processor } from "@/client/processor";
import type { PaletteInfo } from "@/db/repo/palettes";
import type { TemplateInfo } from "@/db/repo/templates";
import { clampGeneration, findModel, providerLabel, snapRequestSize } from "@/providers/models";
import { attachSheetFramePlate, isSheetFramesTemplate } from "@/core/frameMask";
import { attachSheetPixelPlate, isPixelConstraintTemplate, pixelConstraintWindow } from "@/core/pixelMask";
import {
  DEFAULT_GENERATION,
  type AssetRecord,
  type GenerationParams,
  type JobRecord,
  type ProjectSummary,
  type ResolvedAsset,
  type StudioSettings
} from "@/shared/model";
import { planAnimation, planItemGrid } from "@/shared/animationPrompt";
import { normalizeLayoutGuideInputs } from "@/shared/featurePrompt";
import { foldersByJobId, resolveJobFolder, suggestedFolder } from "@/shared/folder";
import { remapSelection } from "@/shared/libraryItems";
import { shouldRememberGeneration } from "@/shared/multistep";
import { expandPrompt } from "@/shared/promptVars";
import { expandSnippets } from "@/shared/snippets";
import { chooseBillingKey, type BillingChoice, type KeyDefaults } from "@/shared/billing";
import { defaultGenerateSetup, restoreGeneration } from "@/shared/restoreGeneration";
import {
  applyAssignStreamEvent,
  consumeAssignEvents,
  emptyAssignProgress
} from "@/shared/assignStream";
import type { EngineSlotRecord } from "@/shared/engineSlot";
import { applySlotEdits, sameAssignment, type SlotEdit } from "@/shared/slotEdits";
import { createSlotQueue } from "@/client/slotQueue";
import type { EngineCollectionView } from "@/shared/engineCollection";
import type { StudioBootstrap } from "@/shared/studioBootstrap";
import { recordSetup } from "@/client/promptHistory";
import { useDoc } from "./doc";
import { useUi } from "./ui";

export type { PaletteInfo, TemplateInfo };

export const EMPTY_PALETTE: Rgb[] = [];

/**
 * Everything the server owns: asset provenance, jobs, palettes, templates,
 * the project list, and this user's settings.
 *
 * Read-mostly and polled. Nothing here merges and nothing here is undoable --
 * an image the provider generated is a fact, and Ctrl+Z is not going to
 * un-spend the money. Editing lives in the Yjs document; this store is the
 * other half that `useAssets` merges with it.
 */

const FALLBACK_SETTINGS: StudioSettings = {
  generation: DEFAULT_GENERATION,
  processing: DEFAULT_PROCESSING,
  cutTemplateBackgroundOnPaste: true,
  templateCutTolerance: 0.28
};

/** Re-encodes anything the browser can decode, since the API takes PNG only. */
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

let settingsTimer: ReturnType<typeof setTimeout> | null = null;

export interface ApiTokenStatus {
  id: string;
  name: string;
  prefix: string;
  lastUsedAt: string | null;
  createdAt: string;
}

export interface ProviderKeyStatus {
  id: string;
  provider: string;
  label: string;
  keySuffix: string;
  isDefault: boolean;
  valid: boolean | null;
  validatedAt: string | null;
}

interface ServerState {
  /**
   * Which project the rows below (assets, jobs, slots, …) belong to. Null
   * while a project is loading, so a panel can tell "still loading" from
   * "empty" and never shows the last project's rows under this one's name.
   */
  loadedProjectId: string | null;
  projects: ProjectSummary[];
  project: ProjectSummary | null;

  settings: StudioSettings;
  /** Your own keys, for the settings page. */
  providerKeys: ProviderKeyStatus[];
  /**
   * The keys this project can bill: the owner's. Identical to `providerKeys`
   * on a project you own, and someone else's list on one shared with you.
   */
  projectKeys: ProviderKeyStatus[];
  /** Provider id → key id this project bills instead of the owner's default. */
  keyDefaults: KeyDefaults;

  assets: AssetRecord[];
  jobs: JobRecord[];
  palettes: PaletteInfo[];
  paletteColors: Record<string, Rgb[]>;
  templates: TemplateInfo[];
  apiTokens: ApiTokenStatus[];
  /** Plaintext PAT, only after mint, only until dismissed. */
  mintedToken: string | null;
  slots: EngineSlotRecord[];
  /** Godot collections of keyed records; their field slots are in `slots`. */
  collections: EngineCollectionView[];

  loadProjects: () => Promise<ProjectSummary[]>;
  /**
   * Switches to a project synchronously from what the server resolved for
   * the page: its summary, keys and your settings. Drops the last project's
   * rows. Call before paint so the old project never flashes.
   */
  beginProject: (bootstrap: StudioBootstrap) => void;
  /** Loads the rows for the project `beginProject` switched to. */
  openProject: (projectId: string) => Promise<void>;
  createProject: (name: string) => Promise<string | null>;
  renameProject: (projectId: string, name: string) => Promise<void>;
  deleteProject: (projectId: string) => Promise<void>;

  refreshAssets: () => Promise<void>;
  refreshJobs: () => Promise<void>;
  refreshTemplates: () => Promise<void>;
  refreshPalettes: () => Promise<void>;

  patchSettings: (patch: Partial<StudioSettings>) => void;
  setGeneration: (patch: Partial<GenerationParams>) => void;
  setDefaultProcessing: (patch: Partial<ProcessingSettings>) => void;

  generate: () => Promise<void>;
  restoreFromAsset: (asset: Pick<ResolvedAsset, "prompt" | "generation" | "generatedWith" | "inputs" | "sequencePlan" | "folder" | "label">) => void;
  resetGenerateDefaults: () => void;
  rerunSelected: () => Promise<void>;
  retryJob: (id: string) => Promise<void>;
  cancelJob: (id: string) => Promise<void>;
  dismissJob: (id: string) => Promise<void>;
  clearFailedJobs: () => Promise<void>;

  deleteAsset: (id: string) => Promise<void>;
  approve: (id: string, name?: string) => Promise<void>;

  ensurePalette: (paletteId: string) => Promise<Rgb[]>;
  addPalettes: (files: File[]) => Promise<void>;
  deletePalette: (paletteId: string) => Promise<void>;

  uploadTemplate: (
    file: File,
    options?: { cutBackground?: boolean; slot?: "base" | "mask" }
  ) => Promise<void>;
  uploadTemplates: (
    files: File[],
    options?: { cutBackground?: boolean; slot?: "base" | "mask" }
  ) => Promise<void>;
  uploadTemplateFromAsset: (assetId: string, slot?: "base" | "mask") => Promise<void>;
  deleteTemplate: (templateId: string) => Promise<void>;

  addProviderKey: (provider: string, label: string, key: string) => Promise<void>;
  removeProviderKey: (id: string) => Promise<void>;
  loadApiTokens: () => Promise<void>;
  createApiToken: (name: string) => Promise<string | null>;
  revokeApiToken: (id: string) => Promise<void>;
  clearMintedToken: () => void;
  refreshSlots: () => Promise<void>;
  assignSlot: (
    slotId: string,
    assetIds: string[],
    options?: { replace?: boolean }
  ) => Promise<void>;
  /** Queues an edit; slots export in parallel, edits to one slot in order. */
  editSlot: (slotId: string, edit: SlotEdit) => Promise<void>;
  createRecord: (collectionId: string, key: string, copyFrom?: string) => Promise<void>;
  renameRecord: (collectionId: string, recordId: string, key: string) => Promise<void>;
  deleteRecord: (collectionId: string, recordId: string) => Promise<void>;
  /** The key the next generation will bill, or null to let the server decide. */
  /** Which key a generation with `provider`'s models would bill, or why none. */
  billingFor: (provider: string) => BillingChoice;
  setAccountDefaultKey: (id: string) => Promise<void>;
  /** Null goes back to the owner's account default. */
  setProjectKeyDefault: (provider: string, keyId: string | null) => Promise<void>;
}

async function* iterateBody(body: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
  const reader = body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return;
      if (value) yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

export const useServer = create<ServerState>((set, get) => {
  /** The loaded project's id, or throws. Every project call goes through it. */
  const projectId = (): string => {
    const id = get().project?.id;
    if (!id) throw new Error("no project is open");
    return id;
  };

  const fail = (error: unknown): void => {
    useUi.getState().setError(error instanceof Error ? error.message : String(error));
  };

  const runSlotEdits = async (slotId: string, edits: SlotEdit[]): Promise<void> => {
    const current = get().slots.find((entry) => entry.id === slotId);
    if (!current) return;
    const existing = current.assignedAssetIds ?? [];
    const assetIds = applySlotEdits(current.intent ?? "texture", existing, edits);
    if (sameAssignment(assetIds, existing) && current.remoteHash) return;

    const ui = useUi.getState();
    ui.setError(null);
    ui.setAssigning(slotId, emptyAssignProgress(slotId, assetIds));

    try {
      const response = await fetch(`/api/v1/projects/${projectId()}/slots/${slotId}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetIds, replace: true })
      });
      await rejectIfNotOk(response);
      if (!response.body) throw new Error("assign stream missing body");

      const slot = await consumeAssignEvents(iterateBody(response.body), (event) => {
        const progress = useUi.getState().assigning[slotId];
        if (progress) useUi.getState().setAssigning(slotId, applyAssignStreamEvent(progress, event));
      });

      set({
        slots: get().slots.map((entry) => (entry.id === slot.id ? slot : entry))
      });
      void get().refreshAssets();
    } catch (error) {
      fail(error);
      void get().refreshSlots();
    } finally {
      useUi.getState().setAssigning(slotId, null);
    }
  };

  const slotQueue = createSlotQueue<SlotEdit>(runSlotEdits, (slotId, queued) =>
    useUi.getState().setAssignQueued(slotId, queued)
  );

  // Your own keys changed. On a project you own they are also the keys it
  // bills, so the model picker and billing line follow without a reload.
  const adoptOwnKeys = (providerKeys: ProviderKeyStatus[]): void => {
    set({
      providerKeys,
      projectKeys: get().project?.isOwner ? providerKeys : get().projectKeys
    });
  };

  const adoptCreated = (created: JobRecord[]): void => {
    if (created.length === 0) return;
    const seen = new Set(created.map((job) => job.id));
    set({ jobs: [...created, ...get().jobs.filter((job) => !seen.has(job.id))] });
    useUi.getState().selectMany(created.map((job) => job.id));
  };

  return {
    loadedProjectId: null,
    projects: [],
    project: null,

    settings: FALLBACK_SETTINGS,
    providerKeys: [],
    projectKeys: [],
    keyDefaults: {},

    assets: [],
    jobs: [],
    palettes: [],
    paletteColors: {},
    templates: [],
    apiTokens: [],
    mintedToken: null,
    slots: [],
    collections: [],

    async loadProjects() {
      try {
        const [{ projects }, settingsRes] = await Promise.all([
          api<{ projects: ProjectSummary[] }>("/api/projects"),
          api<{ settings: StudioSettings; providerKeys: ProviderKeyStatus[] }>("/api/settings")
        ]);

        set({
          projects,
          settings: settingsRes.settings,
          providerKeys: settingsRes.providerKeys
        });

        return projects;
      } catch (error) {
        fail(error);
        return [];
      }
    },

    beginProject({ project, projectKeys, keyDefaults, settings, providerKeys }) {
      const same = get().project?.id === project.id && get().loadedProjectId === project.id;

      set({
        project,
        projectKeys,
        keyDefaults,
        settings,
        providerKeys,
        // Reopening the project already in memory keeps its rows on screen
        // while fresh ones load; any other project starts empty.
        ...(same
          ? {}
          : {
              loadedProjectId: null,
              assets: [],
              jobs: [],
              palettes: [],
              templates: [],
              slots: [],
              collections: []
            })
      });
    },

    async openProject(id) {
      const project = get().project;
      if (!project || project.id !== id) return;

      // Every request below outlives the screen that made it. Anything that
      // lands after you have switched away is dropped, not merged into the
      // next project.
      const current = () => get().project?.id === id;

      // The document opens alongside the row data rather than after it: a
      // scene with no asset rows yet renders empty, which is correct,
      // whereas waiting for both makes a cold load feel twice as slow.
      useDoc.getState().open(id, project.role !== "viewer");

      try {
        const [assetsRes, jobsRes, palettesRes, templatesRes, slotsRes] = await Promise.all([
          projectApi<{ assets: AssetRecord[] }>(id, "/assets"),
          projectApi<{ jobs: JobRecord[] }>(id, "/jobs"),
          projectApi<{ palettes: PaletteInfo[] }>(id, "/palettes"),
          projectApi<{ templates: TemplateInfo[] }>(id, "/templates"),
          api<{ slots: EngineSlotRecord[]; collections?: EngineCollectionView[] }>(
            `/api/v1/projects/${id}/slots`
          ).catch(() => ({
            slots: [] as EngineSlotRecord[],
            collections: [] as EngineCollectionView[]
          }))
        ]);

        if (!current()) return;

        set({
          loadedProjectId: id,
          assets: assetsRes.assets,
          jobs: jobsRes.jobs,
          palettes: palettesRes.palettes,
          templates: templatesRes.templates,
          slots: slotsRes.slots,
          collections: slotsRes.collections ?? []
        });

        useDoc.getState().backfill(assetsRes.assets, {
          folders: foldersByJobId(jobsRes.jobs),
          jobs: jobsRes.jobs
        });
      } catch (error) {
        // Dropped if you have already left: an error about a project you
        // closed shows up as a banner on the dashboard, where it is neither
        // true nor actionable.
        if (!current()) return;
        set({ loadedProjectId: id });
        fail(error);
      }
    },

    async createProject(name) {
      try {
        const { project } = await api<{ project: ProjectSummary }>("/api/projects", {
          method: "POST",
          body: JSON.stringify({ name })
        });

        set({ projects: [...get().projects, project] });
        return project.id;
      } catch (error) {
        fail(error);
        return null;
      }
    },

    async renameProject(id, name) {
      const previous = get().projects;

      // Optimistic, because the dashboard is a list of names and waiting for a
      // round trip to redraw the one you just typed reads as a dropped edit.
      set({
        projects: previous.map((entry) => (entry.id === id ? { ...entry, name } : entry)),
        project: get().project?.id === id ? { ...get().project!, name } : get().project
      });

      try {
        await api(`/api/projects/${id}`, {
          method: "PATCH",
          body: JSON.stringify({ name })
        });
      } catch (error) {
        set({ projects: previous });
        fail(error);
      }
    },

    async deleteProject(id) {
      try {
        await api(`/api/projects/${id}`, { method: "DELETE" });

        set({
          projects: get().projects.filter((entry) => entry.id !== id),
          project: get().project?.id === id ? null : get().project
        });
      } catch (error) {
        fail(error);
      }
    },

    async refreshAssets() {
      const { assets } = await projectApi<{ assets: AssetRecord[] }>(projectId(), "/assets");
      set({ assets });

      // Anything the worker just inserted has no editable half yet. Seeding it
      // from the settings it was generated under is what makes a brand new
      // image show up with the right crop and palette already applied.
      useDoc.getState().backfill(assets, {
        folders: foldersByJobId(get().jobs),
        jobs: get().jobs
      });
    },

    async refreshJobs() {
      try {
        const { jobs } = await projectApi<{ jobs: JobRecord[] }>(projectId(), "/jobs");
        const previous = get().jobs;

        const finishedNow = jobs.some((job) => {
          const before = previous.find((entry) => entry.id === job.id);
          return before && before.status !== job.status && job.status === "done";
        });

        set({ jobs });
        const selected = remapSelection(useUi.getState().selectedIds, previous, jobs);
        if (selected.join("\0") !== useUi.getState().selectedIds.join("\0")) {
          useUi.getState().selectMany(selected);
        }
        if (finishedNow) await get().refreshAssets();
      } catch {
        // Polling is best effort; the next tick recovers.
      }
    },

    async refreshTemplates() {
      const { templates } = await projectApi<{ templates: TemplateInfo[] }>(
        projectId(),
        "/templates"
      );
      set({ templates });
    },

    async refreshPalettes() {
      const { palettes } = await projectApi<{ palettes: PaletteInfo[] }>(
        projectId(),
        "/palettes"
      );
      set({ palettes });
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

    setGeneration(patch) {
      get().patchSettings({
        generation: clampGeneration({ ...get().settings.generation, ...patch })
      });
    },

    setDefaultProcessing(patch) {
      get().patchSettings({ processing: { ...get().settings.processing, ...patch } });
    },

    async generate() {
      const ui = useUi.getState();
      // Snippets are filled in here, so the server and the job record see the
      // exact text that was sent, as they already do for variables.
      const promptBody = expandSnippets(ui.promptBody, useDoc.getState().snippets);
      const { settings } = get();

      if (promptBody.trim().length === 0) {
        ui.setError("write a prompt first");
        return;
      }

      ui.setBusy("queueing");
      ui.setError(null);

      // Sheet modes rewrite the request rather than being a flag the server
      // interprets: the grid rules go into the prompt, and the canvas is
      // pinned to the layout they describe. Auto-size is impossible here --
      // you cannot slice a grid out of a canvas whose size you did not choose.
      const animation = ui.animation.enabled
        ? planAnimation({
            subject: promptBody,
            actions: ui.animation.actions,
            cellSize: ui.animation.cellSize
          })
        : null;
      const itemGrid = ui.itemGrid.enabled
        ? planItemGrid({
            subject: promptBody,
            columns: ui.itemGrid.columns,
            rows: ui.itemGrid.rows,
            cellSize: ui.itemGrid.cellSize
          })
        : null;
      const loop = ui.loop.enabled;
      const chunk = ui.chunk.enabled;
      const each = ui.each.enabled;
      const sheet = loop || chunk || each ? null : animation ?? itemGrid;
      const cellSize = animation ? ui.animation.cellSize : ui.itemGrid.cellSize;
      const layout = normalizeLayoutGuideInputs({ base: ui.bases[0] ?? null, mask: ui.mask });
      const exampleBases = sheet ? [] : ui.bases;
      const pixelOn =
        layout.mask?.source.kind === "template" &&
        isPixelConstraintTemplate(layout.mask.source.templateId);
      const framesOn =
        layout.mask?.source.kind === "template" &&
        isSheetFramesTemplate(layout.mask.source.templateId);
      const pixelWindow = pixelOn
        ? pixelConstraintWindow(layout.mask?.window ?? settings.processing.targetSize)
        : null;
      const mask = pixelWindow && layout.mask ? { ...layout.mask, window: pixelWindow } : layout.mask;
      const sheetPixel = Boolean(sheet && pixelOn);
      const sheetFrames = Boolean(sheet && framesOn);
      const variables = ui.variables.filter((entry) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(entry.name));
      const prompt = {
        prefix: "",
        body: promptBody,
        suffix: "",
        guide: "",
        extra: ""
      };
      const expansions = expandPrompt(prompt, variables);
      const animate =
        ui.animateExpansions &&
        !loop &&
        !chunk &&
        !each &&
        !sheet &&
        expansions.length * Math.max(1, exampleBases.length) > 1;
      const requestSize =
        sheet && !sheetPixel ? sheet.sheet.size : settings.generation.size;
      const sequencePlan =
        sheet && sheetPixel && pixelWindow
          ? attachSheetPixelPlate(
              sheet.plan,
              snapRequestSize(requestSize, settings.generation.model),
              pixelWindow
            )
          : sheet && sheetFrames
            ? attachSheetFramePlate(
                sheet.plan,
                snapRequestSize(requestSize, settings.generation.model)
              )
            : (sheet?.plan ?? null);

      try {
        const { jobs: created } = await projectApi<{ jobs: JobRecord[] }>(projectId(), "/generate", {
          method: "POST",
          body: JSON.stringify({
            promptBody,
            // One image per job: more images come from batches. A stored
            // imageCount from before that has no control left to change it.
            generation: sheet
              ? {
                  ...settings.generation,
                  useAutoSize: false,
                  size: requestSize,
                  imageCount: 1
                }
              : { ...settings.generation, imageCount: 1 },
            processing:
              sheet && settings.processing.downsample
                ? {
                    ...settings.processing,
                    targetSize: sheetPixel
                      ? (pixelWindow ?? settings.processing.targetSize)
                      : { width: cellSize, height: 0 }
                  }
                : settings.processing,
            folder: resolveJobFolder(
              ui.folder,
              suggestedFolder({
                animation: Boolean(animation),
                itemGrid: Boolean(itemGrid) && !animation,
                many:
                  !loop &&
                  !chunk &&
                  (ui.batches > 1 ||
                    expansions.length > 1 ||
                    exampleBases.length > 1)
              })
            ),
            inputs:
              sheet && !sheetPixel && !sheetFrames
                ? null
                : {
                    base: sheet ? null : (exampleBases[0] ?? null),
                    mask,
                    loop: ui.loop.enabled
                      ? {
                          steps: ui.loop.steps,
                          ...(ui.loop.sendStart ? { sendStart: true } : {}),
                          ...(ui.loop.includeStart ? { includeStart: true } : {})
                        }
                      : null,
                    chunk: ui.chunk.enabled
                      ? { columns: ui.chunk.columns, rows: ui.chunk.rows }
                      : null,
                    each: each || null
                  },
            bases: exampleBases.length > 0 ? exampleBases : undefined,
            sequencePlan,
            batches: ui.batches,
            variables,
            animate,
            // Sheets, loops, chunks, and fan-out animations pin canvas or
            // imageCount for this job only. Writing those back is how
            // 1152x576 and a 32px asset size appeared without anyone setting them.
            remember: shouldRememberGeneration({
              sheet: Boolean(sheet),
              loop,
              chunk,
              animate
            })
              ? undefined
              : false
          })
        });

        adoptCreated(created);
        await get().refreshJobs();
      } catch (error) {
        fail(error);
      } finally {
        useUi.getState().setBusy(null);
      }
    },

    resetGenerateDefaults() {
      recordSetup();
      const restored = defaultGenerateSetup(get().settings.generation.model);
      useUi.getState().applyGenerationSetup(restored);
      useUi.getState().setBatches(1);
      get().setGeneration(restored.generation);
      get().setDefaultProcessing(restored.processing);
    },

    restoreFromAsset(asset) {
      recordSetup();
      const restored = restoreGeneration(asset);
      useUi.getState().applyGenerationSetup(restored);
      get().setGeneration(restored.generation);
      get().setDefaultProcessing(restored.processing);

      const model = findModel(restored.generation.model);
      if (model && !get().billingFor(model.provider).ok) {
        useUi
          .getState()
          .setNotice(
            `loaded setup from ${asset.label} — ${model.label} needs a ${providerLabel(model.provider)} key to generate`
          );
        return;
      }

      useUi.getState().setNotice(`loaded setup from ${asset.label}`);
    },

    async rerunSelected() {
      const ui = useUi.getState();
      const assetIds = ui.selectedIds.filter((id) => get().assets.some((asset) => asset.id === id));

      if (assetIds.length === 0) {
        ui.setError("select assets in the library to rerun");
        return;
      }

      ui.setBusy("queueing reruns");
      ui.setError(null);

      try {
        const edits = useDoc.getState().edits;
        const folders = new Set(
          assetIds
            .map((id) => edits[id]?.folder.trim() ?? "")
            .filter((folder) => folder.length > 0)
        );

        const { jobs: created } = await projectApi<{ jobs: JobRecord[] }>(projectId(), "/rerun", {
          method: "POST",
          body: JSON.stringify({
            assetIds,
            folder: folders.size === 1 ? [...folders][0] : undefined
          })
        });

        adoptCreated(created);
        await get().refreshJobs();
        useUi.getState().setNotice(`queued ${assetIds.length} rerun(s)`);
      } catch (error) {
        fail(error);
      } finally {
        useUi.getState().setBusy(null);
      }
    },

    async retryJob(id) {
      const job = get().jobs.find((entry) => entry.id === id);
      if (!job) return;

      useUi.getState().setBusy("queueing");

      try {
        const { jobs: created } = await projectApi<{ jobs: JobRecord[] }>(projectId(), "/generate", {
          method: "POST",
          body: JSON.stringify({
            // Replays the wrapper the original job ran with rather than
            // whatever the project says now, so a retry reproduces the job
            // instead of quietly generating something else.
            promptBody: job.prompt.body,
            promptPrefix: job.prompt.prefix,
            promptSuffix: job.prompt.suffix,
            promptGuide: job.prompt.guide,
            promptExtra: job.prompt.extra,
            generation: job.generation,
            processing: job.processing,
            folder: job.folder,
            inputs: job.inputs,
            label: job.label,
            batches: 1,
            remember: false
          })
        });

        adoptCreated(created);
        await get().refreshJobs();
        useUi.getState().setNotice(`requeued ${job.label}`);
      } catch (error) {
        fail(error);
      } finally {
        useUi.getState().setBusy(null);
      }
    },

    async cancelJob(id) {
      try {
        await projectApi(projectId(), `/jobs/${id}`, { method: "DELETE" });
        await get().refreshJobs();
      } catch (error) {
        fail(error);
      }
    },

    async dismissJob(id) {
      try {
        await projectApi(projectId(), `/jobs/${id}`, { method: "DELETE" });
        await get().refreshJobs();
      } catch (error) {
        fail(error);
      }
    },

    async clearFailedJobs() {
      try {
        const previous = get().jobs;
        const { jobs } = await projectApi<{ jobs: JobRecord[] }>(projectId(), "/jobs", {
          method: "DELETE"
        });
        set({ jobs });
        useUi.getState().selectMany(remapSelection(useUi.getState().selectedIds, previous, jobs));
      } catch (error) {
        fail(error);
      }
    },

    async deleteAsset(id) {
      try {
        await projectApi(projectId(), `/assets/${id}?files=true`, { method: "DELETE" });
      } catch (error) {
        fail(error);
        return;
      }

      set({ assets: get().assets.filter((asset) => asset.id !== id) });
      processor.evictAsset(projectId(), id);

      // Clearing it out of the document is a separate, undoable step: the row
      // is soft-deleted server-side, and un-deleting is a support action, but
      // pulling it off the scene is an edit like any other.
      useDoc.getState().purge(id);

      const ui = useUi.getState();
      ui.selectMany(ui.selectedIds.filter((entry) => entry !== id));
      if (ui.editingAssetId === id) ui.closeImageEditor();
      if (ui.slicingAssetId === id) ui.closeSlicer();
    },

    async approve(id, name) {
      const ui = useUi.getState();
      ui.setBusy("exporting");
      ui.setError(null);

      try {
        const { asset, exported } = await projectApi<{
          asset: AssetRecord;
          exported: { path: string; width: number; height: number };
        }>(projectId(), "/approve", {
          method: "POST",
          body: JSON.stringify({ assetId: id, name })
        });

        set({
          assets: get().assets.map((entry) => (entry.id === asset.id ? asset : entry))
        });

        useUi
          .getState()
          .setNotice(`exported ${exported.path} at ${exported.width}x${exported.height}`);
      } catch (error) {
        fail(error);
      } finally {
        useUi.getState().setBusy(null);
      }
    },

    async ensurePalette(paletteId) {
      if (!paletteId) return EMPTY_PALETTE;

      const cached = get().paletteColors[paletteId];
      if (cached) return cached;

      try {
        const { colors } = await projectApi<{ colors: Rgb[] }>(
          projectId(),
          `/palettes?id=${encodeURIComponent(paletteId)}`
        );

        set({ paletteColors: { ...get().paletteColors, [paletteId]: colors } });
        return colors;
      } catch {
        return EMPTY_PALETTE;
      }
    },

    async addPalettes(files) {
      if (files.length === 0) return;

      const ui = useUi.getState();
      ui.setBusy("adding palettes");
      ui.setError(null);

      try {
        const form = new FormData();
        for (const file of files) form.append("palette", file);

        const { added, failed, palettes } = await projectApi<{
          added: string[];
          failed: string[];
          palettes: PaletteInfo[];
        }>(projectId(), "/palettes", { method: "POST", body: form });

        set({ palettes });
        if (failed.length > 0) useUi.getState().setError(failed.join("; "));

        const sceneId = ui.activeScene(projectId());
        if (sceneId) {
          for (const paletteId of added) {
            useDoc.getState().addPaletteToPool(sceneId, paletteId);
            void get().ensurePalette(paletteId);
          }
        }
      } catch (error) {
        fail(error);
      } finally {
        useUi.getState().setBusy(null);
      }
    },

    async deletePalette(paletteId) {
      try {
        const { palettes } = await projectApi<{ palettes: PaletteInfo[] }>(
          projectId(),
          `/palettes?id=${encodeURIComponent(paletteId)}`,
          { method: "DELETE" }
        );
        set({ palettes });
      } catch (error) {
        fail(error);
      }
    },

    async uploadTemplate(file, options) {
      const ui = useUi.getState();
      ui.setBusy("saving template");
      ui.setError(null);

      try {
        const slot = options?.slot ?? "mask";
        const cutBackground =
          options?.cutBackground ??
          (slot === "base" ? false : get().settings.cutTemplateBackgroundOnPaste);
        const form = new FormData();
        form.append("image", await toPngFile(file));
        form.append("cutBackground", String(cutBackground));

        const { template } = await projectApi<{ template: TemplateInfo }>(
          projectId(),
          "/templates",
          { method: "POST", body: form }
        );

        await get().refreshTemplates();

        const uiState = useUi.getState();
        if (slot === "base") {
          uiState.addBases([
            {
              source: { kind: "template", templateId: template.id },
              fit: uiState.bases[0]?.fit ?? "contain",
              matchAspect: uiState.bases[0]?.matchAspect ?? true
            }
          ]);
        } else {
          uiState.setMask({
            source: { kind: "template", templateId: template.id },
            maskSource: uiState.mask?.maskSource ?? "keepOutsideShape",
            dilatePixels: uiState.mask?.dilatePixels ?? 0,
            fit: uiState.mask?.fit ?? "contain"
          });
        }

        useUi.getState().setNotice(`template ready at ${template.width}x${template.height}`);
      } catch (error) {
        fail(error);
      } finally {
        useUi.getState().setBusy(null);
      }
    },

    async uploadTemplates(files, options) {
      if (files.length === 0) return;
      for (const file of files) {
        await get().uploadTemplate(file, options);
      }
    },

    async uploadTemplateFromAsset(assetId, slot = "mask") {
      const ui = useUi.getState();
      ui.setBusy("saving template");
      ui.setError(null);

      try {
        const asset = get().assets.find((entry) => entry.id === assetId);
        if (!asset) throw new Error("asset not found");
        if (!asset.hasSource) {
          throw new Error("this image's full-resolution source has been rolled off");
        }

        const response = await fetch(sourceUrl(projectId(), assetId, "source"));
        if (!response.ok) {
          throw new Error(
            response.status === 410
              ? "this image's full-resolution source has been rolled off"
              : "could not load that asset"
          );
        }

        const blob = await response.blob();
        const file = new File([blob], `${assetId}.png`, { type: "image/png" });
        // Generated assets already have their own alpha. The paste-cut is for
        // sketches dropped from a white canvas, and would punch holes here.
        await get().uploadTemplate(file, { cutBackground: false, slot });
      } catch (error) {
        fail(error);
        useUi.getState().setBusy(null);
      }
    },

    async deleteTemplate(templateId) {
      try {
        await projectApi(projectId(), `/templates?id=${encodeURIComponent(templateId)}`, {
          method: "DELETE"
        });
        await get().refreshTemplates();

        const ui = useUi.getState();
        ui.setBases(
          ui.bases.filter(
            (entry) =>
              !(entry.source.kind === "template" && entry.source.templateId === templateId)
          )
        );
        if (ui.mask?.source.kind === "template" && ui.mask.source.templateId === templateId) {
          ui.setMask(null);
        }
      } catch (error) {
        fail(error);
      }
    },

    async addProviderKey(provider, label, key) {
      try {
        await api("/api/provider-keys", {
          method: "POST",
          body: JSON.stringify({ provider, label, key })
        });

        const { providerKeys } = await api<{ providerKeys: ProviderKeyStatus[] }>(
          "/api/provider-keys"
        );
        adoptOwnKeys(providerKeys);
      } catch (error) {
        if (error instanceof ApiError && error.status === 503) {
          useUi.getState().setError(error.message);
          return;
        }
        fail(error);
      }
    },

    async removeProviderKey(id) {
      try {
        const { providerKeys } = await api<{ providerKeys: ProviderKeyStatus[] }>(
          `/api/provider-keys?id=${encodeURIComponent(id)}`,
          { method: "DELETE" }
        );
        adoptOwnKeys(providerKeys);
      } catch (error) {
        fail(error);
      }
    },

    billingFor(provider) {
      return chooseBillingKey(provider, get().projectKeys, get().keyDefaults);
    },

    async setAccountDefaultKey(id) {
      try {
        const { providerKeys } = await api<{ providerKeys: ProviderKeyStatus[] }>(
          `/api/provider-keys?id=${encodeURIComponent(id)}`,
          { method: "PATCH" }
        );
        adoptOwnKeys(providerKeys);
      } catch (error) {
        fail(error);
      }
    },

    async setProjectKeyDefault(provider, keyId) {
      const previous = get().keyDefaults;
      const next = { ...previous };
      if (keyId) next[provider] = keyId;
      else delete next[provider];
      set({ keyDefaults: next });

      try {
        const { keyDefaults } = await projectApi<{ keyDefaults: Record<string, string> }>(
          projectId(),
          "/key-defaults",
          { method: "PUT", body: JSON.stringify({ provider, keyId }) }
        );
        set({ keyDefaults });
      } catch (error) {
        set({ keyDefaults: previous });
        fail(error);
      }
    },

    async loadApiTokens() {
      try {
        const { tokens } = await api<{ tokens: ApiTokenStatus[] }>("/api/tokens");
        set({ apiTokens: tokens });
      } catch (error) {
        fail(error);
      }
    },

    async createApiToken(name) {
      try {
        const { token, record } = await api<{ token: string; record: ApiTokenStatus }>(
          "/api/tokens",
          { method: "POST", body: JSON.stringify({ name }) }
        );
        set({ apiTokens: [record, ...get().apiTokens], mintedToken: token });
        return token;
      } catch (error) {
        fail(error);
        return null;
      }
    },

    async revokeApiToken(id) {
      try {
        await api(`/api/tokens/${id}`, { method: "DELETE" });
        set({ apiTokens: get().apiTokens.filter((token) => token.id !== id) });
      } catch (error) {
        fail(error);
      }
    },

    clearMintedToken() {
      set({ mintedToken: null });
    },

    async refreshSlots() {
      try {
        const { slots, collections } = await api<{
          slots: EngineSlotRecord[];
          collections?: EngineCollectionView[];
        }>(`/api/v1/projects/${projectId()}/slots`);
        set({ slots, collections: collections ?? [] });
      } catch {
        // Polling is best effort; the next tick recovers.
      }
    },

    assignSlot(slotId, assetIds, options) {
      return get().editSlot(slotId, {
        type: options?.replace === true ? "replace" : "add",
        assetIds
      });
    },

    editSlot(slotId, edit) {
      return slotQueue.enqueue(slotId, edit);
    },

    async createRecord(collectionId, key, copyFrom) {
      const base = `/api/v1/projects/${projectId()}/collections/${collectionId}/records`;
      try {
        const { id, collections } = await api<{
          id: string;
          collections: EngineCollectionView[];
        }>(base, { method: "POST", body: JSON.stringify({ key }) });
        set({ collections });
        await get().refreshSlots();
        if (!copyFrom) return;

        // A duplicate is a new record plus the same assignments, field by field.
        const collection = get().collections.find((entry) => entry.id === collectionId);
        const source = collection?.records.find((record) => record.id === copyFrom);
        const target = collection?.records.find((record) => record.id === id);
        if (!source || !target) return;
        await Promise.all(
          Object.entries(source.slots).map(([field, slotId]) => {
            const assigned = get().slots.find((slot) => slot.id === slotId)?.assignedAssetIds ?? [];
            const into = target.slots[field];
            return assigned.length > 0 && into
              ? get().assignSlot(into, assigned, { replace: true })
              : Promise.resolve();
          })
        );
      } catch (error) {
        fail(error);
      }
    },

    async renameRecord(collectionId, recordId, key) {
      try {
        const { collections } = await api<{ collections: EngineCollectionView[] }>(
          `/api/v1/projects/${projectId()}/collections/${collectionId}/records/${recordId}`,
          { method: "PATCH", body: JSON.stringify({ key }) }
        );
        set({ collections });
        await get().refreshSlots();
      } catch (error) {
        fail(error);
      }
    },

    async deleteRecord(collectionId, recordId) {
      try {
        const { collections } = await api<{ collections: EngineCollectionView[] }>(
          `/api/v1/projects/${projectId()}/collections/${collectionId}/records/${recordId}`,
          { method: "DELETE" }
        );
        set({ collections });
        await get().refreshSlots();
      } catch (error) {
        fail(error);
      }
    }
  };
});

/** True once the open project's rows have arrived (or failed to). */
export function useProjectLoaded(): boolean {
  return useServer((state) => state.project !== null && state.loadedProjectId === state.project.id);
}
