import type { MetadataRoute } from "next";
import { ROLE_IDS } from "@/lib/roles";

const BASE = "https://youbank-nu.vercel.app";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    { url: BASE, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${BASE}/sign-in`, lastModified: now, changeFrequency: "monthly", priority: 0.4 },
    ...ROLE_IDS.map((r) => ({ url: `${BASE}/for/${r}`, lastModified: now, changeFrequency: "weekly" as const, priority: 0.8 })),
  ];
}
