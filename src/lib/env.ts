/**
 * The environment the app reads, checked once when a server instance starts (src/instrumentation.ts).
 * It logs what is missing or malformed instead of crashing, so a bad deploy says why a feature is off.
 */
type Env = Record<string, string | undefined>;

/** Without these the app does not work at all. */
const REQUIRED = ["DATABASE_URL", "NEON_AUTH_BASE_URL", "NEON_AUTH_COOKIE_SECRET"];
/** Needed in production for a feature (crons, SEC, AI, mail, the heartbeat). */
const PRODUCTION = ["CRON_SECRET", "AUTOPILOT_SECRET", "EDGAR_USER_AGENT", "EMAIL_TOKEN_SECRET"];
/** Optional, but must be numbers when set. */
const NUMERIC = ["AI_USER_DAILY_USD", "AI_GLOBAL_DAILY_USD", "CHAT_BUDGET_MS", "WORKFLOW_BUDGET_MS", "NEWS_AI_BUDGET_USD", "AUTOPILOT_POOL", "AGENT_POOL"];

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
  return { missing, invalid };
}
