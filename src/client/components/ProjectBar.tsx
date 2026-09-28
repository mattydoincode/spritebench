"use client";

import Link from "next/link";
import { useServer } from "@/client/stores/server";
import { useUi } from "@/client/stores/ui";

/**
 * Which project you are in, a way out, and settings -- a real button, since
 * sharing lives there.
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
        title="Sharing and people, project defaults, and your account and keys"
        onClick={() => useUi.getState().openSettings()}
        className="float-right ml-2 inline-flex h-6 items-center gap-1.5 rounded border border-[var(--color-edge)] bg-[var(--color-ink-600)] px-2 transition hover:border-[var(--color-accent-dim)] hover:bg-[var(--color-ink-500)]"
      >
        <svg aria-hidden viewBox="0 0 16 16" className="h-3.5 w-3.5 text-slate-300">
          <path
            fill="currentColor"
            d="M7.1 1h1.8l.3 1.9c.4.1.8.3 1.2.5l1.6-1.1 1.3 1.3-1.1 1.6c.2.4.4.8.5 1.2L15 6.9v1.8l-1.9.3c-.1.4-.3.8-.5 1.2l1.1 1.6-1.3 1.3-1.6-1.1c-.4.2-.8.4-1.2.5L8.9 15H7.1l-.3-1.9c-.4-.1-.8-.3-1.2-.5l-1.6 1.1-1.3-1.3 1.1-1.6c-.2-.4-.4-.8-.5-1.2L1 8.7V6.9l1.9-.3c.1-.4.3-.8.5-1.2L2.3 3.8l1.3-1.3 1.6 1.1c.4-.2.8-.4 1.2-.5L7.1 1Zm.9 4.6a2.2 2.2 0 1 0 0 4.4 2.2 2.2 0 0 0 0-4.4Z"
          />
        </svg>
        {/* Colour and size on the span: the global button rule beats them on the button. */}
        <span className="text-xs font-medium text-slate-100">Settings</span>
      </button>

      {/* Floated after Settings, so it sits to its left. */}
      <button
        type="button"
        title="How SpriteBench works"
        onClick={() => useUi.getState().openHelp()}
        className="float-right ml-2 inline-flex h-6 items-center gap-1.5 rounded border border-[var(--color-edge)] bg-[var(--color-ink-600)] px-2 transition hover:border-[var(--color-accent-dim)] hover:bg-[var(--color-ink-500)]"
      >
        <svg aria-hidden viewBox="0 0 16 16" className="h-3.5 w-3.5 text-slate-300" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="8" cy="8" r="6.5" />
          <path d="M6.2 6.2a1.9 1.9 0 1 1 2.6 1.8c-.5.2-.8.6-.8 1.1v.4M8 11.6v.1" strokeLinecap="round" />
        </svg>
        <span className="text-xs font-medium text-slate-100">Help</span>
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
