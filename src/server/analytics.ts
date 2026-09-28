import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { recordPageView } from "@/db/repo/pageViews";
import { clientIp } from "@/server/rateLimit";

/** Crawlers, uptime checks and link-preview fetchers are not visitors. */
const BOT = /bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|curl|wget|python|node-fetch|axios|headless|lighthouse|monitor/i;

/**
 * Counts a view of a public page. Called from the page itself as it renders,
 * so it needs no script and ad blockers do not hide it.
 *
 * No cookie and no IP stored. `visitor` hashes IP, user agent, the UTC day and
 * AUTH_SECRET: the same person is one visitor within a day, cannot be recovered
 * from the hash, and becomes a different visitor tomorrow.
 *
 * Never throws: analytics failing must not take the page down with it.
 */
export async function trackPageView(path: string, signedIn: boolean): Promise<void> {
  try {
    const request = await headers();
    const agent = request.get("user-agent") ?? "";
    if (!agent || BOT.test(agent)) return;
    // Next prefetching a page is not someone looking at it.
    if (request.get("next-router-prefetch") || request.get("purpose") === "prefetch") return;

    const day = new Date().toISOString().slice(0, 10);
    const visitor = createHash("sha256")
      .update(`${process.env.AUTH_SECRET ?? ""}|${day}|${clientIp(request)}|${agent}`)
      .digest("base64url")
      .slice(0, 22);

    let referrerHost: string | null = null;
    try {
      const referrer = request.get("referer");
      const host = request.get("host");
      if (referrer) {
        const parsed = new URL(referrer).hostname.replace(/^www\./, "");
        // Moving between our own pages is not a referral.
        if (parsed && parsed !== host?.replace(/^www\./, "").split(":")[0]) referrerHost = parsed;
      }
    } catch {
      referrerHost = null;
    }

    await recordPageView({ path, signedIn, referrerHost, visitor });
  } catch (error) {
    console.warn("[analytics] page view not recorded", error);
  }
}
