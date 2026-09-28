import type { MetadataRoute } from "next";

const SITE = process.env.AUTH_URL?.trim() || "https://spritebench.com";

/** The pages anyone can read without signing in. */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${SITE}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE}/privacy`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${SITE}/terms`, changeFrequency: "yearly", priority: 0.3 }
  ];
}
