"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useServer } from "@/client/stores/server";
import { useUi } from "@/client/stores/ui";
import type { ProjectSummary } from "@/shared/model";
import { Modal } from "./ui";

function roleLabel(project: ProjectSummary): string {
  if (project.isOwner) return "Owner";
  return project.role === "viewer" ? "View only" : "Editor";
}

function NameModal({
  title,
  action,
  initial,
  onSubmit,
  onClose
}: {
  title: string;
  action: string;
  initial: string;
  onSubmit: (name: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial);
  const trimmed = name.trim();

  const submit = () => {
    if (!trimmed) return;
    onSubmit(trimmed);
    onClose();
  };

  return (
    <Modal title={title} variant="plain" width={440} onClose={onClose}>
      <label className="block">
        <span className="mb-1.5 block text-sm text-slate-300">Name</span>
        <input
          autoFocus
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") submit();
          }}
        />
      </label>

      <div className="mt-6 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-[var(--color-edge)] px-4 py-2 text-sm text-slate-300 hover:bg-[var(--color-ink-700)]"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={!trimmed}
          onClick={submit}
          className="rounded-md bg-[var(--color-accent-dim)] px-4 py-2 text-sm font-medium text-white hover:brightness-110 disabled:opacity-40"
        >
          {action}
        </button>
      </div>
    </Modal>
  );
}

function DeleteModal({
  project,
  onClose
}: {
  project: ProjectSummary;
  onClose: () => void;
}) {
  return (
    <Modal title="Delete project" variant="plain" width={440} onClose={onClose}>
      <p className="text-slate-300">
        Delete <span className="font-medium text-white">{project.name}</span>? Its art,
        scenes, palettes and templates go with it.
      </p>

      <div className="mt-6 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-[var(--color-edge)] px-4 py-2 text-sm text-slate-300 hover:bg-[var(--color-ink-700)]"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => {
            void useServer.getState().deleteProject(project.id);
            onClose();
          }}
          className="rounded-md bg-rose-800 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700"
        >
          Delete
        </button>
      </div>
    </Modal>
  );
}

/**
 * The card is one big click target. The overflow menu sits inside it and has
 * to stop its own events, or renaming a project would also open it.
 */
function ProjectCard({
  project,
  onOpen,
  onRename,
  onDelete
}: {
  project: ProjectSummary;
  onOpen: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };

    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [menuOpen]);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
      className="group relative cursor-pointer rounded-lg border border-[var(--color-edge)] bg-[var(--color-ink-800)] p-5 text-left transition hover:border-[var(--color-accent-dim)] hover:bg-[var(--color-ink-700)] focus:outline-none focus-visible:border-[var(--color-accent)]"
    >
      <div className="flex items-start gap-2">
        <h2 className="min-w-0 flex-1 truncate font-medium text-white">{project.name}</h2>

        {project.isOwner ? (
          <div ref={menuRef} className="relative -mt-1 -mr-1 shrink-0">
            <button
              type="button"
              aria-label={`Actions for ${project.name}`}
              onClick={(event) => {
                event.stopPropagation();
                setMenuOpen(!menuOpen);
              }}
              className={`rounded px-2 py-1 leading-none text-slate-400 transition hover:bg-[var(--color-ink-600)] hover:text-white ${
                menuOpen ? "bg-[var(--color-ink-600)] text-white" : ""
              }`}
            >
              &#8943;
            </button>

            {menuOpen ? (
              <div className="absolute right-0 top-full z-10 mt-1 w-36 overflow-hidden rounded-md border border-[var(--color-edge)] bg-[var(--color-ink-700)] py-1 shadow-xl">
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    setMenuOpen(false);
                    onRename();
                  }}
                  className="block w-full px-3 py-2 text-left text-sm text-slate-200 hover:bg-[var(--color-ink-600)]"
                >
                  Rename
                </button>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    setMenuOpen(false);
                    onDelete();
                  }}
                  className="block w-full px-3 py-2 text-left text-sm text-rose-300 hover:bg-[var(--color-ink-600)]"
                >
                  Delete
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <p className="mt-2 text-sm text-slate-500">
        {roleLabel(project)} &middot; {new Date(project.createdAt).toLocaleDateString()}
      </p>
    </div>
  );
}

export function ProjectsDashboard() {
  const router = useRouter();
  const projects = useServer((state) => state.projects);
  const error = useUi((state) => state.error);

  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<ProjectSummary | null>(null);
  const [deleting, setDeleting] = useState<ProjectSummary | null>(null);

  useEffect(() => {
    useUi.getState().hydrate();
    useUi.getState().clearMessages();

    void (async () => {
      await useServer.getState().loadProjects();
      setLoading(false);
    })();
  }, []);

  const open = (projectId: string) => {
    useUi.getState().setActiveProject(projectId);
    router.push(`/projects/${projectId}`);
  };

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-10">
      <div className="mb-8 flex items-center justify-between gap-4">
        <h1 className="text-3xl font-semibold tracking-tight text-white">Your projects</h1>

        <button
          type="button"
          onClick={() => setCreating(true)}
          className="rounded-md bg-[var(--color-accent-dim)] px-4 py-2 text-sm font-medium text-white hover:brightness-110"
        >
          New project
        </button>
      </div>

      {error ? (
        <p className="mb-6 rounded-md border border-rose-900 bg-rose-950/40 px-4 py-3 text-sm text-rose-300">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="text-slate-500">Loading...</p>
      ) : projects.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-5 rounded-lg border-2 border-dashed border-[var(--color-ink-500)] px-6 py-14 text-center">
          <p className="text-slate-400">Nothing here yet.</p>
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="rounded-md bg-[var(--color-accent-dim)] px-6 py-3 font-medium text-white hover:brightness-110"
          >
            New project
          </button>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              onOpen={() => open(project.id)}
              onRename={() => setRenaming(project)}
              onDelete={() => setDeleting(project)}
            />
          ))}
        </div>
      )}

      {creating ? (
        <NameModal
          title="New project"
          action="Create"
          initial=""
          onClose={() => setCreating(false)}
          onSubmit={(name) => {
            void (async () => {
              const id = await useServer.getState().createProject(name);
              if (id) open(id);
            })();
          }}
        />
      ) : null}

      {renaming ? (
        <NameModal
          title="Rename project"
          action="Rename"
          initial={renaming.name}
          onClose={() => setRenaming(null)}
          onSubmit={(name) => useServer.getState().renameProject(renaming.id, name)}
        />
      ) : null}

      {deleting ? (
        <DeleteModal project={deleting} onClose={() => setDeleting(null)} />
      ) : null}
    </div>
  );
}
