import type { MetadataRoute } from "next";
import { publicStories } from "@/lib/news/public";
import { ROLE_IDS } from "@/lib/roles";

const BASE = "https://youbank-nu.vercel.app";

/** Rebuilt at most hourly: the Newsroom's public stories change through the day. */
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  // The last week's notable public stories (public data only; empty without a database).
  const stories = await publicStories(7 * 24, 500, 0.4).catch(() => []);
  return [
    { url: BASE, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${BASE}/sign-in`, lastModified: now, changeFrequency: "monthly", priority: 0.4 },
    ...ROLE_IDS.map((r) => ({ url: `${BASE}/for/${r}`, lastModified: now, changeFrequency: "weekly" as const, priority: 0.8 })),
    { url: `${BASE}/news`, lastModified: now, changeFrequency: "hourly", priority: 0.9 },
    ...stories.map((s) => ({ url: `${BASE}/news/${s.slug}`, lastModified: new Date(s.updatedAt), changeFrequency: "daily" as const, priority: Math.round((0.5 + 0.3 * Math.min(1, s.importance)) * 100) / 100 })),
  ];
}
