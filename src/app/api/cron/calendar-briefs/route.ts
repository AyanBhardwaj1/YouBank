import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { morningBriefs } from "@/lib/calendar/briefs";
import { secretsMatch } from "@/lib/crm/crypto";
import { describeFailure } from "@/lib/errors";
import { pool } from "@/lib/pool";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Morning meeting briefs: background AI, so only for people who switched "auto-brief my external
 * meetings each morning" on in Settings and whose plan includes it (checked again per person here).
 * Each person is briefed once per local day, after 06:00 their time, so this can be called as often
 * as the sync (every 15 minutes) or once a day.
 */
async function handle(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  if (![process.env.CRON_SECRET, process.env.AUTOPILOT_SECRET].some((s) => s && secretsMatch(auth, `Bearer ${s}`))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const started = Date.now();
  const users = await requireDb().select({ userId: schema.calendarPrefs.userId }).from(schema.calendarPrefs).where(eq(schema.calendarPrefs.autoBrief, true)).limit(1000);
  const results = await pool(users.map((u) => u.userId), 3, async (userId) => {
    try {
      return { user: userId.slice(0, 8), ...(await morningBriefs(userId)) };
    } catch (e) {
      return { user: userId.slice(0, 8), error: describeFailure(e, 500, "calendar-briefs-cron").message };
    }
  }, started + 250_000);
  return NextResponse.json({ ok: true, ms: Date.now() - started, results });
}

export const GET = handle;
export const POST = handle;
