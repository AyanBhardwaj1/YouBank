import type { MetadataRoute } from "next";
import { publicStories } from "@/lib/news/public";
import { ROLE_IDS } from "@/lib/roles";
import { LEGAL, siteUrl } from "@/lib/site";

/** Rebuilt at most hourly: the Newsroom's public stories change through the day. */
export const revalidate = 3600;

/** Public pages only, on the site's own address (NEXT_PUBLIC_SITE_URL; src/lib/site.ts), with the Newsroom's public stories. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const BASE = siteUrl();
  const now = new Date();
  // The last week's notable public stories (public data only; empty without a database).
  const stories = await publicStories(7 * 24, 500, 0.4).catch(() => []);
  return [
    { url: BASE, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${BASE}/pricing`, lastModified: now, changeFrequency: "weekly", priority: 0.9 },
    { url: `${BASE}/sign-in`, lastModified: now, changeFrequency: "monthly", priority: 0.4 },
    { url: `${BASE}/download`, lastModified: now, changeFrequency: "weekly", priority: 0.6 },
    ...Object.values(LEGAL).map((path) => ({ url: `${BASE}${path}`, lastModified: now, changeFrequency: "monthly" as const, priority: 0.2 })),
    ...ROLE_IDS.map((r) => ({ url: `${BASE}/for/${r}`, lastModified: now, changeFrequency: "weekly" as const, priority: 0.8 })),
    { url: `${BASE}/news`, lastModified: now, changeFrequency: "hourly", priority: 0.9 },
    ...stories.map((s) => ({ url: `${BASE}/news/${s.slug}`, lastModified: new Date(s.updatedAt), changeFrequency: "daily" as const, priority: Math.round((0.5 + 0.3 * Math.min(1, s.importance)) * 100) / 100 })),
  ];
}
