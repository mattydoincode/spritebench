"use client";

import Link from "next/link";
import { useServer } from "@/client/stores/server";
import { useUi } from "@/client/stores/ui";

/**
 * Which project you are in, a way out, and settings.
 *
 * Sits over the left pane only, not across the whole window: the scene and
 * the inspector get their full height. Undo and redo are keyboard only.
 *
 * Settings floats right so the breadcrumb shares the logo's line when the
 * pane is wide enough, and wraps under it at full width when it is not.
 */
export function ProjectBar() {
  const project = useServer((state) => state.project);

  if (!project) return null;

  return (
    <header className="flow-root shrink-0 border-b border-[var(--color-edge)] bg-[var(--color-ink-700)] px-3 py-1.5 text-[11px] leading-6">
      {/* Same h-6 box as the logo and breadcrumb, so all three centre on one line. */}
      <button
        type="button"
        title="Project defaults, plus your account and keys"
        onClick={() => useUi.getState().openSettings()}
        className="float-right ml-2 inline-flex h-6 items-center rounded px-2 text-xs text-slate-300 transition hover:bg-[var(--color-ink-600)] hover:text-white"
      >
        settings
      </button>

      <Link
        href="/projects"
        title="All of your projects"
        aria-label="SpriteBench — all projects"
        className="mr-3 inline-flex h-6 items-center align-top"
      >
        <img src="/branding/logo-white.png" alt="SpriteBench" className="h-[15px] w-auto [image-rendering:pixelated]" />
      </Link>

      <nav
        aria-label="Breadcrumb"
        className="inline-flex h-6 max-w-full items-center gap-1.5 align-top"
      >
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
            className="ml-1 shrink-0 text-amber-300"
            title="You can look, but changes will not be saved"
          >
            read only
          </span>
        ) : null}
      </nav>
    </header>
  );
}
