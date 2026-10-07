import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: ["/", "/for/", "/news"], disallow: ["/app/", "/api/", "/onboarding"] }],
    sitemap: "https://youbank-nu.vercel.app/sitemap.xml",
  };
}
