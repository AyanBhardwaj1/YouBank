import type { MetadataRoute } from "next";
import { ROLE_IDS } from "@/lib/roles";
import { siteUrl } from "@/lib/site";

/** Public pages only, on the site's own address (NEXT_PUBLIC_SITE_URL; src/lib/site.ts). */
export default function sitemap(): MetadataRoute.Sitemap {
  const BASE = siteUrl();
  const now = new Date();
  return [
    { url: BASE, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${BASE}/sign-in`, lastModified: now, changeFrequency: "monthly", priority: 0.4 },
    ...ROLE_IDS.map((r) => ({ url: `${BASE}/for/${r}`, lastModified: now, changeFrequency: "weekly" as const, priority: 0.8 })),
  ];
}
