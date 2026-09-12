"use client";

import { create } from "zustand";
import type { ProcessingSettings } from "@/core/settings";
import { DEFAULT_PROCESSING } from "@/core/settings";
import type { Rgb } from "@/core/types";
import { ApiError, api, projectApi, sourceUrl } from "@/client/api";
import type { PaletteInfo } from "@/db/repo/palettes";
import type { TemplateInfo } from "@/db/repo/templates";
import { clampGeneration } from "@/providers/models";
import {
  DEFAULT_GENERATION,
  type AssetRecord,
  type GenerationParams,
  type JobRecord,
  type ProjectSummary,
  type StudioSettings
} from "@/shared/model";
import { isPixelConstraintTemplate, pixelConstraintWindow } from "@/core/pixelMask";
import { planAnimation, planItemGrid } from "@/shared/animationPrompt";
import { normalizeLayoutGuideInputs, workingPrompt } from "@/shared/featurePrompt";
import { foldersByJobId, resolveJobFolder, suggestedFolder } from "@/shared/folder";
import { shouldRememberGeneration } from "@/shared/multistep";
import { expandPrompt } from "@/shared/promptVars";
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

export interface ProviderKeyStatus {
  id: string;
  provider: string;
  label: string;
  keySuffix: string;
  valid: boolean | null;
  validatedAt: string | null;
}

interface ServerState {
  ready: boolean;
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

  assets: AssetRecord[];
  jobs: JobRecord[];
  palettes: PaletteInfo[];
  paletteColors: Record<string, Rgb[]>;
  templates: TemplateInfo[];

  loadProjects: () => Promise<ProjectSummary[]>;
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
  rerunSelected: () => Promise<void>;
  retryJob: (id: string) => Promise<void>;
  cancelJob: (id: string) => Promise<void>;
  clearJobs: () => Promise<void>;

  deleteAsset: (id: string) => Promise<void>;
  approve: (id: string, name?: string) => Promise<void>;

  ensurePalette: (paletteId: string) => Promise<Rgb[]>;
  addPalettes: (files: File[]) => Promise<void>;
  deletePalette: (paletteId: string) => Promise<void>;

  uploadTemplate: (
    file: File,
    options?: { cutBackground?: boolean; slot?: "base" | "mask" }
  ) => Promise<void>;
  uploadTemplateFromAsset: (assetId: string, slot?: "base" | "mask") => Promise<void>;
  deleteTemplate: (templateId: string) => Promise<void>;

  addProviderKey: (provider: string, label: string, key: string) => Promise<void>;
  removeProviderKey: (id: string) => Promise<void>;
  refreshProjectKeys: () => Promise<void>;
  /** The key the next generation will bill, or null to let the server decide. */
  billingKeyId: () => string | null;
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

