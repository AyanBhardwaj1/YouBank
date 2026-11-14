/**
 * Watches and forecasts, stored (migration 0037). Server only.
 *
 * - A watch alerts the person when a market's price moves `threshold` points from the price last alerted
 *   on (./watch-rules.ts moveAlert), through the same path as the Book's alerts: a row in the bell
 *   (news_notifications, unique per person and key, so nothing is sent twice) and the person's own channels
 *   (push, Slack, email) with their quiet hours (src/lib/news/alerts.ts deliverAlert).
 * - A forecast is resolved when its market resolves, and scored with the Brier score beside the market's
 *   own price at the time it was made.
 * The pass (predictPass) runs from /api/predict/cron and from the quant nightly. Free work only: public
 * venue data, no AI.
 */
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { canUse } from "@/lib/billing/entitlements";
import { calibration, calibrationLine, type Calibration } from "@/lib/book/forecast";
import { logError } from "@/lib/errors";
import { deliverAlert } from "@/lib/news/alerts";
import { readerFor } from "@/lib/news/reader";
import { siteUrl } from "@/lib/site";
import { marketLabel } from "./normalize";
import { loadMarkets, marketByKey } from "./store";
import { VENUE_LABEL, type Market, type Venue } from "./types";
import { alertText, asForecastItems, brier, DEFAULT_THRESHOLD, forecastRefusal, moveAlert, normalizeForecastP, normalizeThreshold, WATCHES_FREE, WATCHES_PRO, type StoredForecast } from "./watch-rules";

type WatchRow = typeof schema.predictWatches.$inferSelect;
type ForecastRow = typeof schema.predictForecasts.$inferSelect;
const refuse = (message: string, status = 400) => Object.assign(new Error(message), { status });

export type Watch = { key: string; title: string; venue: Venue; url: string; threshold: number; baseProb: number | null; lastProb: number | null; checkedAt: string | null; alertedAt: string | null };
const toWatch = (r: WatchRow): Watch => ({ key: r.marketKey, title: r.title, venue: r.venue as Venue, url: r.url, threshold: r.threshold, baseProb: r.baseProb, lastProb: r.lastProb, checkedAt: r.checkedAt?.toISOString() ?? null, alertedAt: r.alertedAt?.toISOString() ?? null });

export async function listWatches(userId: string): Promise<Watch[]> {
  const rows = await requireDb().select().from(schema.predictWatches).where(eq(schema.predictWatches.userId, userId)).orderBy(desc(schema.predictWatches.createdAt)).limit(WATCHES_PRO);
  return rows.map(toWatch);
}

/** Watch a market (or change its threshold). Free plans hold WATCHES_FREE watches; predict.watch-pro holds WATCHES_PRO. */
export async function addWatch(user: { id: string; email: string }, m: Market, threshold: unknown = DEFAULT_THRESHOLD): Promise<Watch> {
  const db = requireDb();
  const t = normalizeThreshold(threshold);
  const [existing] = await db.select().from(schema.predictWatches).where(and(eq(schema.predictWatches.userId, user.id), eq(schema.predictWatches.marketKey, m.key)));
  if (existing) {
    const [row] = await db.update(schema.predictWatches).set({ threshold: t }).where(eq(schema.predictWatches.id, existing.id)).returning();
    return toWatch(row);
  }
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.predictWatches).where(eq(schema.predictWatches.userId, user.id));
  const cap = (await canUse(user, "predict.watch-pro").catch(() => false)) ? WATCHES_PRO : WATCHES_FREE;
  if (Number(n) >= cap) throw refuse(cap === WATCHES_FREE ? `You are watching ${WATCHES_FREE} markets, the most on your plan. Stop watching one, or upgrade in Settings, under Plan, to watch up to ${WATCHES_PRO}.` : `You are watching ${WATCHES_PRO} markets, the most there is. Stop watching one first.`, 403);
  if (m.status !== "open") throw refuse("This market is no longer open, so there is nothing to watch.");
  const [row] = await db.insert(schema.predictWatches).values({
    userId: user.id, marketKey: m.key, eventId: m.eventId.slice(0, 120), venue: m.venue, title: marketLabel(m).slice(0, 300), url: m.url.slice(0, 500),
    threshold: t, baseProb: m.prob, lastProb: m.prob, checkedAt: new Date(),
  }).onConflictDoNothing().returning();
  if (!row) return addWatch(user, m, t);
  return toWatch(row);
}

