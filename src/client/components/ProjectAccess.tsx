"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/client/api";
import { useServer } from "@/client/stores/server";
import { ConfirmTextButton } from "./ui";

type Access = "viewer" | "editor" | "generate";

const ACCESS_LABELS: Record<Access, string> = {
  viewer: "Can view",
  editor: "Can edit",
  generate: "Can edit and generate"
};

const ACCESS_HINTS: Record<Access, string> = {
  viewer: "See the project, change nothing",
  editor: "Arrange scenes, process and upload art",
  generate: "Also generate images, billed to the owner's key"
};

interface Member {
  userId: string;
  email: string;
  name: string | null;
  image: string | null;
  role: "owner" | "editor" | "viewer";
  canGenerate: boolean;
  isOwner: boolean;
}

interface ShareLink {
  id: string;
  token: string;
  role: "editor" | "viewer";
  canGenerate: boolean;
  expiresAt: string;
}

interface Sharing {
  name: string;
  isOwner: boolean;
  you: string;
  members: Member[];
  links: ShareLink[];
  stats: { images: number; jobs: number; storedBytes: number; createdAt: string };
}

function accessOf(entry: { role: string; canGenerate: boolean }): Access {
  if (entry.role === "viewer") return "viewer";
  return entry.canGenerate ? "generate" : "editor";
}