  return {
    ready: false,
    projects: [],
    project: null,

    settings: FALLBACK_SETTINGS,
    providerKeys: [],
    projectKeys: [],

    assets: [],
    jobs: [],
    palettes: [],
    paletteColors: {},
    templates: [],

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

    async openProject(id) {
      const project = get().projects.find((entry) => entry.id === id);
      if (!project) return;

      set({ ready: false, project, assets: [], jobs: [], palettes: [], templates: [] });

      // The document opens alongside the row data rather than after it: a
      // scene with no asset rows yet renders empty, which is correct,
      // whereas waiting for both makes a cold load feel twice as slow.
      useDoc.getState().open(id, project.role !== "viewer");

      try {
        const [assetsRes, jobsRes, palettesRes, templatesRes] = await Promise.all([
          projectApi<{ assets: AssetRecord[] }>(id, "/assets"),
          projectApi<{ jobs: JobRecord[] }>(id, "/jobs"),
          projectApi<{ palettes: PaletteInfo[] }>(id, "/palettes"),
          projectApi<{ templates: TemplateInfo[] }>(id, "/templates")
        ]);

        set({
          ready: true,
          assets: assetsRes.assets,
          jobs: jobsRes.jobs,
          palettes: palettesRes.palettes,
          templates: templatesRes.templates
        });

        useDoc.getState().backfill(assetsRes.assets, {
          folders: foldersByJobId(jobsRes.jobs),
          jobs: jobsRes.jobs
        });

        if (project.canGenerate || project.isOwner) {
          const { keys } = await projectApi<{ keys: ProviderKeyStatus[] }>(id, "/keys");
          set({ projectKeys: keys });
        }
      } catch (error) {
        set({ ready: true });

        // Dropped if you have already left. These requests outlive the screen
        // that made them, and an error about a project you closed shows up as
        // a banner on the dashboard, where it is neither true nor actionable.
        if (get().project?.id === id) fail(error);
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
      const { settings } = get();

      if (ui.promptBody.trim().length === 0) {
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
            subject: ui.promptBody,
            actions: ui.animation.actions,
            cellSize: ui.animation.cellSize
          })
        : null;
      const itemGrid = ui.itemGrid.enabled
        ? planItemGrid({
            subject: ui.promptBody,
            columns: ui.itemGrid.columns,
            rows: ui.itemGrid.rows,
            cellSize: ui.itemGrid.cellSize
          })
        : null;
      const loop = ui.loop.enabled;
      const chunk = ui.chunk.enabled;
      const sheet = loop || chunk ? null : animation ?? itemGrid;
      const cellSize = animation ? ui.animation.cellSize : ui.itemGrid.cellSize;
      const variables = ui.variables.filter((entry) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(entry.name));
      const projectSettings = useDoc.getState().project;
      const prompt = workingPrompt({
        prefix: projectSettings.promptPrefix,
        body: ui.promptBody,
        suffix: projectSettings.promptSuffix,
        model: settings.generation.model,
        mask: sheet ? null : ui.mask,
        base: sheet ? null : ui.base,
        animation: ui.animation,
        itemGrid: ui.itemGrid,
        overrides: ui.featurePrompts
      });
      const expansions = expandPrompt(prompt, variables);

      try {
        await projectApi(projectId(), "/generate", {
          method: "POST",
          body: JSON.stringify({
            promptBody: ui.promptBody,
            promptGuide: prompt.guide,
            promptExtra: prompt.extra,
            // Prefix and suffix are omitted: they live in the shared document,
            // and the server reads them from there rather than trusting a
            // copy that may be a poll behind.
            providerKeyId: get().billingKeyId(),
            generation: sheet
              ? {
                  ...settings.generation,
                  useAutoSize: false,
                  size: sheet.sheet.size,
                  imageCount: 1
                }
              : loop || chunk
                ? { ...settings.generation, imageCount: 1 }
                : settings.generation,
            processing: sheet
              ? {
                  ...settings.processing,
                  // Frames force trim off, so the cell rectangle is what sets
                  // the sprite's size. Height derives from the square cell.
                  targetSize: { width: cellSize, height: 0 }
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
                  (ui.batches > 1 || settings.generation.imageCount > 1 || expansions.length > 1)
              })
            ),
            inputs: sheet
              ? null
              : (() => {
                  const layout = normalizeLayoutGuideInputs({ base: ui.base, mask: ui.mask });
                  const mask =
                    layout.mask?.source.kind === "template" &&
                    isPixelConstraintTemplate(layout.mask.source.templateId)
                      ? {
                          ...layout.mask,
                          window: pixelConstraintWindow(settings.processing.targetSize)
                        }
                      : layout.mask;
                  return {
                    base: layout.base,
                    mask,
                    loop: ui.loop.enabled ? { steps: ui.loop.steps } : null,
                    chunk: ui.chunk.enabled
                      ? { columns: ui.chunk.columns, rows: ui.chunk.rows }
                      : null
                  };
                })(),
            sequencePlan: sheet?.plan ?? null,
            batches: ui.batches,
            variables,
            // Sheets, loops, and chunks pin canvas or imageCount for this job
            // only. Writing those back is how 1152x576 and a 32px asset size
            // appeared without anyone setting them.
            remember: shouldRememberGeneration({
              sheet: Boolean(sheet),
              loop,
              chunk
            })
              ? undefined
              : false
          })
        });

        await get().refreshJobs();
      } catch (error) {
        fail(error);
      } finally {
        useUi.getState().setBusy(null);
      }
    },

    async rerunSelected() {
      const ui = useUi.getState();
      const { settings } = get();

      if (ui.selectedIds.length === 0) {
        ui.setError("select assets in the library to rerun");
        return;
      }

      ui.setBusy("queueing reruns");
      ui.setError(null);

      try {
        const edits = useDoc.getState().edits;
        const folders = new Set(
          ui.selectedIds
            .map((id) => edits[id]?.folder.trim() ?? "")
            .filter((folder) => folder.length > 0)
        );

        await projectApi(projectId(), "/rerun", {
          method: "POST",
          body: JSON.stringify({
            assetIds: ui.selectedIds,
            providerKeyId: get().billingKeyId(),
            folder: folders.size === 1 ? [...folders][0] : undefined
          })
        });

        await get().refreshJobs();
        useUi
          .getState()
          .setNotice(
            `queued ${ui.selectedIds.length} rerun(s) with the project's current prompt wrapper`
          );
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
        await projectApi(projectId(), "/generate", {
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
            providerKeyId: get().billingKeyId(),
            generation: job.generation,
            processing: job.processing,
            folder: job.folder,
            inputs: job.inputs,
            label: job.label,
            batches: 1,
            remember: false
          })
        });

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

    async clearJobs() {
      try {
        const { jobs } = await projectApi<{ jobs: JobRecord[] }>(projectId(), "/jobs", {
          method: "DELETE"
        });
        set({ jobs });
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
        const cutBackground = options?.cutBackground ?? get().settings.cutTemplateBackgroundOnPaste;
        const form = new FormData();
        form.append("image", await toPngFile(file));
        form.append("cutBackground", String(cutBackground));

        const { template } = await projectApi<{ template: TemplateInfo }>(
          projectId(),
          "/templates",
          { method: "POST", body: form }
        );

        await get().refreshTemplates();

        const slot = options?.slot ?? "mask";
        const uiState = useUi.getState();
        if (slot === "base") {
          uiState.setBase({
            source: { kind: "template", templateId: template.id },
            fit: uiState.base?.fit ?? "contain",
            matchAspect: uiState.base?.matchAspect ?? true
          });
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
        if (ui.base?.source.kind === "template" && ui.base.source.templateId === templateId) {
          ui.setBase(null);
        }
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
        set({ providerKeys });
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
        set({ providerKeys });
      } catch (error) {
        fail(error);
      }
    },

    /**
     * Resolves the remembered choice against what the project can actually
     * bill. A key the owner has since deleted is dropped rather than sent, so
     * the request falls through to the server's own single-key default
     * instead of being refused for naming a key that no longer exists.
     */
    billingKeyId() {
      const project = get().project;
      if (!project) return null;

      const remembered = useUi.getState().providerKeyId[project.id];
      const options = get().projectKeys;

      if (remembered && options.some((option) => option.id === remembered)) {
        return remembered;
      }

      return options.length === 1 ? options[0].id : null;
    },

    async refreshProjectKeys() {
      try {
        const { keys } = await projectApi<{ keys: ProviderKeyStatus[] }>(
          projectId(),
          "/keys"
        );
        set({ projectKeys: keys });
      } catch (error) {
        fail(error);
      }
    }
  };
});
