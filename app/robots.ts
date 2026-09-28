import type { MetadataRoute } from "next";

const SITE = process.env.AUTH_URL?.trim() || "https://spritebench.com";

/** Public pages are crawlable; the app behind sign-in is not worth a crawler's time. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/projects", "/settings", "/admin", "/join/"]
    },
    sitemap: `${SITE}/sitemap.xml`
  };
}
