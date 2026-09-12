import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { projectMembers, projects } from "@/db/schema";
import { permits, type Capability, type Membership } from "./capabilities";
import { ForbiddenError } from "./errors";
import { requireUser } from "./session";

export type { Capability, Membership } from "./capabilities";

/**
 * Resolves and authorizes a membership, or throws.
 *
 * Every repository function takes a `projectId` that came from here. The
 * check lives at this seam rather than in each of the twenty-odd handlers
 * because a handler that forgets is not a bug in one endpoint, it is a
 * cross-tenant read.
 */
export async function requireMember(
  userId: string,
  projectId: string,
  capability: Capability = "view"
): Promise<Membership> {
  const [row] = await db()
    .select({
      role: projectMembers.role,
      canGenerate: projectMembers.canGenerate,
      ownerUserId: projects.ownerUserId
    })
    .from(projectMembers)
    .innerJoin(projects, eq(projects.id, projectMembers.projectId))
    .where(
      and(
        eq(projectMembers.projectId, projectId),
        eq(projectMembers.userId, userId),
        isNull(projects.deletedAt)
      )
    )
    .limit(1);

  // A project you cannot see and a project that does not exist are the same
  //404 as far as the caller is concerned, so membership answers both.
  if (!row) throw new ForbiddenError("that project does not exist, or is not shared with you");

  const membership: Membership = {
    projectId,
    userId,
    role: row.role,
    canGenerate: row.canGenerate,
    isOwner: row.ownerUserId === userId
  };

  if (!permits(membership, capability)) {
    throw new ForbiddenError(
      capability === "generate"
        ? "you do not have permission to generate in this project"
        : "you do not have permission to change this project"
    );
  }

  return membership;
}

/**
 * Resolves the session and the project for a `/api/projects/[projectId]/...`
 * handler in one step.
 *
 * Every such handler starts with this call, which is the point: authorization
 * is not something a route opts into, it is how a route obtains the id it
 * needs to query anything.
 */
export async function projectContext(
  params: Promise<{ projectId: string }>,
  capability: Capability = "view"
): Promise<Membership> {
  const userId = await requireUser();
  const { projectId } = await params;

  return requireMember(userId, projectId, capability);
}
