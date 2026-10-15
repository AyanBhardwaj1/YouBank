import type { MetadataRoute } from "next";
import { siteLink, siteUrl } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  // Preview deployments are for us: nothing on them should be indexed (Vercel also sends noindex there).
  if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production") return { rules: [{ userAgent: "*", disallow: "/" }] };
  return {
    rules: [{ userAgent: "*", allow: ["/", "/for/", "/pricing", "/terms", "/privacy", "/refunds", "/news"], disallow: ["/app/", "/api/", "/onboarding"] }],
    sitemap: siteLink("/sitemap.xml"),
    host: siteUrl(),
  };
}
