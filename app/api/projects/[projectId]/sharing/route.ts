import { NextResponse } from "next/server";
import { getProject } from "@/db/repo/projects";
import { listMembers, listShareLinks, projectStats } from "@/db/repo/members";
import { projectContext } from "@/server/access";
import { withValidation } from "@/server/validation";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ projectId: string }> };

/**
 * Everything the Project tab shows: name, stats, members, and -- for the owner
 * only -- the live share links. Any member may look; only the owner changes.
 */
export async function GET(_request: Request, { params }: Params) {
  return withValidation(async () => {
    const membership = await projectContext(params, "view");
    const { projectId } = membership;

    const [project, members, stats, links] = await Promise.all([
      getProject(projectId),
      listMembers(projectId),
      projectStats(projectId),
      membership.isOwner ? listShareLinks(projectId) : Promise.resolve([])
    ]);

    return NextResponse.json({
      name: project?.name ?? "",
      isOwner: membership.isOwner,
      you: membership.userId,
      members,
      links,
      stats
    });
  });
}
