import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: ["/", "/for/"], disallow: ["/app/", "/api/", "/onboarding"] }],
    sitemap: "https://youbank-nu.vercel.app/sitemap.xml",
  };
}
