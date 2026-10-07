/**
 * The site's public address: the one setting everything that depends on the domain reads (Checkout's
 * return pages, the billing portal's return link, links in emails and Slack, team invitations, Open Graph
 * and canonical URLs, the sitemap, robots.txt, and the webhook URL scripts/stripe-setup.ts registers).
 *
 * Set NEXT_PUBLIC_SITE_URL to the custom domain (https://youbank.com) in Vercel, for Production, and
 * redeploy: it is inlined at build time, so the client sees it too. Until it is set the address falls back
 * to YOUBANK_URL (the older server-only setting), then to the project's production domain that Vercel
 * provides (VERCEL_PROJECT_PRODUCTION_URL, which becomes the custom domain once it is added), then to
 * the original vercel.app address. Safe to import on the client.
 */

export const DEFAULT_SITE_URL = "https://youbank-nu.vercel.app";

/** Normalise an address: https:// when no scheme is given, no trailing slash, nothing after the host. Null when it is not a URL. */
export function normaliseSiteUrl(raw: string | undefined | null): string | null {
  const v = raw?.trim();
  if (!v) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`);
    if (!u.hostname.includes(".") && u.hostname !== "localhost") return null;
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

/** The address from a set of variables, in order of precedence. Pure, for tests and scripts. */
export function resolveSiteUrl(env: Record<string, string | undefined>): string {
  return normaliseSiteUrl(env.NEXT_PUBLIC_SITE_URL) ?? normaliseSiteUrl(env.YOUBANK_URL) ?? normaliseSiteUrl(env.VERCEL_PROJECT_PRODUCTION_URL) ?? DEFAULT_SITE_URL;
}

/** The site's address, without a trailing slash. */
export function siteUrl(): string {
  // Each variable is named in full so Next.js can inline NEXT_PUBLIC_SITE_URL into client code.
  return resolveSiteUrl({
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
    YOUBANK_URL: typeof window === "undefined" ? process.env.YOUBANK_URL : undefined,
    VERCEL_PROJECT_PRODUCTION_URL: typeof window === "undefined" ? process.env.VERCEL_PROJECT_PRODUCTION_URL : undefined,
  });
}

/** An absolute link on the site: siteUrl() + path. */
export const siteLink = (path = "/") => `${siteUrl()}${path.startsWith("/") ? path : `/${path}`}`;

/** The public legal pages, linked from the footer, Checkout and the billing portal. */
export const LEGAL = { terms: "/terms", privacy: "/privacy", refunds: "/refunds" } as const;
