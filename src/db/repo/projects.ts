import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db, type Transaction } from "../index";
import { projectMembers, projects, type ProjectRole, type ProjectRow } from "../schema";

export interface ProjectSummary {
  id: string;
  name: string;
  role: ProjectRole;
  canGenerate: boolean;
  isOwner: boolean;
  createdAt: string;
}

/** Every project the user is a member of, owned or shared. */
export async function listProjects(userId: string): Promise<ProjectSummary[]> {
  const rows = await db()
    .select({
      id: projects.id,
      name: projects.name,
      ownerUserId: projects.ownerUserId,
      createdAt: projects.createdAt,
      role: projectMembers.role,
      canGenerate: projectMembers.canGenerate
    })
    .from(projectMembers)
    .innerJoin(projects, eq(projects.id, projectMembers.projectId))
    .where(and(eq(projectMembers.userId, userId), isNull(projects.deletedAt)))
    .orderBy(asc(projects.createdAt));

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    role: row.role,
    canGenerate: row.canGenerate,
    isOwner: row.ownerUserId === userId,
    createdAt: row.createdAt.toISOString()
  }));
}

/**
 * One project as `listProjects` would describe it, or null when it does not
 * exist or is not shared with this user -- the same answer for both, as in
 * `requireMember`.
 */
export async function getProjectSummary(
  userId: string,
  projectId: string
): Promise<ProjectSummary | null> {
  const [row] = await db()
    .select({
      id: projects.id,
      name: projects.name,
      ownerUserId: projects.ownerUserId,
      createdAt: projects.createdAt,
      role: projectMembers.role,
      canGenerate: projectMembers.canGenerate
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

  if (!row) return null;

  return {
    id: row.id,
    name: row.name,
    role: row.role,
    canGenerate: row.canGenerate,
    isOwner: row.ownerUserId === userId,
    createdAt: row.createdAt.toISOString()
  };
}

/**
 * Creates a project and its owner membership together. The owner gets a
 * `project_members` row like anyone else so authorization never has to
 * special-case them -- `requireMember` is the only path in.
 */
export async function createProject(
  ownerUserId: string,
  name: string,
  connection?: Transaction
): Promise<ProjectRow> {
  const run = async (tx: Transaction): Promise<ProjectRow> => {
    const [project] = await tx.insert(projects).values({ ownerUserId, name }).returning();

    await tx.insert(projectMembers).values({
      projectId: project.id,
      userId: ownerUserId,
      role: "owner",
      canGenerate: true
    });

    return project;
  };

  return connection ? run(connection) : db().transaction(run);
}

/**
 * Takes a row lock on the project for the rest of the transaction.
 *
 * The quota check reads a count and then acts on it, which is only sound if
 * concurrent requests for the same project take turns. Two collaborators
 * pressing Generate at once would otherwise both see room for one more batch.
 */
export async function lockProject(projectId: string, connection: Transaction): Promise<void> {
  await connection.execute(
    sql`select 1 from ${projects} where ${projects.id} = ${projectId} for update`
  );
}

export async function getProject(id: string): Promise<ProjectRow | null> {
  const [row] = await db()
    .select()
    .from(projects)
    .where(and(eq(projects.id, id), isNull(projects.deletedAt)))
    .limit(1);

  return row ?? null;
}

export async function renameProject(id: string, name: string): Promise<void> {
  await db().update(projects).set({ name }).where(eq(projects.id, id));
}

export async function softDeleteProject(id: string): Promise<void> {
  await db().update(projects).set({ deletedAt: new Date() }).where(eq(projects.id, id));
}

/**
 * Allocates the next asset number for a project.
 *
 * One statement, so concurrent generations cannot collide and there is no row
 * lock to hold or retry loop to get wrong. Numbers are consumed even if the
 * insert that follows fails, which is why 003 can be missing -- a gap is
 * cheaper to explain than two images that were both once 003.
 */
export async function nextAssetSeq(
  projectId: string,
  connection: Transaction = db()
): Promise<number> {
  const [row] = await connection
    .update(projects)
    .set({ nextAssetSeq: sql`${projects.nextAssetSeq} + 1` })
    .where(eq(projects.id, projectId))
    .returning({ seq: projects.nextAssetSeq });

  if (!row) throw new Error(`project ${projectId} does not exist`);

  // `returning` hands back the incremented value, so the number this call
  // owns is one below it.
  return row.seq - 1;
}

/** Provider id → key id this project bills. Missing providers use the owner's default. */
export async function getProjectKeyDefaults(projectId: string): Promise<Record<string, string>> {
  const [row] = await db()
    .select({ keyDefaults: projects.keyDefaults })
    .from(projects)
    .where(eq(projects.id, projectId));
  return row?.keyDefaults ?? {};
}

/** Sets or clears (`null`) this project's key for one provider. */
export async function setProjectKeyDefault(
  projectId: string,
  provider: string,
  keyId: string | null
): Promise<Record<string, string>> {
  const next = { ...(await getProjectKeyDefaults(projectId)) };
  if (keyId) next[provider] = keyId;
  else delete next[provider];

  await db().update(projects).set({ keyDefaults: next }).where(eq(projects.id, projectId));
  return next;
}
