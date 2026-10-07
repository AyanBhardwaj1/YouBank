import { sql } from "drizzle-orm";
import { db } from "@/db";
import { cronAuthorized, isAdmin } from "@/lib/auth/admin";
import { currentUser } from "@/lib/auth/user";
import { checkEnv } from "@/lib/env";
import { logError } from "@/lib/errors";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

/** Long enough for a Neon compute to wake from suspend (a few seconds), short enough for an uptime probe. */
const DB_TIMEOUT_MS = 8_000;

/** Optional services, each on when all of its settings are present. Names only; values never leave here. */
const SERVICES: [string, string[][]][] = [
  ["ai", [["OPENAI_API_KEY"], ["ANTHROPIC_API_KEY"]]],
  ["sec", [["EDGAR_USER_AGENT"]]],
  ["mail", [["EMAIL_TOKEN_SECRET"]]],
  ["r2", [["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"]]],
  ["jobs", [["INNGEST_EVENT_KEY", "INNGEST_SIGNING_KEY"]]],
  ["ml", [["EDGE_ML_URL", "EDGE_ML_SECRET"]]],
  ["sentry", [["SENTRY_DSN"]]],
];

const set = (k: string) => !!process.env[k]?.trim();

/** Whether the database answers, how fast, and whether the core tables exist (migrations applied). */
async function database(): Promise<{ ok: boolean; ms: number; schema?: boolean; reason?: string }> {
  if (!db) return { ok: false, ms: 0, reason: "not configured" };
  const t0 = Date.now();
  try {
    const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(Object.assign(new Error("database health check timed out"), { name: "TimeoutError" })), DB_TIMEOUT_MS));
    const r = await Promise.race([db.execute(sql`select to_regclass('public.profiles') is not null as tables`), timeout]);
    const tables = !!(r.rows[0] as { tables?: boolean } | undefined)?.tables;
    return { ok: true, ms: Date.now() - t0, schema: tables, ...(tables ? {} : { reason: "tables missing: run the migrations" }) };
  } catch (e) {
    logError(e, { where: "health-db" });
    return { ok: false, ms: Date.now() - t0, reason: (e as { name?: string }).name === "TimeoutError" ? "timed out" : "unreachable" };
  }
}

/**
 * Is the app working? For uptime monitors and deploy checks: `ok`, `degraded` (it serves, but something
 * it needs is missing: the tables, a production setting, an optional service half set up) or `down`
 * (no database, or a setting every page needs). Down answers 503 so a monitor alerts; the other two 200.
 *
 * Anyone sees the status and which checks passed. The names of missing or malformed settings and which
 * optional services are on are shown only to operators (the cron secret as a bearer token, or a signed-in
 * ADMIN_EMAILS address) and in development. No setting's value is ever read into the response.
 *   curl -H "Authorization: Bearer $CRON_SECRET" https://…/api/health
 */
export async function GET(req: Request) {
  const production = process.env.NODE_ENV === "production";
  const { missing, invalid } = checkEnv(process.env, production);
  const [dbCheck, user] = await Promise.all([database(), currentUser().catch(() => null)]);
  // Settings every page needs (checkEnv's REQUIRED), as opposed to production-only feature settings.
  const fatal = missing.filter((k) => ["DATABASE_URL", "NEON_AUTH_BASE_URL", "NEON_AUTH_COOKIE_SECRET"].includes(k));
  const status = !dbCheck.ok || fatal.length ? "down" : dbCheck.schema === false || missing.length || invalid.length ? "degraded" : "ok";
  const operator = !production || cronAuthorized(req) || isAdmin(user);
  const body = {
    status,
    time: new Date().toISOString(),
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
    checks: {
      database: { ok: dbCheck.ok, ms: dbCheck.ms, ...(dbCheck.schema === undefined ? {} : { schema: dbCheck.schema }), ...(dbCheck.reason ? { reason: dbCheck.reason } : {}) },
      env: { ok: !missing.length && !invalid.length, ...(operator ? { missing, invalid } : { problems: missing.length + invalid.length }) },
    },
    ...(operator ? { services: Object.fromEntries(SERVICES.map(([name, options]) => [name, options.some((keys) => keys.every(set))])) } : {}),
  };
  return Response.json(body, { status: status === "down" ? 503 : 200, headers: { "Cache-Control": "no-store" } });
}
