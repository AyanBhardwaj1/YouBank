import type { MetadataRoute } from "next";
import { siteLink, siteUrl } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: ["/", "/for/"], disallow: ["/app/", "/api/", "/onboarding"] }],
    sitemap: siteLink("/sitemap.xml"),
    host: siteUrl(),
  };
}
