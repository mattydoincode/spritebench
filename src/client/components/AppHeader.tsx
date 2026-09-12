import Link from "next/link";
import type { ReactNode } from "react";
import { auth, signOut } from "@/server/auth";

const TABS = [
  { key: "projects", href: "/projects", label: "Projects" },
  { key: "settings", href: "/settings", label: "Settings & Keys" }
] as const;

export type Tab = (typeof TABS)[number]["key"];

/**
 * The bar above everything except the studio.
 *
 * The studio deliberately does not get this: it has its own `ProjectBar`, and
 * a second row of chrome would cost canvas height on the one screen where
 * vertical space is the scarce thing.
 */
async function AppHeader({ active }: { active: Tab }) {
  const session = await auth();

  return (
    <header className="flex shrink-0 items-center gap-4 border-b border-[var(--color-edge)] bg-[var(--color-ink-800)] px-5 py-2.5">
      <Link href="/projects" aria-label="SpriteBench">
        <img src="/branding/logo-white.png" alt="SpriteBench" className="h-3.5 w-auto" />
      </Link>

      <nav className="flex items-center gap-1">
        {TABS.map((tab) => (
          <Link
            key={tab.key}
            href={tab.href}
            className={`rounded px-2.5 py-1.5 text-sm transition ${
              active === tab.key
                ? "bg-[var(--color-ink-600)] text-white"
                : "text-slate-400 hover:bg-[var(--color-ink-700)] hover:text-slate-200"
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      <span className="flex-1" />

      <span className="hidden text-xs text-slate-500 sm:inline">{session?.user?.email}</span>

      <form
        action={async () => {
          "use server";
          await signOut({ redirectTo: "/" });
        }}
      >
        <button
          type="submit"
          className="rounded border border-[var(--color-edge)] px-2.5 py-1.5 text-xs text-slate-400 hover:bg-[var(--color-ink-700)] hover:text-slate-200"
        >
          Sign out
        </button>
      </form>
    </header>
  );
}

/**
 * Header plus a scrolling body at the outer pages' larger base font size.
 *
 * The scroll container is here rather than on the body because the studio
 * needs a body that never scrolls, and these pages are lists that will
 * eventually run past the fold.
 */
export function PageShell({ active, children }: { active: Tab; children: ReactNode }) {
  return (
    <div className="page-shell flex h-full flex-col">
      <AppHeader active={active} />
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}
