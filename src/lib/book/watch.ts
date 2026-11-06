/**
 * The Book, always on: every weekday after the US close (src/app/api/cron/book) each person's book is
 * checked again, and what changed since the last check (src/lib/book/alerts.ts) goes to the bell and the
 * person's own alert channels (push, Slack, email) through the Newsroom's delivery, quiet hours included,
 * except for a broken thesis, which is urgent. No AI is used. Companies are shared through the company
 * cache, so a name held by many people is read once.
 */
import { sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { appOrigin } from "@/lib/edge/alerts";
import { logError } from "@/lib/errors";
import { deliverAlert } from "@/lib/news/alerts";
import { readerFor } from "@/lib/news/reader";
import { updateExtra } from "@/lib/prefs/extra";
import { alertsFor, normalizeBookState, type BookAlert } from "./alerts";
import { evaluateBook, loadBook, warmFilings, warmInsiders } from "./store";

/** Check one person's book and send what changed. Returns the alerts sent (not those already sent before). */
export async function watchBook(userId: string, now = new Date()): Promise<BookAlert[]> {
  const book = await loadBook(userId);
  if (!book.length) return [];
  const evals = await evaluateBook(book, now);
  let sent: BookAlert[] = [];
  await updateExtra(userId, (extra) => {
    const { alerts, next } = alertsFor(normalizeBookState(extra.bookState), evals, now);
    // Alerts off (the Book's switch): the verdicts and history still move on, so turning them back on
    // does not replay old changes.
    sent = extra.bookAlerts === false ? [] : alerts;
    return { ...extra, bookState: next };
  });
  if (!sent.length) return [];
  const db = requireDb();
  const ctx = await readerFor(userId).catch(() => null);
  const delivered: BookAlert[] = [];
  for (const a of sent) {
    // The key is unique per person: an alert already sent (a catalyst seen on two days, a filing on every
    // check while it is fresh) is not sent again, and is not counted.
    const [row] = await db.insert(schema.newsNotifications).values({ userId, key: a.key, kind: "alert", title: a.title.slice(0, 300), body: a.body.slice(0, 600), url: a.url, urgent: a.urgent })
      .onConflictDoNothing().returning({ id: schema.newsNotifications.id });
    if (!row) continue;
    delivered.push(a);
    if (!ctx?.prefs.alerts.enabled) continue;
    try { await deliverAlert(ctx, { key: a.key, title: a.title, body: a.body, url: a.url, urgent: a.urgent, reasons: a.reasons }, appOrigin()); }
    catch (e) { logError(e, { where: "book-alert-deliver" }); }
  }
  return delivered;
}

/** Everyone with a book, within the time given. */
export async function watchAllBooks(deadline: number): Promise<{ people: number; checked: number; alerts: number; failed: number; unfinished: number; insiders: number; filings: number }> {
  const rows = await requireDb().select({ userId: schema.profiles.userId }).from(schema.profiles)
    .where(sql`jsonb_typeof(${schema.profiles.extra}->'book') = 'array' and jsonb_array_length(${schema.profiles.extra}->'book') > 0`)
    // Least recently checked first: a run that hits its deadline leaves the rest for the next one, and nobody
    // is left at the back of the queue for good.
    .orderBy(sql`(${schema.profiles.extra}->'bookState'->>'checkedAt') asc nulls first`);
  let checked = 0, alerts = 0, failed = 0;
  // Insider selling first, for the names whose criteria use it (each fetched once, however many books hold it),
  // within a third of the time.
  const held = await requireDb().execute<{ tickers: unknown }>(sql`select coalesce(jsonb_agg(distinct p->>'ticker'), '[]'::jsonb) as tickers from ${schema.profiles}, jsonb_array_elements(case when jsonb_typeof(${schema.profiles.extra}->'book') = 'array' then ${schema.profiles.extra}->'book' else '[]'::jsonb end) p where exists (select 1 from jsonb_array_elements(coalesce(p->'criteria', '[]'::jsonb)) c where c->>'metric' = 'insider_selling')`);
  const tickers = Array.isArray(held.rows[0]?.tickers) ? (held.rows[0].tickers as unknown[]) : [];
  const insiders = await warmInsiders(tickers.filter((t): t is string => typeof t === "string").slice(0, 300), Date.now() + Math.max(0, deadline - Date.now()) / 3);
  // New 10-Qs and 10-Ks among everything held, within the next sixth of the time (a radar runs only on a new filing).
  const allHeld = await requireDb().execute<{ tickers: unknown }>(sql`select coalesce(jsonb_agg(distinct p->>'ticker'), '[]'::jsonb) as tickers from ${schema.profiles}, jsonb_array_elements(case when jsonb_typeof(${schema.profiles.extra}->'book') = 'array' then ${schema.profiles.extra}->'book' else '[]'::jsonb end) p`);
  const heldTickers = Array.isArray(allHeld.rows[0]?.tickers) ? (allHeld.rows[0].tickers as unknown[]).filter((t): t is string => typeof t === "string") : [];
  const filings = await warmFilings(heldTickers.slice(0, 500), Date.now() + Math.max(0, deadline - Date.now()) / 6);
  for (const { userId } of rows) {
    if (Date.now() > deadline) break;
    try { alerts += (await watchBook(userId)).length; checked++; }
    catch (e) { failed++; logError(e, { where: "book-watch" }); }
  }
  return { people: rows.length, checked, alerts, failed, unfinished: rows.length - checked - failed, insiders, filings };
}
