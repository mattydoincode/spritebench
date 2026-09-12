import Link from "next/link";
import { auth } from "@/server/auth";

export const dynamic = "force-dynamic";

const FEATURES = [
  {
    title: "Generate in batches",
    body: "Queue a prompt across several images at once, with your own prefix and suffix wrapped around it. Jobs run in the background, so closing the tab does not lose them."
  },
  {
    title: "Process like a pixel artist",
    body: "Downscale, quantise to a palette, dither, cut backgrounds, trim to content, erode and snap alpha. Every step is non-destructive and re-runs from the original."
  },
  {
    title: "Compose on a scene",
    body: "Drop sprites onto an infinite grid, or build a tiling repeater that picks from a set at random. See how art reads together before you commit to it."
  },
  {
    title: "Share a project",
    body: "Invite someone as a viewer or an editor. You both see the same scene, edits merge instead of overwriting, and undo only ever takes back your own."
  },
  {
    title: "Bring your own key",
    body: "Generation bills your provider account, not ours. Keys are encrypted at rest, and a collaborator can generate on a project without ever seeing the key paying for it."
  },
  {
    title: "Export what you see",
    body: "Download an original, a processed PNG, or a zip of both across a selection. Filenames follow the project and the asset number, or whatever you renamed it to."
  }
];

/**
 * The public front door.
 *
 * Signed-in visitors are not bounced to the app: a link someone shares should
 * land on the same page for everyone, and being redirected away from a page
 * you meant to read is worse than one extra click. The call to action changes
 * instead.
 */
export default async function LandingPage() {
  const session = await auth();
  const signedIn = Boolean(session?.user);

  return (
    <div className="page-shell flex min-h-screen flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-[var(--color-edge)] px-6 py-3">
        <img src="/branding/logo-white.png" alt="SpriteBench" className="h-4 w-auto" />

        <span className="flex-1" />

        {signedIn ? (
          <Link
            href="/projects"
            className="rounded bg-[var(--color-accent-dim)] px-3 py-1.5 text-[13px] font-medium text-white hover:brightness-110"
          >
            Open SpriteBench
          </Link>
        ) : (
          <Link
            href="/sign-in"
            className="rounded border border-[var(--color-edge)] px-3 py-1.5 text-[13px] text-slate-300 hover:bg-[var(--color-ink-700)]"
          >
            Sign in
          </Link>
        )}
      </header>

      <main className="flex-1">
        <section className="mx-auto max-w-3xl px-6 py-20 text-center">
          <h1 className="text-4xl font-semibold tracking-tight text-white sm:text-5xl">
            Game art, from prompt to sprite sheet
          </h1>

          <p className="mx-auto mt-5 max-w-2xl text-[15px] leading-relaxed text-slate-400">
            SpriteBench generates art with the image model you already pay for, runs
            it through a pixel-art pipeline you control, and lets you compose the
            results on a shared scene. Non-destructive throughout, so you can
            change your mind about a palette after you have made forty sprites.
          </p>

          <div className="mt-8 flex items-center justify-center gap-3">
            <Link
              href={signedIn ? "/projects" : "/sign-in"}
              className="rounded bg-[var(--color-accent-dim)] px-5 py-2.5 text-sm font-medium text-white hover:brightness-110"
            >
              {signedIn ? "Open SpriteBench" : "Start with Google"}
            </Link>
          </div>

          <p className="mt-4 text-[12px] text-slate-600">
            Free to use. You supply an image model key, and generation bills your
            provider account directly.
          </p>
        </section>

        <section className="mx-auto max-w-5xl px-6 pb-24">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((feature) => (
              <div
                key={feature.title}
                className="rounded-lg border border-[var(--color-edge)] bg-[var(--color-ink-800)] p-5"
              >
                <h2 className="font-semibold text-white">{feature.title}</h2>
                <p className="mt-2 text-sm leading-relaxed text-slate-400">{feature.body}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="shrink-0 border-t border-[var(--color-edge)] px-6 py-5">
        <div className="mx-auto flex max-w-5xl items-center gap-4 text-[11px] text-slate-600">
          <img src="/branding/logo-white.png" alt="SpriteBench" className="h-3 w-auto opacity-60" />
          <span className="flex-1" />
          <Link href="/privacy" className="hover:text-slate-400">
            Privacy
          </Link>
          <Link href="/terms" className="hover:text-slate-400">
            Terms
          </Link>
        </div>
      </footer>
    </div>
  );
}
