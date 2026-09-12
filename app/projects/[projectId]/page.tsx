import { Studio } from "@/client/components/Studio";

export const dynamic = "force-dynamic";

/**
 * Thin server wrapper. The id is only unwrapped here and handed down; every
 * membership check that matters happens in the API routes the studio calls,
 * against the session rather than against anything the URL claims.
 */
export default async function ProjectPage({
  params
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  return <Studio projectId={projectId} />;
}
