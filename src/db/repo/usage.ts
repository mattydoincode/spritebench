import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "../index";
import { usageEvents } from "../schema";

export interface NewUsageEvent {
  /** Whose bill it lands on: the project's owner pays. */
  projectId: string;
  /** Who pressed the button. Null once that account is deleted. */
  userId: string | null;
  jobId: string | null;
  provider: string;
  model: string;
  operation: "generate" | "edit";
  images: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  elapsedSeconds: number | null;
}

/**
 * One row per provider call. Nothing is billed yet, but a free tier cannot be
 * sized without knowing what real usage looks like.
 */
export async function recordUsage(event: NewUsageEvent): Promise<void> {
  await db().insert(usageEvents).values(event);
}

export async function usageSince(
  projectId: string,
  since: Date
): Promise<{ calls: number; images: number; totalTokens: number }> {
  const [row] = await db()
    .select({
      calls: sql<number>`count(*)::int`,
      images: sql<number>`coalesce(sum(${usageEvents.images}), 0)::int`,
      totalTokens: sql<number>`coalesce(sum(${usageEvents.totalTokens}), 0)::int`
    })
    .from(usageEvents)
    .where(and(eq(usageEvents.projectId, projectId), gte(usageEvents.createdAt, since)));

  return row ?? { calls: 0, images: 0, totalTokens: 0 };
}

export async function recentUsage(projectId: string, limit = 50) {
  return db()
    .select()
    .from(usageEvents)
    .where(eq(usageEvents.projectId, projectId))
    .orderBy(desc(usageEvents.createdAt))
    .limit(limit);
}
