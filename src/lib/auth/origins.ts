/**
 * Where sign-in lives on each deployment, and which page origins may post to it. Pure, for tests.
 *
 * - Production: BETTER_AUTH_URL when set, else the site's address (NEXT_PUBLIC_SITE_URL, then the
 *   project's production domain). Google sends people back to `<base>/api/auth/callback/google`, so that
 *   address must be registered with the OAuth client.
 * - Preview deployments (VERCEL_ENV=preview) live on their own *.vercel.app addresses. Sign-in there runs
 *   on the preview's own address, so a BETTER_AUTH_URL copied from production (which would send the
 *   preview's sign-ins to production, where its cookies do not exist) is ignored. Email sign-in works on
 *   previews; Google sign-in needs a registered callback, so it is for production (or a fixed preview
 *   domain set in BETTER_AUTH_URL).
 * - Trusted origins: Better Auth refuses a sign-in POST whose Origin is not trusted. Every address this
 *   deployment answers on is trusted: its base, the site, the production domain and the original
 *   vercel.app address (both keep serving after a custom domain is added), the deployment's own
 *   VERCEL_URL and VERCEL_BRANCH_URL, and AUTH_TRUSTED_ORIGINS (comma-separated, exact origins; a
 *   wildcard entry is ignored) for anything else.
 */
import { DEFAULT_SITE_URL, normaliseSiteUrl, resolveSiteUrl } from "@/lib/site";

type Env = Record<string, string | undefined>;

/** The address sign-in runs on. */
export function authBaseUrl(env: Env): string {
  const site = resolveSiteUrl(env);
  const explicit = normaliseSiteUrl(env.BETTER_AUTH_URL);
  if (env.VERCEL_ENV === "preview") {
    const own = normaliseSiteUrl(env.VERCEL_BRANCH_URL) ?? normaliseSiteUrl(env.VERCEL_URL);
    const production = new Set([site, normaliseSiteUrl(env.VERCEL_PROJECT_PRODUCTION_URL), DEFAULT_SITE_URL]);
    if (explicit && !production.has(explicit)) return explicit;
    return own ?? explicit ?? site;
  }
  return explicit ?? site;
}

/** Every origin a sign-in request may come from on this deployment. */
export function authTrustedOrigins(env: Env): string[] {
  const list = [
    authBaseUrl(env),
    resolveSiteUrl(env),
    normaliseSiteUrl(env.BETTER_AUTH_URL),
    normaliseSiteUrl(env.VERCEL_PROJECT_PRODUCTION_URL),
    DEFAULT_SITE_URL,
    normaliseSiteUrl(env.VERCEL_URL),
    normaliseSiteUrl(env.VERCEL_BRANCH_URL),
    // Exact origins only: Better Auth reads "*" as a wildcard, and "https://*.vercel.app" would trust
    // every site on Vercel to post to sign-in.
    ...(env.AUTH_TRUSTED_ORIGINS ?? "").split(",").filter((o) => !o.includes("*")).map((o) => normaliseSiteUrl(o)),
    ...(env.NODE_ENV !== "production" ? ["http://localhost:3000", "http://127.0.0.1:3000"] : []),
  ];
  return [...new Set(list.filter((o): o is string => !!o))];
}
