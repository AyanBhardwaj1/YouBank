/**
 * The environment the app reads, checked once when a server instance starts (src/instrumentation.ts).
 * It logs what is missing or malformed instead of crashing, so a bad deploy says why a feature is off.
 */
import { normaliseSiteUrl, resolveSiteUrl } from "./site";

type Env = Record<string, string | undefined>;

/** Without these the app does not work at all. */
const REQUIRED = ["DATABASE_URL", "NEON_AUTH_BASE_URL", "NEON_AUTH_COOKIE_SECRET"];
/** Needed in production for a feature (crons, SEC, AI, mail, the heartbeat). */
const PRODUCTION = ["CRON_SECRET", "AUTOPILOT_SECRET", "EDGAR_USER_AGENT", "EMAIL_TOKEN_SECRET"];
/** Optional, but must be numbers when set. */
const NUMERIC = ["AI_USER_DAILY_USD", "AI_USER_MONTHLY_USD", "AI_GLOBAL_DAILY_USD", "CHAT_BUDGET_MS", "WORKFLOW_BUDGET_MS", "NEWS_AI_BUDGET_USD", "AUTOPILOT_POOL", "AGENT_POOL", "NEON_AUTH_SESSION_DATA_TTL", "EDGE_MODAL_MONTHLY_USD", "EDGE_INNGEST_MONTHLY", "EDGE_R2_MAX_GB", "EDGE_DOCS_DB_MB"];
/** Edge's services each need all of their keys; half a set is a mistake worth naming. */
const GROUPS: [string, string[]][] = [
  ["Cloudflare R2", ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"]],
  ["Inngest", ["INNGEST_EVENT_KEY", "INNGEST_SIGNING_KEY"]],
  ["the Modal ML service", ["EDGE_ML_URL", "EDGE_ML_SECRET"]],
];

/**
 * Stripe is not all-or-nothing: STRIPE_SECRET_KEY alone switches billing on (Checkout takes money), so
 * a missing webhook secret is not "billing stays off" but "payments land and later changes never arrive".
 * Each half-set state gets its own sentence. Pure.
 */
export function checkStripe(env: Env, production: boolean): string[] {
  const set = (k: string) => !!env[k]?.trim();
  const out: string[] = [];
  const key = env.STRIPE_SECRET_KEY?.trim() ?? "";
  if (key && !set("STRIPE_WEBHOOK_SECRET")) out.push("STRIPE_WEBHOOK_SECRET (billing is ON because STRIPE_SECRET_KEY is set, and Checkout takes payments, but the webhook answers 503 without this secret: renewals, failed payments, cancellations, seat changes and refunds made in Stripe never reach YouBank. Set it from the webhook endpoint)");
  if (!key && set("STRIPE_WEBHOOK_SECRET")) out.push("STRIPE_SECRET_KEY (billing stays off without it; STRIPE_WEBHOOK_SECRET on its own does nothing)");
  if (key && !Object.keys(env).some((k) => /^STRIPE_PRICE_(PRO|TEAM|ENTERPRISE)_(MONTHLY|YEARLY)$/.test(k) && set(k))) out.push("STRIPE_PRICE_* (billing is on but no plan has a price id, so only credit packs can be bought; run scripts/stripe-setup.ts and set the lines it prints)");
  if (key && !/^(sk|rk)_(test|live)_/.test(key)) out.push("STRIPE_SECRET_KEY (not a Stripe secret key: it should start with sk_live_ or sk_test_)");
  if (production && env.VERCEL_ENV === "production" && key.startsWith("sk_test_")) out.push("STRIPE_SECRET_KEY (a test key on the production deployment: nobody is really charged)");
  return out;
}

/** The public address: malformed, plain http in production, or unset on the production deployment. Pure. */
export function checkSiteUrl(env: Env, production: boolean): string[] {
  const raw = env.NEXT_PUBLIC_SITE_URL?.trim();
  if (raw && !normaliseSiteUrl(raw)) return ["NEXT_PUBLIC_SITE_URL (not a web address, e.g. https://youbank.com)"];
  if (raw && production && /^http:\/\//i.test(raw)) return ["NEXT_PUBLIC_SITE_URL (use https:// in production)"];
  if (!raw && production && env.VERCEL_ENV === "production") return [`NEXT_PUBLIC_SITE_URL (not set: links in emails, Stripe and the sitemap use ${resolveSiteUrl(env)})`];
  return [];
}

/** Pure, for tests. */
export function checkEnv(env: Env, production: boolean): { missing: string[]; invalid: string[] } {
  const set = (k: string) => !!env[k]?.trim();
  const missing = [...REQUIRED, ...(production ? PRODUCTION : [])].filter((k) => !set(k));
  if (!set("OPENAI_API_KEY") && !set("ANTHROPIC_API_KEY")) missing.push("OPENAI_API_KEY or ANTHROPIC_API_KEY");
  const invalid: string[] = [];
  if (set("NEON_AUTH_COOKIE_SECRET") && env.NEON_AUTH_COOKIE_SECRET!.length < 32) invalid.push("NEON_AUTH_COOKIE_SECRET (needs 32+ characters; every page fails without it)");
  if (set("EMAIL_TOKEN_SECRET") && env.EMAIL_TOKEN_SECRET!.length < 16) invalid.push("EMAIL_TOKEN_SECRET (needs 16+ characters)");
  if (set("EDGAR_USER_AGENT") && !env.EDGAR_USER_AGENT!.includes("@")) invalid.push("EDGAR_USER_AGENT (SEC asks for a contact email in it)");
  for (const k of NUMERIC) if (set(k) && !Number.isFinite(Number(env[k]))) invalid.push(`${k} (not a number)`);
  if (production && set("YOUBANK_DEV_USER")) invalid.push("YOUBANK_DEV_USER (development only; ignored in production builds, remove it)");
  for (const [name, keys] of GROUPS) {
    const have = keys.filter(set);
    if (have.length && have.length < keys.length) invalid.push(`${keys.filter((k) => !set(k)).join(", ")} (${name} is only half set up, so it stays off)`);
  }
  invalid.push(...checkStripe(env, production), ...checkSiteUrl(env, production));
  return { missing, invalid };
}
