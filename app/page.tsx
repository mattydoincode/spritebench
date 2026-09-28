import Link from "next/link";
import { auth } from "@/server/auth";

export const dynamic = "force-dynamic";

/**
 * The backdrop: WebP at 2560 wide (about 30 KB; flat pixel art compresses
 * well). The ink colour underneath only shows if it fails to load.
 */
const HERO_IMAGE = "/marketing/hero-2560.webp";

/** The walkthrough's YouTube id (the part after `v=`). Empty hides the link. */
const YOUTUBE_ID = "";

/** The small list beside the intro. Short labels; one line each where possible. */
const FEATURES = [
  "Batch generation with OpenAI or Gemini",
  "Chained prompts",
  "Chunk and process big images",
  "Animations and sprite sheets",
  "Variations and item grids",
  "Prompt snippets and variables",
  "Template builder",
  "Masks for editing part of an image",
  "Background removal",
  "Cropping",
  "Pixel art: downsample, palettes, dithering",
  "Slice sheets into frames",
  "Library with folders, tags and search",
  "Upload artists' finals",
  "Scene for composing art",
  "Repeaters",
  "Isometric support",
  "Terrain testing",
  "Live collaboration and share links",
  "Zip export",
  "Godot plugin sync (experimental)"
];

/**
 * The public front door: one screen, a small personal project rather than a
 * product page.
 *
 * Signed-in visitors are not bounced to the app: a link someone shares should
 * land on the same page for everyone. The button changes instead.
 */
export default async function LandingPage() {
  const session = await auth();
  const signedIn = Boolean(session?.user);

  return (
    <div
      className="page-shell relative flex min-h-screen flex-col overflow-hidden"
      style={{
        backgroundColor: "var(--color-ink-900)",
        backgroundImage: `url(${HERO_IMAGE})`,
        backgroundSize: "cover",
        backgroundPosition: "center"
      }}
    >
      {/* Darker on the left, where the text sits, so the art shows on the right. */}
      <div
        aria-hidden
        className="absolute inset-0 bg-gradient-to-r from-black/75 via-black/45 to-black/10"
      />

      <header className="relative px-6 py-6 sm:px-12">
        <img
          src="/branding/logo-white.png"
          alt="SpriteBench"
          className="h-[20px] w-auto [image-rendering:pixelated]"
        />
      </header>

      <main className="relative flex flex-1 flex-col justify-center gap-12 px-6 pb-16 sm:px-12 lg:flex-row lg:items-center lg:justify-between">
        <div className="max-w-2xl">
          <h1 className="text-5xl leading-[1.05] font-semibold tracking-tight text-white sm:text-6xl">
            Prototype with AI.
            <br />
            Ship with artists.
          </h1>

          <p className="mt-6 text-lg leading-relaxed text-slate-300">
            Hi, I'm Matt, and I like building games (badly).
            I made this app to help game developers prototype game art with AI then loop in artists once they're ready for prime time.
            It has all the nerdy game-dev specific features I've wanted for a while and an experimental Godot plugin for syncing assets to Godot. 
            You bring your own OpenAI or Gemini keys, and the app is free for now. 
          </p>

          <p className="mt-4 text-[15px] leading-relaxed text-slate-400">
            It&apos;s alpha software: free for now, though that may change. Things will break, and
            there&apos;s a feedback box in the app if you find something. I read all of it.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-5">
            <Link
              href={signedIn ? "/projects" : "/sign-in"}
              className="rounded-md bg-[var(--color-accent-dim)] px-5 py-2.5 font-medium text-white hover:brightness-110"
            >
              {signedIn ? "Open SpriteBench" : "Sign in with Google"}
            </Link>

            {YOUTUBE_ID ? (
              <a
                href={`https://www.youtube.com/watch?v=${YOUTUBE_ID}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[15px] text-slate-300 underline-offset-4 hover:text-white hover:underline"
              >
                Watch how it works
              </a>
            ) : null}
          </div>
        </div>

        <aside className="w-full max-w-md shrink-0 rounded-lg border border-white/10 bg-black/45 p-5 backdrop-blur-sm">
          <h2 className="mb-3 text-xs font-medium tracking-wider text-slate-400 uppercase">
            What&apos;s in it
          </h2>
          <ul className="grid gap-x-5 gap-y-1.5 text-[13px] leading-snug text-slate-300 sm:grid-cols-2">
            {FEATURES.map((feature) => (
              <li key={feature} className="flex gap-2">
                <span aria-hidden className="text-[var(--color-accent)]">
                  ·
                </span>
                {feature}
              </li>
            ))}
          </ul>
        </aside>
      </main>

      <footer className="relative flex gap-5 px-6 py-5 text-sm text-slate-500 sm:px-12">
        <Link href="/privacy" className="hover:text-slate-300">
          Privacy
        </Link>
        <Link href="/terms" className="hover:text-slate-300">
          Terms
        </Link>
      </footer>
    </div>
  );
}
