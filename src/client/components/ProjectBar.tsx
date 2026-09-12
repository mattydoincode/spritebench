"use client";

import Link from "next/link";
import { useDoc } from "@/client/stores/doc";
import { useServer } from "@/client/stores/server";
import { useUi } from "@/client/stores/ui";
import { Button } from "./ui";

/**
 * Which project you are in, plus undo.
 *
 * Deliberately not a switcher for anything. The project is in the URL and you
 * change it from the dashboard; scenes moved into a bubble on the canvas,
 * next to the thing they describe. What is left is a title and a way out.
 */
export function ProjectBar() {
  const project = useServer((state) => state.project);
  const canUndo = useDoc((state) => state.canUndo);
  const canRedo = useDoc((state) => state.canRedo);

  if (!project) return null;

  return (
    <header className="flex shrink-0 items-center gap-2 border-b border-[var(--color-edge)] bg-[var(--color-ink-700)] px-5 py-1.5 text-[11px]">
      <Link
        href="/projects"
        title="All of your projects"
        aria-label="SpriteBench — all projects"
        className="shrink-0"
      >
        <img src="/branding/logo-white.png" alt="SpriteBench" className="h-3.5 w-auto" />
      </Link>

      <span className="max-w-[18rem] truncate text-[12px] font-medium text-slate-100">
        {project.name}
      </span>

      <Link
        href="/projects"
        className="rounded px-1 py-0.5 text-slate-500 underline decoration-dotted underline-offset-2 hover:bg-[var(--color-ink-600)] hover:text-slate-100"
      >
        back to project list
      </Link>

      <span className="flex-1" />

      {project.role === "viewer" ? (
        <span className="text-amber-300" title="You can look, but changes will not be saved">
          read only
        </span>
      ) : null}

      <Button
        variant="ghost"
        disabled={!canUndo}
        title="Undo your last change (ctrl+z). A collaborator's edits are skipped."
        onClick={() => useDoc.getState().undo()}
      >
        undo
      </Button>
      <Button
        variant="ghost"
        disabled={!canRedo}
        title="Redo (ctrl+shift+z)"
        onClick={() => useDoc.getState().redo()}
      >
        redo
      </Button>

      <Link
        href="/settings"
        title="Your keys and prompt defaults"
        className="rounded px-1.5 py-1 text-slate-400 hover:bg-[var(--color-ink-600)] hover:text-slate-200"
      >
        settings
      </Link>
    </header>
  );
}