function accessBody(access: Access): { role: "editor" | "viewer"; canGenerate: boolean } {
  return access === "viewer"
    ? { role: "viewer", canGenerate: false }
    : { role: "editor", canGenerate: access === "generate" };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function daysLeft(iso: string): string {
  const days = Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
  return days <= 1 ? "expires today" : `expires in ${days} days`;
}

function linkUrl(token: string): string {
  return `${window.location.origin}/join/${token}`;
}

function AccessSelect({
  value,
  onChange
}: {
  value: Access;
  onChange: (access: Access) => void;
}) {
  return (
    <select
      value={value}
      title={ACCESS_HINTS[value]}
      style={{ width: "auto" }}
      onChange={(event) => onChange(event.target.value as Access)}
    >
      {(Object.keys(ACCESS_LABELS) as Access[]).map((access) => (
        <option key={access} value={access}>
          {ACCESS_LABELS[access]}
        </option>
      ))}
    </select>
  );
}

function CopyLink({ token }: { token: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(linkUrl(token)).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="shrink-0 rounded-md bg-[var(--color-accent-dim)] px-3 py-1.5 text-sm font-medium text-white hover:brightness-110"
    >
      {copied ? "Copied" : "Copy link"}
    </button>
  );
}

/**
 * Who has this project and how to bring more people in -- the "Share" view.
 *
 * Self-contained (fetches by project id) so it works both as the Project tab
 * in the studio's settings and on its own from the dashboard's menu, where no
 * project is open.
 */
export function ProjectAccess({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [data, setData] = useState<Sharing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [newAccess, setNewAccess] = useState<Access>("editor");

  const load = useCallback(async () => {
    try {
      const next = await api<Sharing>(`/api/projects/${projectId}/sharing`);
      setData(next);
      setName(next.name);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (request: Promise<unknown>) => {
    try {
      await request;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
    await load();
  };

  if (!data) {
    return <p className="text-slate-500">{error ?? "Loading..."}</p>;
  }

  const rename = () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === data.name) {
      setName(data.name);
      return;
    }
    void useServer.getState().renameProject(projectId, trimmed).then(load);
  };

  const { stats } = data;

  return (
    <div className="flex flex-col gap-6">
      <section>
        {data.isOwner ? (
          <input
            type="text"
            value={name}
            aria-label="Project name"
            className="text-lg font-medium text-white"
            onChange={(event) => setName(event.target.value)}
            onBlur={rename}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
              if (event.key === "Escape") setName(data.name);
            }}
          />
        ) : (
          <h2 className="text-lg font-medium text-white">{data.name}</h2>
        )}
        <p className="mt-2 text-sm text-slate-500">
          {stats.images} {stats.images === 1 ? "image" : "images"} · {stats.jobs}{" "}
          {stats.jobs === 1 ? "generation" : "generations"} · {formatBytes(stats.storedBytes)} ·{" "}
          {data.members.length} {data.members.length === 1 ? "person" : "people"} · created{" "}
          {new Date(stats.createdAt).toLocaleDateString()}
        </p>
      </section>

      {error ? (
        <p className="rounded-md border border-rose-900 bg-rose-950/40 px-3 py-2 text-sm text-rose-300">
          {error}
        </p>
      ) : null}

      <section>
        <h3 className="mb-2 font-medium text-white">People with access</h3>
        <ul className="flex flex-col divide-y divide-[var(--color-edge)] rounded-lg border border-[var(--color-edge)]">
          {data.members.map((member) => (
            <li key={member.userId} className="flex items-center gap-3 px-3 py-2.5">
              {member.image ? (
                <img src={member.image} alt="" className="h-8 w-8 shrink-0 rounded-full" />
              ) : (
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--color-ink-600)] text-sm text-slate-300">
                  {(member.name ?? member.email).slice(0, 1).toUpperCase()}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-slate-200">
                  {member.name ?? member.email}
                  {member.userId === data.you ? <span className="text-slate-500"> (you)</span> : null}
                </div>
                {member.name ? <div className="truncate text-xs text-slate-500">{member.email}</div> : null}
              </div>

              {member.isOwner ? (
                <span className="text-sm text-slate-500">Owner</span>
              ) : data.isOwner ? (
                <>
                  <AccessSelect
                    value={accessOf(member)}
                    onChange={(access) =>
                      void run(
                        api(`/api/projects/${projectId}/members/${member.userId}`, {
                          method: "PATCH",
                          body: JSON.stringify(accessBody(access))
                        })
                      )
                    }
                  />
                  <ConfirmTextButton
                    confirmLabel="remove?"
                    title="Remove from this project"
                    onConfirm={() =>
                      void run(api(`/api/projects/${projectId}/members/${member.userId}`, { method: "DELETE" }))
                    }
                  >
                    &times;
                  </ConfirmTextButton>
                </>
              ) : (
                <span className="text-sm text-slate-500">{ACCESS_LABELS[accessOf(member)]}</span>
              )}
            </li>
          ))}
        </ul>

        {!data.isOwner ? (
          <div className="mt-2">
            <ConfirmTextButton
              confirmLabel="leave?"
              title="Leave this project. You will need a new link to come back."
              onConfirm={() =>
                void api(`/api/projects/${projectId}/members/${data.you}`, { method: "DELETE" }).then(() =>
                  router.push("/projects")
                )
              }
            >
              leave project
            </ConfirmTextButton>
          </div>
        ) : null}
      </section>

      {data.isOwner ? (
        <section>
          <h3 className="mb-1 font-medium text-white">Share by link</h3>
          <p className="mb-3 text-sm text-slate-500">
            Anyone with the link can join after signing in. Links last a week.
          </p>

          <div className="mb-3 flex items-center gap-2">
            <AccessSelect value={newAccess} onChange={setNewAccess} />
            <button
              type="button"
              onClick={() =>
                void run(
                  api(`/api/projects/${projectId}/share-links`, {
                    method: "POST",
                    body: JSON.stringify(accessBody(newAccess))
                  })
                )
              }
              className="rounded-md border border-[var(--color-edge)] px-3 py-1.5 text-sm text-slate-200 hover:bg-[var(--color-ink-700)]"
            >
              Create link
            </button>
          </div>

          {data.links.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {data.links.map((link) => (
                <li
                  key={link.id}
                  className="flex items-center gap-3 rounded-lg border border-[var(--color-edge)] bg-[var(--color-ink-800)] px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-mono text-xs text-slate-300">{linkUrl(link.token)}</div>
                    <div className="text-xs text-slate-500">
                      {ACCESS_LABELS[accessOf(link)]} · {daysLeft(link.expiresAt)}
                    </div>
                  </div>
                  <CopyLink token={link.token} />
                  <ConfirmTextButton
                    confirmLabel="revoke?"
                    title="Turn this link off. People who already joined stay."
                    onConfirm={() =>
                      void run(api(`/api/projects/${projectId}/share-links/${link.id}`, { method: "DELETE" }))
                    }
                  >
                    &times;
                  </ConfirmTextButton>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
