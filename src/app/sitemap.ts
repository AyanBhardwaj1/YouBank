import type { MetadataRoute } from "next";
import { ROLE_IDS } from "@/lib/roles";
import { LEGAL, siteUrl } from "@/lib/site";

/** Public pages only, on the site's own address (NEXT_PUBLIC_SITE_URL; src/lib/site.ts). */
export default function sitemap(): MetadataRoute.Sitemap {
  const BASE = siteUrl();
  const now = new Date();
  return [
    { url: BASE, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${BASE}/pricing`, lastModified: now, changeFrequency: "weekly", priority: 0.9 },
    { url: `${BASE}/sign-in`, lastModified: now, changeFrequency: "monthly", priority: 0.4 },
    { url: `${BASE}/download`, lastModified: now, changeFrequency: "weekly", priority: 0.6 },
    ...Object.values(LEGAL).map((path) => ({ url: `${BASE}${path}`, lastModified: now, changeFrequency: "monthly" as const, priority: 0.2 })),
    ...ROLE_IDS.map((r) => ({ url: `${BASE}/for/${r}`, lastModified: now, changeFrequency: "weekly" as const, priority: 0.8 })),
  ];
}
