/**
 * The copy-trading cron pass. Free work only: SEC EDGAR, OpenFIGI's free tier, free prices, our own
 * database. It never places an order and never calls a paid API.
 *
 * Each pass (every 15 minutes from the Neon heartbeat, once a day from Vercel Cron as a fallback):
 * 1. Polls EDGAR for new 13F-HR and 13F-HR/A filings: every pass in the weeks around the 45-day deadlines
 *    (when most 13Fs arrive), otherwise every three hours. Yesterday's daily index is read once a day to
 *    catch anything the feed's last hundred entries missed.
 * 2. Every filer seen goes into the search directory; filings from funds someone follows or copies, and
 *    from the curated list, are read and stored.
 * 3. For each new filing: followers get an alert (the bell, and push where they turned it on), paper
 *    copies rebalance at that day's prices, and owners of live copies are told a new proposal is ready
 *    to review. Live copies are never traded from here.
 * 4. Sent orders that are not final are checked with the broker, and copies' holdings recounted.
 * 5. Once a quarter, the full EDGAR index fills the directory of every 13F filer.
 */
import { and, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { cacheGet, cacheSet } from "@/lib/cache";
import { describeFailure, logError } from "@/lib/errors";
import { lease } from "@/lib/locks";
import { deliverAlert } from "@/lib/news/alerts";
import { readerFor } from "@/lib/news/reader";
import { siteUrl } from "@/lib/site";
import { dailyIndex13f, feed13f, noteFilers, quarter13fFilers, retryFailedFilings, syncFund, type SeenFiling } from "./edgar13f";
import { CURATED, curatedByCik } from "./funds";
import { refreshOpenOrders } from "./live";
import { liveCopiesOf, rebalancePaperCopies } from "./portfolios";
import { pollDue, quarterEndOf } from "./thirteenf";

/** Put a copy alert in the person's bell and send it through their alert channels. */
export async function notify(userId: string, n: { key: string; title: string; body: string; url: string; reasons: string[] }): Promise<boolean> {
  const db = requireDb();
  const [row] = await db.insert(schema.newsNotifications).values({ userId, key: n.key, kind: "alert", title: n.title.slice(0, 300), body: n.body.slice(0, 600), url: n.url, urgent: false }).onConflictDoNothing().returning();
  if (!row) return false;
  try {
    const ctx = await readerFor(userId);
    if (ctx?.prefs.alerts.enabled) {
      const delivered = await deliverAlert(ctx, { key: row.key, title: row.title, body: row.body, url: row.url, urgent: false, reasons: n.reasons }, siteUrl());
      if (Object.keys(delivered).length) await db.update(schema.newsNotifications).set({ delivered }).where(eq(schema.newsNotifications.id, row.id));
    }
  } catch (e) { logError(e, { where: "copy-alert-deliver" }); }
  return true;
}

/** The funds anyone follows or copies, and the curated ones. */
async function watchedCiks(): Promise<Set<string>> {
  const db = requireDb();
  const [follows, copies] = await Promise.all([
    db.selectDistinct({ cik: schema.copyFollows.cik }).from(schema.copyFollows),
    db.select({ funds: schema.copyPortfolios.funds }).from(schema.copyPortfolios).where(eq(schema.copyPortfolios.status, "active")),
  ]);
  return new Set([...CURATED.map((f) => f.cik), ...follows.map((f) => f.cik), ...copies.flatMap((c) => c.funds.map((f) => f.cik))]);
}

/** Tell everyone concerned about a new filing; rebalance paper copies. Returns counts. */
export async function onNewFiling(cik: string, f: { accession: string; form: string; filedOn: string; period: string; name: string }): Promise<{ alerts: number; paper: number; live: number }> {
  const db = requireDb();
  const amended = /\/A$/.test(f.form);
  const label = curatedByCik(cik)?.name ?? f.name;
  const title = `${label} filed a ${amended ? "13F amendment" : "new 13F"}`;
  const body = `Holdings as of ${f.period}, filed ${f.filedOn}. ${amended ? "An amendment can restate the quarter or add holdings first kept confidential." : "These are positions at the quarter end, up to 45 days old."}`;
  let alerts = 0;
  for (const { userId } of await db.select({ userId: schema.copyFollows.userId }).from(schema.copyFollows).where(eq(schema.copyFollows.cik, cik))) {
    if (await notify(userId, { key: `copy:filing:${f.accession}`, title, body, url: `/app/copy/fund/${cik}`, reasons: [`You follow ${label}`] }).catch(() => false)) alerts++;
  }
  const paper = await rebalancePaperCopies(cik).catch((e) => { logError(e, { where: "copy-paper-rebalance" }); return []; });
  for (const p of paper) await notify(p.userId, { key: `copy:paper:${p.copyId}:${f.accession}`, title: `Paper copy rebalanced: ${p.name}`, body: `${title}. Your paper copy now holds the new filing's positions, at today's prices.`, url: `/app/copy?copy=${p.copyId}`, reasons: ["Paper copy"] }).catch(() => false);
  const live = await liveCopiesOf(cik);
  for (const c of live) await notify(c.userId, { key: `copy:live:${c.id}:${f.accession}`, title: `Orders to review: ${c.name}`, body: `${title}. Open the copy to see the orders that would match it. Nothing is placed until you approve.`, url: `/app/copy?copy=${c.id}&review=1`, reasons: ["Live copy"] }).catch(() => false);
  return { alerts, paper: paper.length, live: live.length };
}

const quarterOf = (d: Date) => ({ y: d.getUTCFullYear(), q: Math.ceil((d.getUTCMonth() + 1) / 3) });

/** One cron pass. */
export async function copyTick(deadline: number): Promise<Record<string, unknown>> {
  const release = await lease("copytrade:tick", 290_000);
  if (!release) return { skipped: "another pass is running" };
  const report: Record<string, unknown> = {};
  try {
    const now = new Date();
    const last = Number(await cacheGet("copy:last-poll")) || null;
    const seen: SeenFiling[] = [];
    if (pollDue(now, last)) {
      seen.push(...await feed13f().catch((e) => { report.feedError = describeFailure(e, 500, "copy-feed").message; return []; }));
      await cacheSet("copy:last-poll", String(now.getTime()), 7 * 86_400_000);
      report.polled = true;
    }
    const y = new Date(now.getTime() - 86_400_000);
    const ykey = `copy:daily-index:${y.toISOString().slice(0, 10)}`;
    if (now.getUTCHours() >= 10 && !(await cacheGet(ykey))) {
      seen.push(...await dailyIndex13f(y));
      await cacheSet(ykey, "1", 10 * 86_400_000);
      report.dailyIndex = y.toISOString().slice(0, 10);
    }
    report.filersNoted = seen.length ? await noteFilers(seen) : 0;

    const watched = await watchedCiks();
    const db = requireDb();
    const fresh = seen.filter((s) => watched.has(s.cik));
    const stored = fresh.length ? new Set((await db.select({ a: schema.copyFilings.accession }).from(schema.copyFilings).where(inArray(schema.copyFilings.accession, fresh.map((s) => s.accession)))).map((r) => r.a)) : new Set<string>();
    const toSync = new Set(fresh.filter((s) => !stored.has(s.accession)).map((s) => s.cik));
    // Watched funds not checked for a day (a missed feed entry, a fund just followed): a few per pass.
    const stale = await db.select({ cik: schema.copyFilers.cik }).from(schema.copyFilers)
      .where(and(inArray(schema.copyFilers.cik, [...watched]), or(isNull(schema.copyFilers.checkedAt), lt(schema.copyFilers.checkedAt, new Date(now.getTime() - 20 * 3_600_000))))).limit(6);
    // "Known" funds have stored filings; a fund with none is read for the first time, without alerts.
    const known = new Set((await db.selectDistinct({ cik: schema.copyFilings.cik }).from(schema.copyFilings).where(inArray(schema.copyFilings.cik, [...watched]))).map((r) => r.cik));
    for (const c of [...watched].filter((c) => !known.has(c)).slice(0, 4)) toSync.add(c);
    for (const s of stale) toSync.add(s.cik);

    const events: Record<string, unknown>[] = [];
    for (const cik of toSync) {
      if (Date.now() > deadline - 60_000) break;
      try {
        // A fund seen for the first time is read without alerts: its back catalogue is not news.
        const firstTime = !known.has(cik);
        const r = await syncFund(cik, { max: firstTime ? 8 : 3, deadline: deadline - 60_000 });
        if (firstTime || !r.added.length) continue;
        const rows = await db.select().from(schema.copyFilings).where(inArray(schema.copyFilings.accession, r.added));
        // Only filings from the last two weeks count as news (an old amendment discovered late is stored quietly).
        for (const f of rows.filter((x) => x.status === "ok" && Date.parse(`${x.filedOn}T00:00:00Z`) > now.getTime() - 14 * 86_400_000)) {
          events.push({ cik, accession: f.accession, ...(await onNewFiling(cik, { accession: f.accession, form: f.form, filedOn: f.filedOn, period: f.period, name: r.name })) });
        }
      } catch (e) { logError(e, { where: "copy-sync" }); }
    }
    report.synced = toSync.size;
    report.events = events;
    report.ordersRefreshed = await refreshOpenOrders(deadline - 30_000).catch((e) => describeFailure(e, 500, "copy-orders").message);

    // Once a quarter: the directory of every 13F filer from last quarter's full index.
    const { y: qy, q } = quarterOf(new Date(Date.parse(`${quarterEndOf(now.toISOString().slice(0, 10))}T00:00:00Z`) - 100 * 86_400_000));
    const qkey = `copy:full-index:${qy}q${q}`;
    if (Date.now() < deadline - 90_000 && !(await cacheGet(qkey))) {
      const all = await quarter13fFilers(qy, q, deadline - 60_000).catch(() => []);
      if (all.length > 1000) { report.directory = await noteFilers(all); await cacheSet(qkey, "1", 120 * 86_400_000); }
    }
    if (Math.random() < 0.05) await retryFailedFilings().catch(() => undefined);
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.copyFilers);
    report.filers = n;
  } finally {
    await release();
  }
  return report;
}
