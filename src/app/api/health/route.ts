import { sql } from "drizzle-orm";
import { db } from "@/db";
import { cronAuthorized, isAdmin } from "@/lib/auth/admin";
import { currentUser } from "@/lib/auth/user";
import { jobsReady } from "@/lib/edge/infra/jobs";
import { checkEnv, featureStatus, moneySwitches, REQUIRED } from "@/lib/env";
import { logError } from "@/lib/errors";
import { healthVerdict, type DbCheck } from "@/lib/health";
import { schemaStatus } from "@/lib/setup";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

/** Long enough for a compute waking from zero (a second or two, more on a bad day), short enough for a probe. */
const DB_TIMEOUT_MS = 8_000;

/** Whether the database answers, how fast, and which tables and migrations are missing. */
async function database(): Promise<DbCheck> {
  if (!db) return { ok: false, ms: 0, reason: "not configured" };
  const d = db;
  const t0 = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error("database health check timed out"), { name: "TimeoutError" })), DB_TIMEOUT_MS); });
    const schema = await Promise.race([d.execute(sql`select 1`).then(() => schemaStatus(d)), timeout]);
    return { ok: true, ms: Date.now() - t0, schema };
  } catch (e) {
    logError(e, { where: "health-db" });
    return { ok: false, ms: Date.now() - t0, reason: (e as { name?: string }).name === "TimeoutError" ? "timed out" : "unreachable" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Is the app working? For uptime monitors and deploy checks: `ok`, `degraded` or `down` (src/lib/health
 * says which is which). Down answers 503 so a monitor alerts; the other two 200. A monitor that should
 * not touch the database uses /api/health/live instead.
 *
 * Anyone sees the status and which checks passed. The names of missing or malformed settings and
 * migrations, which features are on, and the real-money switches are shown only to operators (the cron
 * secret as a bearer token, or a signed-in ADMIN_EMAILS address) and in development. No setting's value
 * is ever read into the response.
 *   curl -H "Authorization: Bearer $CRON_SECRET" https://…/api/health
 */
export async function GET(req: Request) {
  const production = process.env.NODE_ENV === "production";
  const { missing, invalid } = checkEnv(process.env, production);
  const [dbCheck, user] = await Promise.all([database(), currentUser().catch(() => null)]);
  const operator = !production || cronAuthorized(req) || isAdmin(user);
  const v = healthVerdict({
    db: dbCheck,
    env: { missing, invalid, fatal: missing.filter((k) => REQUIRED.includes(k)) },
    jobs: { on: jobsReady() },
    operator,
  });
  const body = {
    status: v.status,
    time: new Date().toISOString(),
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
    env: process.env.VERCEL_ENV ?? (production ? "production" : "development"),
    region: process.env.VERCEL_REGION ?? null,
    checks: v.checks,
    ...(operator ? {
      features: Object.fromEntries(featureStatus(process.env).map((f) => [f.id, f.on ? true : { on: false, missing: f.missing }])),
      realMoney: moneySwitches(process.env),
    } : {}),
  };
  return Response.json(body, { status: v.httpStatus, headers: { "Cache-Control": "no-store" } });
}
