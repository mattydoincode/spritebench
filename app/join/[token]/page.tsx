import Link from "next/link";
import { redirect } from "next/navigation";
import { acceptShareLink, InviteError } from "@/db/repo/members";
import { optionalUser } from "@/server/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Join a project — SpriteBench" };

/**
 * Where a share link lands. Signed out, the middleware has already sent the
 * visitor through sign-in and back here; signed in, joining is immediate and
 * they go straight into the project.
 */
export default async function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const userId = await optionalUser();
  if (!userId) redirect(`/sign-in?next=${encodeURIComponent(`/join/${token}`)}`);

  let projectId: string;
  try {
    projectId = await acceptShareLink(token, userId);
  } catch (error) {
    if (!(error instanceof InviteError)) throw error;

    return (
      <main className="page-shell flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-slate-300">{error.message}</p>
        <Link href="/projects" className="text-[var(--color-accent)] hover:underline">
          Go to your projects
        </Link>
      </main>
    );
  }

  redirect(`/projects/${projectId}`);
}
