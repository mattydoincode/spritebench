import { and, count, desc, eq, isNull } from "drizzle-orm";
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

  const [userCount, projectCount, assetCount, jobCount, feedbackCount] = await Promise.all([
    one(db().select({ value: count() }).from(users).where(isNull(users.deletedAt))),
    one(db().select({ value: count() }).from(projects).where(isNull(projects.deletedAt))),
    one(db().select({ value: count() }).from(assets)),
    one(db().select({ value: count() }).from(jobs)),
    one(db().select({ value: count() }).from(feedback))
  ]);

  return {
    users: userCount,
    projects: projectCount,
    assets: assetCount,
    jobs: jobCount,
    feedback: feedbackCount
  };
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
