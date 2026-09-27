import { notFound } from "next/navigation";
import { PageShell } from "@/client/components/AppHeader";
import { adminStats, isAdmin, listFeedback } from "@/db/repo/feedback";
import { optionalUser } from "@/server/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin — SpriteBench" };

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC"
  });
}

/**
 * Usage numbers and everything sent from the feedback panel.
 *
 * Anyone who is not an admin -- signed out included -- gets the same 404 as
 * a page that does not exist, so the page does not advertise itself.
 */
export default async function AdminPage() {
  const userId = await optionalUser();
  if (!userId || !(await isAdmin(userId))) notFound();

  const [stats, entries] = await Promise.all([adminStats(), listFeedback()]);

  const tiles = [
    { label: "Users", value: stats.users },
    { label: "Projects", value: stats.projects },
    { label: "Images", value: stats.assets },
    { label: "Jobs", value: stats.jobs },
    { label: "Feedback", value: stats.feedback }
  ];

  return (
    <PageShell active="admin">
      <div className="mx-auto w-full max-w-5xl px-6 py-10">
        <h1 className="text-3xl font-semibold tracking-tight text-white">Admin</h1>

        <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-5">
          {tiles.map((tile) => (
            <div
              key={tile.label}
              className="rounded-lg border border-[var(--color-edge)] bg-[var(--color-ink-800)] px-4 py-3"
            >
              <div className="text-sm text-slate-400">{tile.label}</div>
              <div className="mt-1 text-2xl font-semibold text-white tabular-nums">{tile.value}</div>
            </div>
          ))}
        </div>

        <h2 className="mt-10 text-lg font-medium text-white">Feedback</h2>
        {entries.length === 0 ? (
          <p className="mt-3 text-slate-500">Nothing yet.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {entries.map((entry) => (
              <li
                key={entry.id}
                className="rounded-lg border border-[var(--color-edge)] bg-[var(--color-ink-800)] px-4 py-3"
              >
                <div className="mb-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm text-slate-500">
                  <time dateTime={entry.createdAt}>{formatWhen(entry.createdAt)} UTC</time>
                  <span className="text-slate-300">
                    {entry.userName ? `${entry.userName} · ` : ""}
                    {entry.userEmail ?? "deleted user"}
                  </span>
                  {entry.projectName ? <span>in {entry.projectName}</span> : null}
                </div>
                <p className="whitespace-pre-wrap text-slate-200">{entry.body}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </PageShell>
  );
}
