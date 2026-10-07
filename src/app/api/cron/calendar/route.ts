import { NextResponse } from "next/server";
import { and, asc, eq, sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { providerFor } from "@/lib/calendar/accounts";
import { ensurePush, pushOrigin } from "@/lib/calendar/push";
import { loadLinkContext, pruneOld, relinkUser, syncAccount, type LinkContext } from "@/lib/calendar/sync";
import { secretsMatch } from "@/lib/crm/crypto";
import { describeFailure } from "@/lib/errors";
import { pool, poolSize } from "@/lib/pool";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Calendar sync, for everyone with a connected calendar. Free work: provider reads and database
 * writes, no AI and no paid API.
 *
 * Called every 15 minutes by the Neon Function in neon/calendar.ts (AUTOPILOT_SECRET), and daily by
 * Vercel Cron (CRON_SECRET) as a floor. Accounts are visited least-recently-synced first, a few at a
 * time (CALENDAR_POOL, 4 by default), until the time budget is spent; push channels that are about to
 * lapse are renewed on the way.
 */
async function handle(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  if (![process.env.CRON_SECRET, process.env.AUTOPILOT_SECRET].some((s) => s && secretsMatch(auth, `Bearer ${s}`))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const started = Date.now();
  const deadline = started + 260_000;
  const origin = pushOrigin(new URL(req.url).origin);
  const db = requireDb();
  const A = schema.calendarAccounts;
  const accounts = await db.select().from(A).where(eq(A.status, "connected")).orderBy(sql`${A.lastSyncAt} asc nulls first`, asc(A.id)).limit(500);
  const contexts = new Map<string, Promise<LinkContext>>();
  const ctxFor = (userId: string) => { if (!contexts.has(userId)) contexts.set(userId, loadLinkContext(userId)); return contexts.get(userId)!; };

  const results = await pool(accounts, poolSize(process.env.CALENDAR_POOL, 4), async (account) => {
    try {
      const r = await syncAccount(account, { ctx: await ctxFor(account.userId) });
      let push = 0;
      if (!r.error && (account.provider === "google" || account.provider === "microsoft")) {
        const provider = providerFor(account);
        const cals = await db.select().from(schema.calendarCalendars).where(and(eq(schema.calendarCalendars.accountId, account.id), eq(schema.calendarCalendars.visible, true)));
        for (const c of cals) {
          const s = await ensurePush(account, c, provider, origin).catch(() => "skipped");
          if (s === "created" || s === "renewed") push++;
        }
      }
      return { account: account.id, written: r.written, push, ...(r.error ? { error: r.error } : {}) };
    } catch (e) {
      return { account: account.id, error: describeFailure(e, 500, "calendar-cron").message };
    }
  }, deadline - 30_000);

  for (const userId of contexts.keys()) {
    if (Date.now() > deadline) break;
    await relinkUser(userId, await ctxFor(userId)).catch(() => undefined);
  }
  await pruneOld().catch(() => undefined);
  return NextResponse.json({ ok: true, ms: Date.now() - started, visited: results.length, results });
}

export const GET = handle;
export const POST = handle;
