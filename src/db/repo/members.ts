import crypto from "node:crypto";
import { and, asc, count, eq, gt, isNotNull, isNull, sum } from "drizzle-orm";
import { db } from "../index";
import { assets, jobs, projectInvites, projectMembers, projects, users, type ProjectRole } from "../schema";

/** Share links last a week unless revoked sooner. */
export const SHARE_LINK_DAYS = 7;

/** What a link or a member may do. Owners are never granted through either. */
export type MemberRole = Exclude<ProjectRole, "owner">;

export interface ProjectMember {
  userId: string;
  email: string;
  name: string | null;
  image: string | null;
  role: ProjectRole;
  canGenerate: boolean;
  isOwner: boolean;
  joinedAt: string;
}

export interface ShareLink {
  id: string;
  token: string;
  role: MemberRole;
  canGenerate: boolean;
  expiresAt: string;
  createdAt: string;
}

export interface ProjectStats {
  images: number;
  jobs: number;
  storedBytes: number;
  createdAt: string;
}

export class InviteError extends Error {
  constructor(
    public reason: "invalid" | "expired",
    message: string
  ) {
    super(message);
    this.name = "InviteError";
  }
}

/** Owner first, then everyone else in the order they joined. */
export async function listMembers(projectId: string): Promise<ProjectMember[]> {
  const rows = await db()
    .select({
      userId: users.id,
      email: users.email,
      name: users.name,
      image: users.image,
      role: projectMembers.role,
      canGenerate: projectMembers.canGenerate,
      ownerUserId: projects.ownerUserId,
      joinedAt: projectMembers.createdAt
    })
    .from(projectMembers)
    .innerJoin(users, eq(users.id, projectMembers.userId))
    .innerJoin(projects, eq(projects.id, projectMembers.projectId))
    .where(and(eq(projectMembers.projectId, projectId), isNull(users.deletedAt)))
    .orderBy(asc(projectMembers.createdAt));

  return rows
    .map((row) => ({
      userId: row.userId,
      email: row.email,
      name: row.name,
      image: row.image,
      role: row.role,
      canGenerate: row.canGenerate,
      isOwner: row.ownerUserId === row.userId,
      joinedAt: row.joinedAt.toISOString()
    }))
    .sort((a, b) => Number(b.isOwner) - Number(a.isOwner));
}

/** Changes a collaborator's access. The owner's own membership is never touched. */
export async function setMemberAccess(
  projectId: string,
  userId: string,
  access: { role: MemberRole; canGenerate: boolean }
): Promise<void> {
  const [project] = await db()
    .select({ ownerUserId: projects.ownerUserId })
    .from(projects)
    .where(eq(projects.id, projectId));
  if (!project || project.ownerUserId === userId) return;

  await db()
    .update(projectMembers)
    .set({ role: access.role, canGenerate: access.role === "viewer" ? false : access.canGenerate })
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)));
}

/** Removes a collaborator. The owner cannot be removed. */
export async function removeMember(projectId: string, userId: string): Promise<void> {
  const [project] = await db()
    .select({ ownerUserId: projects.ownerUserId })
    .from(projects)
    .where(eq(projects.id, projectId));
  if (!project || project.ownerUserId === userId) return;

  await db()
    .delete(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)));
}

export async function createShareLink(
  projectId: string,
  invitedByUserId: string,
  access: { role: MemberRole; canGenerate: boolean }
): Promise<ShareLink> {
  const [row] = await db()
    .insert(projectInvites)
    .values({
      projectId,
      email: null,
      role: access.role,
      canGenerate: access.role === "viewer" ? false : access.canGenerate,
      token: crypto.randomBytes(24).toString("base64url"),
      invitedByUserId,
      expiresAt: new Date(Date.now() + SHARE_LINK_DAYS * 86_400_000)
    })
    .returning();

  return toShareLink(row);
}

/** Links that still work: not revoked, not expired. */
export async function listShareLinks(projectId: string): Promise<ShareLink[]> {
  const rows = await db()
    .select()
    .from(projectInvites)
    .where(
      and(
        eq(projectInvites.projectId, projectId),
        isNull(projectInvites.email),
        isNull(projectInvites.revokedAt),
        gt(projectInvites.expiresAt, new Date())
      )
    )
    .orderBy(asc(projectInvites.createdAt));

  return rows.map(toShareLink);
}

export async function revokeShareLink(projectId: string, linkId: string): Promise<void> {
  await db()
    .update(projectInvites)
    .set({ revokedAt: new Date() })
    .where(and(eq(projectInvites.id, linkId), eq(projectInvites.projectId, projectId)));
}

/**
 * Joins the link's project with the link's access. Someone already in the
 * project keeps what they have -- a link never demotes, and never promotes
 * past what the owner chose for that person.
 */
export async function acceptShareLink(token: string, userId: string): Promise<string> {
  const [link] = await db()
    .select({
      projectId: projectInvites.projectId,
      role: projectInvites.role,
      canGenerate: projectInvites.canGenerate,
      expiresAt: projectInvites.expiresAt,
      revokedAt: projectInvites.revokedAt,
      deletedAt: projects.deletedAt
    })
    .from(projectInvites)
    .innerJoin(projects, eq(projects.id, projectInvites.projectId))
    .where(and(eq(projectInvites.token, token), isNull(projectInvites.email)))
    .limit(1);

  if (!link || link.deletedAt) {
    throw new InviteError("invalid", "This link does not work. Ask for a new one.");
  }
  if (link.revokedAt) {
    throw new InviteError("expired", "This link was turned off. Ask for a new one.");
  }
  if (link.expiresAt <= new Date()) {
    throw new InviteError("expired", "This link has expired. Ask for a new one.");
  }

  await db()
    .insert(projectMembers)
    .values({
      projectId: link.projectId,
      userId,
      role: link.role === "owner" ? "editor" : link.role,
      canGenerate: link.role === "viewer" ? false : link.canGenerate
    })
    .onConflictDoNothing();

  return link.projectId;
}

export async function projectStats(projectId: string): Promise<ProjectStats> {
  const [[imageRow], [jobRow], [storedRow], [project]] = await Promise.all([
    db()
      .select({ value: count() })
      .from(assets)
      .where(and(eq(assets.projectId, projectId), isNull(assets.deletedAt))),
    db().select({ value: count() }).from(jobs).where(eq(jobs.projectId, projectId)),
    db()
      .select({ value: sum(assets.byteSize) })
      .from(assets)
      .where(and(eq(assets.projectId, projectId), isNotNull(assets.sourceKey))),
    db().select({ createdAt: projects.createdAt }).from(projects).where(eq(projects.id, projectId))
  ]);

  return {
    images: imageRow?.value ?? 0,
    jobs: jobRow?.value ?? 0,
    storedBytes: Number(storedRow?.value ?? 0),
    createdAt: project?.createdAt.toISOString() ?? new Date().toISOString()
  };
}

function toShareLink(row: typeof projectInvites.$inferSelect): ShareLink {
  return {
    id: row.id,
    token: row.token,
    role: row.role === "owner" ? "editor" : row.role,
    canGenerate: row.canGenerate,
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString()
  };
}