export async function removeWatch(userId: string, key: string): Promise<void> {
  await requireDb().delete(schema.predictWatches).where(and(eq(schema.predictWatches.userId, userId), eq(schema.predictWatches.marketKey, key)));
}

/* ---------------- Forecasts ---------------- */

const toStored = (r: ForecastRow): StoredForecast & { url: string; brier: number | null; marketBrier: number | null; closeTime: string | null } => ({
  id: r.id, marketKey: r.marketKey, title: r.title, venue: r.venue, url: r.url, p: r.p, marketP: r.marketP, day: String(r.day), outcome: r.outcome,
  resolvedAt: r.resolvedAt?.toISOString() ?? null, brier: r.brier, marketBrier: r.marketBrier, closeTime: r.closeTime?.toISOString() ?? null,
});
export type ForecastView = ReturnType<typeof toStored>;

/** The person's forecasts, newest first, and their calibration against the market's (src/lib/book/forecast.ts). */
export async function listForecasts(userId: string): Promise<{ forecasts: ForecastView[]; calibration: Calibration; line: string }> {
  const rows = await requireDb().select().from(schema.predictForecasts).where(eq(schema.predictForecasts.userId, userId)).orderBy(desc(schema.predictForecasts.createdAt)).limit(500);
  const forecasts = rows.map(toStored);
  const cal = calibration(asForecastItems(forecasts));
  const mine = calibration(asForecastItems(forecasts).filter((x) => x.source === "You"));
  return { forecasts, calibration: cal, line: mine.n || mine.open ? calibrationLine(mine).replace("give a position a conviction and a date", "record your probability on a market") : "No forecasts yet: record your own probability on any market." };
}

const today = () => new Date().toISOString().slice(0, 10);

/** Record a forecast: one per market a day (a second the same day replaces the first; earlier days stay and are scored). */
export async function addForecast(userId: string, m: Market, rawP: unknown): Promise<ForecastView> {
  const p = normalizeForecastP(rawP);
  if (p === null) throw refuse("Enter a probability from 1% to 99%.");
  const no = forecastRefusal(m);
  if (no) throw refuse(no);
  const db = requireDb();
  const values = { userId, marketKey: m.key, eventId: m.eventId.slice(0, 120), venue: m.venue, title: marketLabel(m).slice(0, 300), url: m.url.slice(0, 500), p, marketP: m.prob, day: today(), closeTime: m.closeTime ? new Date(m.closeTime) : null };
  const [row] = await db.insert(schema.predictForecasts).values(values)
    .onConflictDoUpdate({ target: [schema.predictForecasts.userId, schema.predictForecasts.marketKey, schema.predictForecasts.day], set: { p, marketP: m.prob } }).returning();
  return toStored(row);
}

/** Delete a forecast, only on the day it was made: after that it stays and is scored, so a forecast going wrong cannot be withdrawn. */
export async function deleteForecast(userId: string, id: number): Promise<void> {
  const db = requireDb();
  const [row] = await db.select().from(schema.predictForecasts).where(and(eq(schema.predictForecasts.id, id), eq(schema.predictForecasts.userId, userId)));
  if (!row) throw refuse("That forecast was not found.", 404);
  if (String(row.day) !== today()) throw refuse("A forecast can be removed only on the day you made it. It stays on your record and is scored when the market resolves.");
  await db.delete(schema.predictForecasts).where(eq(schema.predictForecasts.id, id));
}

/** Score open forecasts whose markets have resolved (all of one person's, or everyone's within the time given). */
export async function resolveForecasts(deadline: number, userId?: string, markets?: Market[]): Promise<{ checked: number; resolved: number }> {
  const db = requireDb();
  const rows = await db.select().from(schema.predictForecasts)
    // Every open forecast, soonest close first: markets can resolve before their close (Kalshi's close early on the
    // event), and a market still open in the lists costs nothing to skip.
    .where(and(isNull(schema.predictForecasts.resolvedAt), userId ? eq(schema.predictForecasts.userId, userId) : sql`true`))
    .orderBy(sql`${schema.predictForecasts.closeTime} asc nulls last`).limit(userId ? 200 : 2_000);
  const byKey = new Map<string, ForecastRow[]>();
  for (const r of rows) byKey.set(r.marketKey, [...(byKey.get(r.marketKey) ?? []), r]);
  const listed = new Map((markets ?? []).map((m) => [m.key, m]));
  let checked = 0, resolved = 0;
  for (const [key, rs] of byKey) {
    if (Date.now() > deadline) break;
    checked++;
    // A market still open in the lists has not resolved; one gone from them is read on its own.
    const inList = listed.get(key);
    const m = inList && inList.status === "open" ? inList : await marketByKey(key, { eventId: rs[0].eventId, fresh: true });
    if (!m || m.status !== "resolved" || !m.result) continue;
    const outcome = m.result === "yes" ? 1 : 0;
    for (const r of rs) {
      await db.update(schema.predictForecasts).set({ outcome, brier: brier(r.p, outcome), marketBrier: r.marketP === null ? null : brier(r.marketP, outcome), resolvedAt: new Date() }).where(eq(schema.predictForecasts.id, r.id));
      resolved++;
    }
  }
  return { checked, resolved };
}

