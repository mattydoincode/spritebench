import { notFound } from "next/navigation";
import { PageShell } from "@/client/components/AppHeader";
import { adminStats, isAdmin, listFeedback, userUsage } from "@/db/repo/feedback";
import { optionalUser } from "@/server/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin — SpriteBench" };

/** R2 standard storage, per GB-month. */
const R2_PER_GB_MONTH = 0.015;

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

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

  const [stats, entries, usage] = await Promise.all([adminStats(), listFeedback(), userUsage()]);
  const monthly = (stats.storedBytes / 1024 ** 3) * R2_PER_GB_MONTH;

  const tiles = [
    { label: "Users", value: stats.users },
    { label: "Projects", value: stats.projects },
    { label: "Images", value: stats.assets },
    { label: "Jobs", value: stats.jobs },
    { label: "Feedback", value: stats.feedback },
    { label: "Stored", value: formatBytes(stats.storedBytes), hint: `~$${monthly.toFixed(2)}/mo on R2` }
  ];

  return (
    <PageShell active="admin">
      <div className="mx-auto w-full max-w-5xl px-6 py-10">
        <h1 className="text-3xl font-semibold tracking-tight text-white">Admin</h1>

        <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-6">
          {tiles.map((tile) => (
            <div
              key={tile.label}
              className="rounded-lg border border-[var(--color-edge)] bg-[var(--color-ink-800)] px-4 py-3"
            >
              <div className="text-sm text-slate-400">{tile.label}</div>
              <div className="mt-1 text-2xl font-semibold text-white tabular-nums">{tile.value}</div>
              {"hint" in tile && tile.hint ? (
                <div className="mt-0.5 text-xs text-slate-500">{tile.hint}</div>
              ) : null}
            </div>
          ))}
        </div>

        <h2 className="mt-10 text-lg font-medium text-white">Users</h2>
        <div className="mt-3 overflow-x-auto rounded-lg border border-[var(--color-edge)]">
          <table className="w-full text-left text-sm">
            <thead className="bg-[var(--color-ink-800)] text-slate-400">
              <tr>
                <th className="px-3 py-2 font-medium">User</th>
                <th className="px-3 py-2 text-right font-medium">Projects</th>
                <th className="px-3 py-2 text-right font-medium">Jobs</th>
                <th className="px-3 py-2 text-right font-medium">Failed</th>
                <th className="px-3 py-2 text-right font-medium">Images</th>
                <th className="px-3 py-2 text-right font-medium">Stored</th>
                <th className="px-3 py-2 font-medium">Last generation</th>
                <th className="px-3 py-2 font-medium">Joined</th>
              </tr>
            </thead>
            <tbody>
              {usage.map((user) => (
                <tr key={user.id} className="border-t border-[var(--color-edge)] text-slate-300">
                  <td className="px-3 py-2">
                    <div className="text-slate-200">{user.email}</div>
                    {user.name ? <div className="text-xs text-slate-500">{user.name}</div> : null}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{user.projects}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{user.jobs}</td>
                  <td
                    className={`px-3 py-2 text-right tabular-nums ${
                      user.failedJobs > 0 ? "text-rose-300" : "text-slate-500"
                    }`}
                  >
                    {user.failedJobs}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{user.images}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatBytes(user.storedBytes)}</td>
                  <td className="px-3 py-2 text-slate-500">
                    {user.lastJobAt ? formatWhen(user.lastJobAt) : "never"}
                  </td>
                  <td className="px-3 py-2 text-slate-500">{formatWhen(user.joinedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
