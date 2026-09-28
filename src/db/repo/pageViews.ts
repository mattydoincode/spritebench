import { and, desc, gte, isNotNull, sql } from "drizzle-orm";
import { db } from "../index";
import { pageViews } from "../schema";

export interface NewPageView {
  path: string;
  signedIn: boolean;
  referrerHost: string | null;
  visitor: string;
}

export async function recordPageView(view: NewPageView): Promise<void> {
  await db().insert(pageViews).values(view);
}

export interface DailyVisits {
  day: string;
  views: number;
  visitors: number;
  signedInViews: number;
}

export interface VisitorStats {
  days: DailyVisits[];
  referrers: { host: string; views: number; visitors: number }[];
  pages: { path: string; views: number; visitors: number }[];
}

/** The admin's visitor numbers for the last `days` days, newest day first. */
export async function visitorStats(days = 14): Promise<VisitorStats> {
  const since = sql`now() - make_interval(days => ${days})`;
  const day = sql<string>`to_char(date_trunc('day', ${pageViews.createdAt} at time zone 'UTC'), 'YYYY-MM-DD')`;

  const [daily, referrers, pages] = await Promise.all([
    db()
      .select({
        day,
        views: sql<number>`count(*)::int`,
        visitors: sql<number>`count(distinct ${pageViews.visitor})::int`,
        signedInViews: sql<number>`(count(*) filter (where ${pageViews.signedIn}))::int`
      })
      .from(pageViews)
      .where(gte(pageViews.createdAt, since))
      .groupBy(day)
      .orderBy(desc(day)),
    db()
      .select({
        host: sql<string>`${pageViews.referrerHost}`,
        views: sql<number>`count(*)::int`,
        visitors: sql<number>`count(distinct ${pageViews.visitor})::int`
      })
      .from(pageViews)
      .where(and(gte(pageViews.createdAt, since), isNotNull(pageViews.referrerHost)))
      .groupBy(pageViews.referrerHost)
      .orderBy(desc(sql`count(*)`))
      .limit(10),
    db()
      .select({
        path: pageViews.path,
        views: sql<number>`count(*)::int`,
        visitors: sql<number>`count(distinct ${pageViews.visitor})::int`
      })
      .from(pageViews)
      .where(gte(pageViews.createdAt, since))
      .groupBy(pageViews.path)
      .orderBy(desc(sql`count(*)`))
  ]);

  return { days: daily, referrers, pages };
}
