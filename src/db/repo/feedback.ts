import { and, count, desc, eq, isNotNull, isNull, sql, sum } from "drizzle-orm";
import { db } from "../index";
import { assets, feedback, jobs, projects, users } from "../schema";

export interface FeedbackEntry {
  id: string;
  body: string;
  createdAt: string;
  userEmail: string | null;
  userName: string | null;
  projectName: string | null;
}

export interface AdminStats {
  users: number;
  projects: number;
  assets: number;
  jobs: number;
  feedback: number;
  /** Full-resolution originals still in storage, in bytes. */
  storedBytes: number;
}

export interface UserUsage {
  id: string;
  email: string;
  name: string | null;
  joinedAt: string;
  /** Projects they own (not deleted). */
  projects: number;
  /** Generation jobs they started, and how many of those failed. */
  jobs: number;
  failedJobs: number;
  /** Images their jobs produced. */
  images: number;
  /** Originals still stored in projects they own: whose storage it is. */
  storedBytes: number;
  lastJobAt: string | null;
}

export async function addFeedback(
  userId: string,
  projectId: string | null,
  body: string
): Promise<void> {
  await db().insert(feedback).values({ userId, projectId, body });
}

/** Newest first, with who sent it and from which project. */
export async function listFeedback(limit = 500): Promise<FeedbackEntry[]> {
  const rows = await db()
    .select({
      id: feedback.id,
      body: feedback.body,
      createdAt: feedback.createdAt,
      userEmail: users.email,
      userName: users.name,
      projectName: projects.name
    })
    .from(feedback)
    .leftJoin(users, eq(users.id, feedback.userId))
    .leftJoin(projects, eq(projects.id, feedback.projectId))
    .orderBy(desc(feedback.createdAt))
    .limit(limit);

  return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
}

export async function adminStats(): Promise<AdminStats> {
  const one = async (query: Promise<Array<{ value: number }>>) => (await query)[0]?.value ?? 0;

  const [userCount, projectCount, assetCount, jobCount, feedbackCount, stored] = await Promise.all([
    one(db().select({ value: count() }).from(users).where(isNull(users.deletedAt))),
    one(db().select({ value: count() }).from(projects).where(isNull(projects.deletedAt))),
    one(db().select({ value: count() }).from(assets)),
    one(db().select({ value: count() }).from(jobs)),
    one(db().select({ value: count() }).from(feedback)),
    db().select({ value: sum(assets.byteSize) }).from(assets).where(isNotNull(assets.sourceKey))
  ]);

  return {
    users: userCount,
    projects: projectCount,
    assets: assetCount,
    jobs: jobCount,
    feedback: feedbackCount,
    storedBytes: Number(stored[0]?.value ?? 0)
  };
}

/** One row per user, heaviest storage first. Correlated counts: fine at alpha scale. */
export async function userUsage(): Promise<UserUsage[]> {
  const rows = await db()
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      joinedAt: users.createdAt,
      projects: sql<number>`(select count(*) from ${projects} p
        where p.owner_user_id = "users"."id" and p.deleted_at is null)`,
      jobs: sql<number>`(select count(*) from ${jobs} j where j.user_id = "users"."id")`,
      failedJobs: sql<number>`(select count(*) from ${jobs} j
        where j.user_id = "users"."id" and j.status = 'error')`,
      images: sql<number>`(select count(*) from ${assets} a
        join ${jobs} j on j.id = a.job_id where j.user_id = "users"."id")`,
      storedBytes: sql<number>`(select coalesce(sum(a.byte_size), 0) from ${assets} a
        join ${projects} p on p.id = a.project_id
        where p.owner_user_id = "users"."id" and a.source_key is not null)`,
      lastJobAt: sql<Date | null>`(select max(j.created_at) from ${jobs} j where j.user_id = "users"."id")`
    })
    .from(users)
    .where(isNull(users.deletedAt));

  return rows
    .map((row) => ({
      id: row.id,
      email: row.email,
      name: row.name,
      joinedAt: row.joinedAt.toISOString(),
      projects: Number(row.projects),
      jobs: Number(row.jobs),
      failedJobs: Number(row.failedJobs),
      images: Number(row.images),
      storedBytes: Number(row.storedBytes),
      lastJobAt: row.lastJobAt ? new Date(row.lastJobAt).toISOString() : null
    }))
    .sort((a, b) => b.storedBytes - a.storedBytes || b.jobs - a.jobs);
}

/** Only ever true when set by hand in the database. */
export async function isAdmin(userId: string): Promise<boolean> {
  const [row] = await db()
    .select({ isAdmin: users.isAdmin })
    .from(users)
    .where(and(eq(users.id, userId), isNull(users.deletedAt)))
    .limit(1);
  return row?.isAdmin === true;
}