/* ---------------- The pass ---------------- */

/** Check every watch (least recently checked first) and send what moved, then score resolved forecasts. */
export async function predictPass(deadline: number): Promise<{ watches: number; markets: number; alerts: number; failed: number; forecasts: { checked: number; resolved: number } }> {
  const db = requireDb();
  const { markets } = await loadMarkets();
  const listed = new Map(markets.map((m) => [m.key, m]));
  // A watch whose market resolved has said so once; it stays listed for the person but is not checked again.
  const rows = await db.select().from(schema.predictWatches).where(eq(schema.predictWatches.resolvedSent, false)).orderBy(sql`${schema.predictWatches.checkedAt} asc nulls first`).limit(5_000);
  const byKey = new Map<string, WatchRow[]>();
  for (const r of rows) byKey.set(r.marketKey, [...(byKey.get(r.marketKey) ?? []), r]);
  let alerts = 0, failed = 0, seen = 0;
  const readers = new Map<string, Awaited<ReturnType<typeof readerFor>>>();
  for (const [key, ws] of byKey) {
    if (Date.now() > deadline - 20_000) break;
    seen++;
    const m = listed.get(key) ?? (await marketByKey(key, { eventId: ws[0].eventId, fresh: true }));
    if (!m) continue;
    for (const w of ws) {
      try {
        const d = moveAlert({ threshold: w.threshold, baseProb: w.baseProb, resolvedSent: w.resolvedSent }, m);
        await db.update(schema.predictWatches).set({ lastProb: m.prob, baseProb: d.nextBase, checkedAt: new Date(), ...(d.fire ? { alertedAt: new Date() } : {}), ...(d.kind === "resolved" ? { resolvedSent: true } : {}) }).where(eq(schema.predictWatches.id, w.id));
        if (!d.fire) continue;
        const { title, body } = alertText(w.title, VENUE_LABEL[m.venue], d, m.prob, m.result);
        const url = `/app/predict?market=${encodeURIComponent(key)}`;
        const alertKey = `predict:${w.id}:${d.kind}:${d.kind === "resolved" ? m.result : Math.round((m.prob ?? 0) * 1000)}:${new Date().toISOString().slice(0, 13)}`;
        const [row] = await db.insert(schema.newsNotifications).values({ userId: w.userId, key: alertKey, kind: "alert", title: title.slice(0, 300), body: body.slice(0, 600), url, urgent: false })
          .onConflictDoNothing().returning({ id: schema.newsNotifications.id });
        if (!row) continue;
        alerts++;
        if (!readers.has(w.userId)) readers.set(w.userId, await readerFor(w.userId).catch(() => null));
        const ctx = readers.get(w.userId);
        if (!ctx?.prefs.alerts.enabled) continue;
        try { await deliverAlert(ctx, { key: alertKey, title, body, url, urgent: false, reasons: ["A market you watch"] }, siteUrl()); }
        catch (e) { logError(e, { where: "predict-alert-deliver" }); }
      } catch (e) { failed++; logError(e, { where: "predict-watch" }); }
    }
  }
  const forecasts = Date.now() < deadline - 10_000 ? await resolveForecasts(deadline - 5_000, undefined, markets).catch((e) => { logError(e, { where: "predict-resolve" }); return { checked: 0, resolved: 0 }; }) : { checked: 0, resolved: 0 };
  return { watches: rows.length, markets: seen, alerts, failed, forecasts };
}

/** Which of these markets the person watches. */
export async function watchedKeys(userId: string, keys: string[]): Promise<Set<string>> {
  if (!keys.length) return new Set();
  const rows = await requireDb().select({ k: schema.predictWatches.marketKey }).from(schema.predictWatches).where(and(eq(schema.predictWatches.userId, userId), inArray(schema.predictWatches.marketKey, keys.slice(0, 500))));
  return new Set(rows.map((r) => r.k));
}
