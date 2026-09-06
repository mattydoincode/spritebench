import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "../index";
import { usageEvents } from "../schema";

export interface NewUsageEvent {
  userId: string;
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
  userId: string,
  since: Date
): Promise<{ calls: number; images: number; totalTokens: number }> {
  const [row] = await db()
    .select({
      calls: sql<number>`count(*)::int`,
      images: sql<number>`coalesce(sum(${usageEvents.images}), 0)::int`,
      totalTokens: sql<number>`coalesce(sum(${usageEvents.totalTokens}), 0)::int`
    })
    .from(usageEvents)
    .where(and(eq(usageEvents.userId, userId), gte(usageEvents.createdAt, since)));

  return row ?? { calls: 0, images: 0, totalTokens: 0 };
}

export async function recentUsage(userId: string, limit = 50) {
  return db()
    .select()
    .from(usageEvents)
    .where(eq(usageEvents.userId, userId))
    .orderBy(desc(usageEvents.createdAt))
    .limit(limit);
}
