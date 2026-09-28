import { Silkscreen } from "next/font/google";
import Link from "next/link";
import { auth } from "@/server/auth";

export const dynamic = "force-dynamic";

/** The logo's pixel font, for the small labels that echo it. */
const pixel = Silkscreen({ weight: "400", subsets: ["latin"] });

/**
 * The hero's backdrop: WebP at 2560 wide (about 30 KB; flat pixel art
 * compresses well). The gradient and grid underneath only show if it fails.
 */
const HERO_IMAGE = "/marketing/hero-2560.webp";

/** The walkthrough's YouTube id (the part after `v=`). Empty hides the section. */
const YOUTUBE_ID = "";

const STEPS = [
  {
    title: "Prototype with AI",
    body: "Write a prompt, get a batch. Characters, items, tiles, animation strips and variations, from the OpenAI or Gemini model you choose. Jobs run in the background, so you can keep working."
  },
  {
    title: "Make it game-ready",
    body: "Crop, cut out the background, shrink to real pixel art, snap to a palette. Every step is non-destructive, so you can change your mind about a palette after you've made forty sprites."
  },
  {
    title: "Ship with artists",
    body: "Invite your artist to the project. They see every draft, upload their finished pieces into the same library, and each game asset keeps its AI prototype and its final side by side."
  }
];

function CallToAction({ signedIn, large = false }: { signedIn: boolean; large?: boolean }) {
  return (
    <Link
      href={signedIn ? "/projects" : "/sign-in"}
      className={`inline-block rounded-md bg-[var(--color-accent-dim)] font-medium text-white shadow-lg shadow-black/40 hover:brightness-110 ${
        large ? "px-7 py-3.5 text-lg" : "px-5 py-2.5 text-base"
      }`}
    >
      {signedIn ? "Open SpriteBench" : "Start free with Google"}
    </Link>
  );
}

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
    <div className="page-shell flex min-h-screen flex-col text-[17px]">
      <header className="absolute inset-x-0 top-0 z-10 flex items-center gap-3 px-6 py-5 sm:px-10">
        <img
          src="/branding/logo-white.png"
          alt="SpriteBench"
          className="h-[20px] w-auto [image-rendering:pixelated]"
        />

        <span className="flex-1" />

        {signedIn ? (
          <Link
            href="/projects"
            className="rounded-md bg-[var(--color-accent-dim)] px-4 py-2 text-sm font-medium text-white hover:brightness-110"
          >
            Open SpriteBench
          </Link>
        ) : (
          <Link
            href="/sign-in"
            className="rounded-md border border-white/20 bg-black/30 px-4 py-2 text-sm text-slate-200 backdrop-blur hover:bg-black/50"
          >
            Sign in
          </Link>
        )}
      </header>

      <main className="flex-1">
        {/* Hero: the image (once it exists) over a gradient and pixel grid, then a scrim for legibility. */}
        <section
          className="relative flex min-h-[88vh] items-center justify-center overflow-hidden px-6 pt-24 pb-20 text-center"
          style={{
            backgroundColor: "var(--color-ink-900)",
            backgroundImage: [
              `url(${HERO_IMAGE})`,
              "radial-gradient(ellipse at 50% 35%, rgba(110,231,183,0.10), transparent 60%)",
              "linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px)",
              "linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px)"
            ].join(", "),
            backgroundSize: "cover, cover, 32px 32px, 32px 32px",
            backgroundPosition: "center"
          }}
        >
          <div
            aria-hidden
            className="absolute inset-0 bg-gradient-to-b from-black/40 via-black/30 to-[var(--color-ink-900)]"
          />

          <div className="relative mx-auto max-w-4xl">
            <p className={`${pixel.className} mb-6 text-sm tracking-widest text-[var(--color-accent)] uppercase`}>
              AI game art, finished by people
            </p>

            <h1 className="text-5xl leading-[1.05] font-semibold tracking-tight text-white sm:text-7xl">
              Prototype with AI.
              <br />
              Ship with artists.
            </h1>

            <p className="mx-auto mt-7 max-w-2xl text-lg leading-relaxed text-slate-300 sm:text-xl">
              SpriteBench turns prompts into game-ready sprites with the image model you already
              use, then gives your artist one place to take the good ones the rest of the way.
            </p>

            <div className="mt-10 flex flex-col items-center gap-4">
              <CallToAction signedIn={signedIn} large />
              <p className="text-sm text-slate-400">
                Free to use. Bring your own OpenAI or Gemini key; you pay the provider directly.
              </p>
            </div>
          </div>
        </section>

        {YOUTUBE_ID ? (
          <section className="mx-auto max-w-5xl px-6 pb-24">
            <div className="aspect-video overflow-hidden rounded-xl border border-[var(--color-edge)] shadow-2xl shadow-black/60">
              {/* youtube-nocookie: nothing loads or tracks until someone presses play. */}
              <iframe
                src={`https://www.youtube-nocookie.com/embed/${YOUTUBE_ID}?rel=0`}
                title="SpriteBench walkthrough"
                allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                loading="lazy"
                className="h-full w-full"
              />
            </div>
          </section>
        ) : null}

        <section className="mx-auto max-w-6xl px-6 pb-28">
          <ol className="grid gap-10 md:grid-cols-3 md:gap-8">
            {STEPS.map((step, index) => (
              <li key={step.title} className="border-t border-[var(--color-edge)] pt-6">
                <span className={`${pixel.className} text-2xl text-[var(--color-accent)]`}>
                  {String(index + 1).padStart(2, "0")}
                </span>
                <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white">{step.title}</h2>
                <p className="mt-3 text-[17px] leading-relaxed text-slate-400">{step.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="border-y border-[var(--color-edge)] bg-[var(--color-ink-800)]">
          <div className="mx-auto grid max-w-6xl gap-8 px-6 py-16 md:grid-cols-[1fr_1.4fr] md:items-center">
            <h2 className="text-3xl font-semibold tracking-tight text-white">
              Your key, your bill, your art.
            </h2>
            <p className="text-[17px] leading-relaxed text-slate-400">
              Generation runs on your own OpenAI or Google Gemini account, so there is no markup and
              no credits to buy. Keys are encrypted at rest, and a collaborator can generate in your
              project without ever seeing the key that pays for it. What you make is yours to
              download, as originals or processed PNGs.
            </p>
          </div>
        </section>

        <section className="px-6 py-24 text-center">
          <h2 className="text-4xl font-semibold tracking-tight text-white">
            Start with a prompt.
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-lg text-slate-400">
            Sign in with Google, add a key, and have your first batch in a minute.
          </p>
          <div className="mt-8">
            <CallToAction signedIn={signedIn} large />
          </div>
        </section>
      </main>

      <footer className="shrink-0 border-t border-[var(--color-edge)] px-6 py-6">
        <div className="mx-auto flex max-w-6xl items-center gap-5 text-sm text-slate-500">
          <img
            src="/branding/logo-white.png"
            alt="SpriteBench"
            className="h-[10px] w-auto opacity-60 [image-rendering:pixelated]"
          />
          <span className="flex-1" />
          <Link href="/privacy" className="hover:text-slate-300">
            Privacy
          </Link>
          <Link href="/terms" className="hover:text-slate-300">
            Terms
          </Link>
        </div>
      </footer>
    </div>
  );
}
