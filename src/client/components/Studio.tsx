"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { GeneratePanel } from "@/client/components/GeneratePanel";
import { ImageEditModal } from "@/client/components/ImageEditModal";
import { SliceModal } from "@/client/components/SliceModal";
import { InspectorPanel } from "@/client/components/InspectorPanel";
import { JobsBar } from "@/client/components/JobsBar";
import { LibraryPanel } from "@/client/components/LibraryPanel";
import { Scene } from "@/client/components/Scene";
import { ProjectBar } from "@/client/components/ProjectBar";
import { ResizeHandle } from "@/client/components/ResizeHandle";
import { anyModalOpen } from "@/client/components/ui";
import { useDoc } from "@/client/stores/doc";
import { useServer } from "@/client/stores/server";
import { DEFAULT_LAYOUT, type Pane, useUi } from "@/client/stores/ui";

/**
 * A collapsed pane, reduced to a strip you can click to get it back.
 *
 * Never collapses to nothing: a pane with no handle is a pane you cannot
 * recover without knowing it was ever there, and the point of collapsing is
 * to give the scene the screen for a minute, not to remove a tool.
 */
function PaneRail({
  label,
  side,
  onExpand
}: {
  label: string;
  side: "left" | "right" | "bottom";
  onExpand: () => void;
}) {
  // Same glyph family as the collapse chevron in the panel's own header, just
  // pointing back the way it came.
  const arrow = side === "left" ? "\u00bb" : side === "right" ? "\u00ab" : "\u02c4";

  return (
    <button
      type="button"
      onClick={onExpand}
      title={`Show ${label.toLowerCase()}`}
      className={`flex shrink-0 items-center justify-center gap-2 border-[var(--color-edge)] bg-[var(--color-ink-800)] text-[10px] tracking-wider text-slate-500 uppercase transition hover:bg-[var(--color-ink-700)] hover:text-slate-200 ${
        side === "bottom"
          ? "h-6 w-full border-t"
          : `w-6 flex-col ${side === "left" ? "border-r" : "border-l"}`
      }`}
    >
      <span className="text-[13px] leading-none">{arrow}</span>
      <span className={side === "bottom" ? "" : "[writing-mode:vertical-rl]"}>{label}</span>
    </button>
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
export function Studio({ projectId }: { projectId: string }) {
  const ready = useServer((state) => state.ready);
  const project = useServer((state) => state.project);
  const jobs = useServer((state) => state.jobs);
  const docReady = useDoc((state) => state.ready);
  const scenes = useDoc((state) => state.scenes);
  const editingAssetId = useUi((state) => state.editingAssetId);
  const slicingAssetId = useUi((state) => state.slicingAssetId);

  const layout = useUi((state) => state.layout);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    useUi.getState().hydrate();
  }, []);

  const resize = (pane: Pane, size: number) => useUi.getState().setPaneSize(pane, size);
  const collapse = (pane: Pane) => useUi.getState().togglePane(pane);

  // The project list has to load first: `openProject` reads the membership row
  // out of it to know whether this user may edit, which decides whether the
  // document syncs read-only.
  useEffect(() => {
    void (async () => {
      const projects = await useServer.getState().loadProjects();

      if (!projects.some((entry) => entry.id === projectId)) {
        setMissing(true);
        return;
      }

      // Remembered only so the dashboard can offer to pick this back up.
      useUi.getState().setActiveProject(projectId);
      await useServer.getState().openProject(projectId);
    })();

    return () => useDoc.getState().close();
  }, [projectId]);

  // A project with no scene has nowhere to drop anything. Waits for the
  // document to load first, or two clients would each create one.
  useEffect(() => {
    if (!project || !docReady || scenes.length > 0) return;

    const id = useDoc.getState().createScene("scene");
    if (id) useUi.getState().setActiveScene(project.id, id);
  }, [project, docReady, scenes.length]);

  const hasActiveJobs = jobs.some((job) => job.status === "queued" || job.status === "running");

  useEffect(() => {
    if (!project) return;

    const interval = setInterval(
      () => void useServer.getState().refreshJobs(),
      hasActiveJobs ? 750 : 5000
    );

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

  if (missing) {
    return (
      <main className="flex h-screen flex-col items-center justify-center gap-3 text-sm">
        <p className="text-slate-400">
          That project does not exist, or is not shared with you.
        </p>
        <Link href="/projects" className="text-[var(--color-accent)] hover:underline">
          back to your projects
        </Link>
      </main>
    );
  }

  if (!ready) {
    return (
      <main className="flex h-screen items-center justify-center text-sm text-slate-500">
        loading studio...
      </main>
    );
  }

  return (
    <main className="studio-root flex h-screen flex-col">
      <ProjectBar />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {layout.collapsed.left ? (
          <PaneRail label="Generate" side="left" onExpand={() => collapse("left")} />
        ) : (
          <>
            <div className="flex min-h-0 shrink-0 flex-col overflow-hidden" style={{ width: layout.left }}>
              <GeneratePanel />
            </div>

            <ResizeHandle
              orientation="vertical"
              onDrag={(delta) => resize("left", layout.left + delta)}
              onReset={() => resize("left", DEFAULT_LAYOUT.left)}
            />
          </>
        )}

        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <Scene />

          {layout.collapsed.library ? (
            <PaneRail label="Library" side="bottom" onExpand={() => collapse("library")} />
          ) : (
            <>
              <ResizeHandle
                orientation="horizontal"
                onDrag={(delta) => resize("library", layout.library - delta)}
                onReset={() => resize("library", DEFAULT_LAYOUT.library)}
              />

              <div
                className="min-h-0 shrink-0 overflow-hidden"
                style={{ height: layout.library, maxHeight: "100%" }}
              >
                <LibraryPanel />
              </div>
            </>
          )}
        </div>

        {layout.collapsed.right ? (
          <PaneRail label="Inspector" side="right" onExpand={() => collapse("right")} />
        ) : (
          <>
            <ResizeHandle
              orientation="vertical"
              onDrag={(delta) => resize("right", layout.right - delta)}
              onReset={() => resize("right", DEFAULT_LAYOUT.right)}
            />

            <div className="flex min-h-0 shrink-0 flex-col overflow-hidden" style={{ width: layout.right }}>
              <InspectorPanel />
            </div>
          </>
        )}
      </div>

      <JobsBar />

      {editingAssetId ? <ImageEditModal /> : null}
      {slicingAssetId ? <SliceModal /> : null}
    </main>
  );
}
