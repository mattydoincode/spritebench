"use client";

import { useEffect, useLayoutEffect } from "react";
import { GeneratePanel } from "@/client/components/GeneratePanel";
import { ImageEditModal } from "@/client/components/ImageEditModal";
import { SettingsModal } from "@/client/components/SettingsModal";
import { SliceModal } from "@/client/components/SliceModal";
import { TemplateBuilderModal } from "@/client/components/TemplateBuilderModal";
import { InspectorPanel } from "@/client/components/InspectorPanel";
import { EnginePanel } from "@/client/components/EnginePanel";
import { LibraryPanel } from "@/client/components/LibraryPanel";
import { ProcessDock } from "@/client/components/ProcessDock";
import { Scene } from "@/client/components/Scene";
import { ProjectBar } from "@/client/components/ProjectBar";
import { ResizeHandle } from "@/client/components/ResizeHandle";
import { anyModalOpen } from "@/client/components/ui";
import { usePrefetchNewAssets } from "@/client/prefetch";
import { useDoc } from "@/client/stores/doc";
import { useProjectLoaded, useServer } from "@/client/stores/server";
import { defaultPaneSize, type Pane, useUi } from "@/client/stores/ui";
import type { StudioBootstrap } from "@/shared/studioBootstrap";

/** Holds the scene's space while the project and its document load. */
function ScenePlaceholder() {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center">
      <span className="animate-pulse text-[11px] tracking-wider text-slate-500 uppercase">
        loading scene
      </span>
    </div>
  );
}

/**
 * The editor for one project.
 *
 * Which project is decided by the URL, not by a remembered id. That is the
 * difference from the single-project version: a link to a project is now a
 * link, so it survives a reload, a bookmark, and being pasted to a
 * collaborator -- who lands on the same scene rather than on whatever
 * they last had open.
 */
export function Studio({ bootstrap }: { bootstrap: StudioBootstrap }) {
  const projectId = bootstrap.project.id;
  const loaded = useProjectLoaded();
  const project = useServer((state) => state.project);
  const jobs = useServer((state) => state.jobs);
  const docReady = useDoc((state) => state.ready);
  const scenes = useDoc((state) => state.scenes);
  const editingAssetId = useUi((state) => state.editingAssetId);
  const slicingAssetId = useUi((state) => state.slicingAssetId);
  const settingsOpen = useUi((state) => state.settingsTab !== null);
  const templateBuilderOpen = useUi((state) => state.templateBuilderOpen);

  const layout = useUi((state) => state.layout);
  const leftTab = useUi((state) => state.leftTab);

  // Before paint: the studio draws its full layout straight away, so the
  // stored pane sizes have to be in place before the first frame, and the
  // last project's rows have to be gone before this one's name is shown.
  useLayoutEffect(() => {
    useUi.getState().hydrate();
  }, []);

  useLayoutEffect(() => {
    useServer.getState().beginProject(bootstrap);
  }, [bootstrap]);

  const resize = (pane: Pane, size: number) => useUi.getState().setPaneSize(pane, size);

  // Membership was settled on the server before this rendered, so the rows
  // can load straight away.
  useEffect(() => {
    // Remembered only so the dashboard can offer to pick this back up.
    useUi.getState().setActiveProject(projectId);
    void useServer.getState().openProject(projectId);

    return () => {
      useUi.getState().closeSettings();
      useUi.getState().closeTemplateBuilder();
      useDoc.getState().close();
    };
  }, [projectId]);

  // A project with no scene has nowhere to drop anything. Waits for the
  // document to load first, or two clients would each create one.
  useEffect(() => {
    if (!project || !docReady || scenes.length > 0) return;

    const id = useDoc.getState().createScene("scene");
    if (id) useUi.getState().setActiveScene(project.id, id);
  }, [project, docReady, scenes.length]);

  usePrefetchNewAssets();

  const hasActiveJobs = jobs.some(
    (job) => job.status === "queued" || job.status === "blocked" || job.status === "running"
  );

  useEffect(() => {
    if (!project) return;

    const interval = setInterval(() => {
      void useServer.getState().refreshJobs();
      void useServer.getState().refreshSlots();
    }, hasActiveJobs ? 750 : 5000);

    return () => clearInterval(interval);
  }, [project, hasActiveJobs]);

  // Undo is document-wide rather than per-panel, so it belongs on the window.
  // The manager only tracks this client's edits, which is what keeps Ctrl+Z
  // from reverting a collaborator's work.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "z") return;

      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
      if (anyModalOpen()) return;

      event.preventDefault();
      if (event.shiftKey) useDoc.getState().redo();
      else useDoc.getState().undo();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <main className="studio-root relative flex h-screen flex-col">
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="flex min-h-0 shrink-0 flex-col overflow-hidden" style={{ width: layout.left }}>
          <ProjectBar />
          <div className="min-h-0 flex-1">
            {leftTab === "godot" ? <EnginePanel /> : <GeneratePanel />}
          </div>
        </div>

        <ResizeHandle
          orientation="vertical"
          onDrag={(delta) => resize("left", layout.left + delta)}
          onReset={() => resize("left", defaultPaneSize("left"))}
        />

        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {loaded && docReady ? <Scene /> : <ScenePlaceholder />}

          <ResizeHandle
            orientation="horizontal"
            onDrag={(delta) => resize("library", layout.library - delta)}
            onReset={() => resize("library", defaultPaneSize("library"))}
          />

          <div
            className="min-h-0 shrink-0 overflow-hidden"
            style={{ height: layout.library, maxHeight: "100%" }}
          >
            <LibraryPanel />
          </div>
        </div>

        <ResizeHandle
          orientation="vertical"
          onDrag={(delta) => resize("right", layout.right - delta)}
          onReset={() => resize("right", defaultPaneSize("right"))}
        />

        <div className="flex min-h-0 shrink-0 flex-col overflow-hidden" style={{ width: layout.right }}>
          <InspectorPanel />
        </div>
      </div>

      <ProcessDock />

      {editingAssetId ? <ImageEditModal /> : null}
      {slicingAssetId ? <SliceModal /> : null}
      {settingsOpen ? <SettingsModal /> : null}
      {templateBuilderOpen ? <TemplateBuilderModal /> : null}
    </main>
  );
}
