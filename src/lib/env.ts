/**
 * The environment the app reads, checked once when a server instance starts (src/instrumentation.ts).
 * It logs what is missing or malformed instead of crashing, so a bad deploy says why a feature is off.
 */
import { normaliseSiteUrl, resolveSiteUrl } from "./site";

type Env = Record<string, string | undefined>;

/** Without these the app does not work at all. */
export const REQUIRED = ["DATABASE_URL", "BETTER_AUTH_SECRET"];
/** Needed in production for a feature (crons, SEC, AI, mail, the heartbeat). */
const PRODUCTION = ["CRON_SECRET", "AUTOPILOT_SECRET", "EDGAR_USER_AGENT", "EMAIL_TOKEN_SECRET"];
/** Optional, but must be numbers when set. */
const NUMERIC = ["DB_POOL_MAX", "AI_USER_DAILY_USD", "AI_USER_MONTHLY_USD", "AI_GLOBAL_DAILY_USD", "CHAT_BUDGET_MS", "WORKFLOW_BUDGET_MS", "NEWS_AI_BUDGET_USD", "EDGE_BACKFILL_DAILY_USD", "AUTOPILOT_POOL", "AGENT_POOL", "CALENDAR_POOL", "AUTH_SESSION_DATA_TTL", "EDGE_MODAL_MONTHLY_USD", "EDGE_INNGEST_MONTHLY", "EDGE_R2_MAX_GB", "EDGE_DOCS_DB_MB"];
/** Edge's services each need all of their keys; half a set is a mistake worth naming. */
const GROUPS: [string, string[]][] = [
  ["Cloudflare R2", ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"]],
  ["Inngest", ["INNGEST_EVENT_KEY", "INNGEST_SIGNING_KEY"]],
  ["Google sign-in", ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "NEXT_PUBLIC_GOOGLE_SIGNIN"]],
  ["the Modal ML service", ["EDGE_ML_URL", "EDGE_ML_SECRET"]],
  ["Microsoft 365 calendars", ["MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET"]],
  ["Google Calendar's own OAuth client", ["GOOGLE_CALENDAR_CLIENT_ID", "GOOGLE_CALENDAR_CLIENT_SECRET"]],
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

/**
 * The database URL the app runs on. On Neon that should be the pooled address (`-pooler` in the host):
 * serverless functions open and close connections constantly, which the pooler absorbs; the direct
 * address belongs to migrations (DATABASE_URL_UNPOOLED). Pure.
 */
export function checkDatabaseUrl(env: Env): string[] {
  const raw = env.DATABASE_URL?.trim();
  if (!raw) return [];
  let u: URL;
  try { u = new URL(raw); } catch { return ["DATABASE_URL (not a postgres:// connection string)"]; }
  if (!/^postgres(ql)?:$/.test(u.protocol)) return ["DATABASE_URL (not a postgres:// connection string)"];
  const out: string[] = [];
  if (/\.neon\.tech$/i.test(u.hostname) && !/-pooler\./i.test(u.hostname)) out.push("DATABASE_URL (Neon's direct address: use the pooled one, with -pooler in the host, for the app; keep the direct one in DATABASE_URL_UNPOOLED for migrations)");
  if (env.VERCEL && /^(localhost|127\.|0\.0\.0\.0)/.test(u.hostname)) out.push("DATABASE_URL (points at this machine, which a deployment cannot reach)");
  return out;
}

/**
 * Sign-in's own address. Better Auth sends Google back to BETTER_AUTH_URL and sets cookies for it, so on
 * the production deployment it must be the site's address (or be unset, which uses the site's). Pure.
 */
export function checkAuthUrl(env: Env, production: boolean): string[] {
  const raw = env.BETTER_AUTH_URL?.trim();
  if (!raw) return [];
  const url = normaliseSiteUrl(raw);
  if (!url) return ["BETTER_AUTH_URL (not a web address)"];
  if (production && url.startsWith("http://") && !/\/\/localhost\b/.test(url)) return ["BETTER_AUTH_URL (use https:// in production)"];
  if (env.VERCEL_ENV === "production" && url !== resolveSiteUrl(env)) return [`BETTER_AUTH_URL (${url} is not the site's address ${resolveSiteUrl(env)}: Google sign-in returns to the wrong domain. Set it to the same address as NEXT_PUBLIC_SITE_URL, or remove it)`];
  return [];
}

/** Background jobs: dev mode turns off Inngest's request signing, so it must never reach a deployment. Pure. */
export function checkJobs(env: Env, production: boolean): string[] {
  if (production && env.VERCEL && env.INNGEST_DEV?.trim()) return ["INNGEST_DEV (development only: on a deployment it skips the signature check on /api/inngest. Remove it)"];
  return [];
}

/**
 * Every optional feature, what it needs, and what people see while it is off. A feature is on when
 * every key of one of its `keys` options is set. Missing ones never stop the app: the feature says it is
 * not available, in the words of `off`. Ordered as docs/production.md lists them.
 */
export type Feature = { id: string; label: string; keys: string[][]; off: string };
export const FEATURES: Feature[] = [
  { id: "ai", label: "AI (chat, tools, drafting, research)", keys: [["OPENAI_API_KEY"], ["ANTHROPIC_API_KEY"]], off: "AI features say AI is not set up; everything else works." },
  { id: "market", label: "Market data (FMP)", keys: [["FMP_API_KEY"]], off: "Prices come from the backup sources (Nasdaq, ECB) and the cache." },
  { id: "sec", label: "SEC filings (EDGAR contact)", keys: [["EDGAR_USER_AGENT"]], off: "Filings are fetched with a placeholder contact, which SEC may block." },
  { id: "crons", label: "Scheduled jobs (Vercel Cron)", keys: [["CRON_SECRET"]], off: "The daily jobs answer 401 and do nothing." },
  { id: "heartbeats", label: "Autopilot, Newsroom and calendar heartbeats", keys: [["AUTOPILOT_SECRET"]], off: "Autopilot, the news pass and calendar sync do not run between daily crons." },
  { id: "mail", label: "Mailboxes and Slack (token encryption)", keys: [["EMAIL_TOKEN_SECRET"]], off: "Connecting a mailbox or Slack is turned off." },
  { id: "google_signin", label: "Google sign-in", keys: [["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]], off: "Only email and password sign-in is offered." },
  { id: "billing", label: "Billing (Stripe)", keys: [["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"]], off: "Plans show, but upgrading says billing is not available yet." },
  { id: "push", label: "Newsroom web push", keys: [["NEWS_VAPID_PUBLIC_KEY", "NEWS_VAPID_PRIVATE_KEY"]], off: "Push notifications are not offered; email and in-app alerts still work." },
  { id: "jobs", label: "Background jobs (Inngest)", keys: [["INNGEST_EVENT_KEY", "INNGEST_SIGNING_KEY"]], off: "Long work runs inside the request instead, within its time limit." },
  { id: "storage", label: "File storage (Cloudflare R2)", keys: [["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"]], off: "Uploads that need storage say storage is not set up." },
  { id: "ml", label: "ML service (Modal)", keys: [["EDGE_ML_URL", "EDGE_ML_SECRET"]], off: "Edge uses its built-in methods instead of the ML models." },
  { id: "calendar_google", label: "Google Calendar", keys: [["GOOGLE_CALENDAR_CLIENT_ID", "GOOGLE_CALENDAR_CLIENT_SECRET"], ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]], off: "Connecting Google Calendar is not offered (CalDAV and ICS still work)." },
  { id: "calendar_microsoft", label: "Microsoft 365 calendars", keys: [["MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET"]], off: "Connecting Microsoft 365 is not offered." },
  { id: "meetings", label: "Meeting notetaker (Recall)", keys: [["RECALL_API_KEY"]], off: "The notetaker is not offered; uploaded recordings still work." },
  { id: "brokers", label: "Brokerage links for copy trading (SnapTrade)", keys: [["SNAPTRADE_CLIENT_ID", "SNAPTRADE_CONSUMER_KEY"]], off: "Copies stay on paper; connecting a broker is not offered." },
  { id: "alpaca", label: "Alpaca connections for algo trading", keys: [["ALPACA_OAUTH_CLIENT_ID", "ALPACA_OAUTH_CLIENT_SECRET"]], off: "Alpaca is not offered; paper trading still works." },
  { id: "satellite", label: "Planet imagery", keys: [["PLANET_API_KEY"]], off: "Edge uses free Sentinel imagery only." },
  { id: "crypto_pro", label: "Crypto data keys (Alchemy, Helius, Etherscan, Dune)", keys: [["ALCHEMY_API_KEY"], ["HELIUS_API_KEY"], ["ETHERSCAN_API_KEY"], ["DUNE_API_KEY"]], off: "Wallet and on-chain views use the free public endpoints, with lower limits." },
  { id: "sentry", label: "Error tracking (Sentry)", keys: [["SENTRY_DSN"]], off: "Errors are logged to Vercel's logs only." },
];

/** Which features are on, and for the ones that are off, what is missing. Names only. Pure. */
export function featureStatus(env: Env): { id: string; label: string; on: boolean; missing: string[]; off: string }[] {
  const set = (k: string) => !!env[k]?.trim();
  return FEATURES.map((f) => {
    const on = f.keys.some((ks) => ks.every(set));
    const missing = on ? [] : f.keys[0].filter((k) => !set(k));
    return { id: f.id, label: f.label, on, missing, off: f.off };
  });
}

/**
 * The switches that move real money, as configured. All default off; only "1" turns one on.
 * Logged at startup (src/instrumentation.ts) and shown to operators by /api/health. Pure.
 */
export function moneySwitches(env: Env): { copyTrading: boolean; algoLive: boolean; webull: boolean; algoKill: boolean } {
  const on = (k: string) => env[k]?.trim() === "1";
  return { copyTrading: on("COPYTRADE_TRADING_ENABLED"), algoLive: on("ALGO_LIVE_ENABLED"), webull: on("ALGO_WEBULL_ENABLED"), algoKill: on("ALGO_KILL") };
}

/** Pure, for tests. */
export function checkEnv(env: Env, production: boolean): { missing: string[]; invalid: string[] } {
  const set = (k: string) => !!env[k]?.trim();
  const missing = [...REQUIRED, ...(production ? PRODUCTION : [])].filter((k) => !set(k));
  if (!set("OPENAI_API_KEY") && !set("ANTHROPIC_API_KEY")) missing.push("OPENAI_API_KEY or ANTHROPIC_API_KEY");
  const invalid: string[] = [];
  if (set("BETTER_AUTH_SECRET") && env.BETTER_AUTH_SECRET!.length < 32) invalid.push("BETTER_AUTH_SECRET (needs 32+ characters; sign-in fails without it)");
  if (set("EMAIL_TOKEN_SECRET") && env.EMAIL_TOKEN_SECRET!.length < 16) invalid.push("EMAIL_TOKEN_SECRET (needs 16+ characters)");
  if (set("EDGAR_USER_AGENT") && !env.EDGAR_USER_AGENT!.includes("@")) invalid.push("EDGAR_USER_AGENT (SEC asks for a contact email in it)");
  for (const k of NUMERIC) if (set(k) && !Number.isFinite(Number(env[k]))) invalid.push(`${k} (not a number)`);
  if (production && set("YOUBANK_DEV_USER")) invalid.push("YOUBANK_DEV_USER (development only; ignored in production builds, remove it)");
  for (const [name, keys] of GROUPS) {
    const have = keys.filter(set);
    if (have.length && have.length < keys.length) invalid.push(`${keys.filter((k) => !set(k)).join(", ")} (${name} is only half set up, so it stays off)`);
  }
  invalid.push(...checkStripe(env, production), ...checkSiteUrl(env, production), ...checkDatabaseUrl(env), ...checkAuthUrl(env, production), ...checkJobs(env, production));
  return { missing, invalid };
}
