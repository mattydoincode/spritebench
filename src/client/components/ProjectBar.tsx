"use client";

import Link from "next/link";
import { useDoc } from "@/client/stores/doc";
import { useServer } from "@/client/stores/server";
import { useUi } from "@/client/stores/ui";
import { Button } from "./ui";

/**
 * Which project you are in, a way out, undo, and settings.
 *
 * Sits over the left pane only, not across the whole window: the scene and
 * the inspector get their full height, and the chrome that is about the
 * project lives in one corner instead of a strip that is mostly empty.
 */
export function ProjectBar() {
  const project = useServer((state) => state.project);
  const canUndo = useDoc((state) => state.canUndo);
  const canRedo = useDoc((state) => state.canRedo);

  if (!project) return null;

  return (
    <header className="flex shrink-0 flex-col gap-1.5 border-b border-[var(--color-edge)] bg-[var(--color-ink-700)] px-3 py-2 text-[11px]">
      <div className="flex items-center gap-1">
        <Link
          href="/projects"
          title="All of your projects"
          aria-label="SpriteBench — all projects"
          className="mr-auto shrink-0"
        >
          <img src="/branding/logo-white.png" alt="SpriteBench" className="h-3.5 w-auto" />
        </Link>

        <Button
          variant="ghost"
          disabled={!canUndo}
          title="Undo your last change (ctrl+z). A collaborator's edits are skipped."
          aria-label="Undo"
          onClick={() => useDoc.getState().undo()}
        >
          {"↶"}
        </Button>
        <Button
          variant="ghost"
          disabled={!canRedo}
          title="Redo (ctrl+shift+z)"
          aria-label="Redo"
          onClick={() => useDoc.getState().redo()}
        >
          {"↷"}
        </Button>

        <Button
          variant="ghost"
          title="Project defaults, plus your account and keys"
          onClick={() => useUi.getState().openSettings()}
        >
          settings
        </Button>
      </div>

      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5">
        <Link
          href="/projects"
          title="Back to all of your projects"
          className="shrink-0 text-slate-500 hover:text-slate-200"
        >
          Projects
        </Link>
        <span className="text-slate-600">/</span>
        <span className="truncate text-[12px] font-medium text-slate-100" title={project.name}>
          {project.name}
        </span>

        {project.role === "viewer" ? (
          <span
            className="ml-auto shrink-0 text-amber-300"
            title="You can look, but changes will not be saved"
          >
            read only
          </span>
        ) : null}
      </nav>
    </header>
  );
}
