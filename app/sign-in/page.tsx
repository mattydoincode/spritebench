import { redirect } from "next/navigation";
import { auth, signIn } from "@/server/auth";

export const dynamic = "force-dynamic";

export default async function SignInPage({
  searchParams
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const session = await auth();

  // `next` only ever comes from our own middleware, but it arrives as a query
  // parameter, so it is treated as untrusted: a relative path only, or the
  // dashboard. An absolute URL here would be an open redirect.
  const destination = next?.startsWith("/") && !next.startsWith("//") ? next : "/projects";

  if (session?.user) redirect(destination);

  return (
    <main className="page-shell flex h-screen items-center justify-center">
      <div className="w-full max-w-sm rounded-lg border border-[var(--color-edge)] bg-[var(--color-ink-800)] p-8">
        <img src="/branding/logo-white.png" alt="SpriteBench" className="h-4 w-auto" />
        <p className="mt-2 text-sm text-slate-400">
          Generate, process and compose game art. Bring your own image model key.
        </p>

        <form
          className="mt-6"
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: destination });
          }}
        >
          <button
            type="submit"
            className="w-full rounded border border-[var(--color-edge)] bg-[var(--color-ink-600)] px-4 py-2 text-sm font-medium text-slate-200 hover:bg-[var(--color-ink-500)]"
          >
            Continue with Google
          </button>
        </form>

        <a
          href="/"
          className="mt-4 block text-center text-[11px] text-slate-500 hover:text-slate-300"
        >
          what is SpriteBench?
        </a>
      </div>
    </main>
  );
}
