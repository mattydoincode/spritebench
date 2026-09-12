import Link from "next/link";
import type { ReactNode } from "react";

/** Shared chrome for the privacy and terms pages. */
export function LegalPage({
  title,
  updated,
  children
}: {
  title: string;
  updated: string;
  children: ReactNode;
}) {
  return (
    <div className="page-shell flex min-h-screen flex-col">
      <header className="flex shrink-0 items-center border-b border-[var(--color-edge)] px-6 py-3">
        <Link href="/" className="text-sm font-semibold tracking-tight text-white">
          SpriteBench
        </Link>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-12">
        <h1 className="text-2xl font-semibold text-white">{title}</h1>
        <p className="mt-1 text-[11px] text-slate-600">Last updated {updated}</p>

        <div className="mt-8 leading-relaxed text-slate-400 [&>h2]:mt-8 [&>h2]:font-semibold [&>h2]:text-slate-200 [&>p]:mt-3 [&_a]:text-[var(--color-accent)] [&_a:hover]:underline">
          {children}
        </div>
      </main>
    </div>
  );
}
