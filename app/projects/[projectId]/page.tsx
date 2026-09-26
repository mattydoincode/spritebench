import { notFound } from "next/navigation";
import { Studio } from "@/client/components/Studio";
import { loadStudioBootstrap } from "@/server/studioBootstrap";

export const dynamic = "force-dynamic";

/**
 * Resolves the project on the server, so the studio's first paint already
 * has its name, your role and its keys. Only the rows load from the client.
 *
 * Membership is checked here against the session, and again by every API
 * route the studio calls; this check decides what to render, those decide
 * what data leaves.
 */
export default async function ProjectPage({
  params
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const bootstrap = await loadStudioBootstrap(projectId);

  if (!bootstrap) notFound();

  return <Studio bootstrap={bootstrap} />;
}
