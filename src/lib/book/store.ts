/**
 * Where the book lives (profiles.extra.book, at most 25 positions per person) and how it is checked on the
 * server: every position's thesis against its company's SEC record and price (src/lib/company.ts, cached
 * six hours for filings and a minute in memory) and this week's Newsroom stories that name its ticker.
 * Saves go through the profile row lock (src/lib/prefs/extra.ts), like every preference.
 */
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { getCompanyData } from "@/lib/company";
import { derive } from "@/lib/metrics";
import { updateExtra } from "@/lib/prefs/extra";
import { needsPoint, normalizeBookState, recordHistory, type BookHistory } from "./alerts";
import { byUrgency, evaluate, normalizePosition, normalizeBook, POSITIONS_MAX, type Evaluation, type Position, type PositionNews } from "./position";

export async function loadBook(userId: string): Promise<Position[]> {
  const [row] = await requireDb().select({ extra: schema.profiles.extra }).from(schema.profiles).where(eq(schema.profiles.userId, userId));
  return normalizeBook((row?.extra as Record<string, unknown> | undefined)?.book);
}

/** Add or replace a position (by id). Returns it as stored, or null when it is not valid. */
export async function savePosition(userId: string, raw: unknown): Promise<Position | null> {
  const now = new Date().toISOString();
  const t = normalizePosition(raw, now);
  if (!t) return null;
  let saved: Position | null = null;
  await updateExtra(userId, (extra) => {
    const list = normalizeBook(extra.book);
    const at = list.findIndex((x) => x.id === t.id);
    // A red team is written by the server only; an edit keeps the one it has.
    const next: Position = { ...t, createdAt: at >= 0 ? list[at].createdAt : now, updatedAt: now, ...(at >= 0 && list[at].redTeam ? { redTeam: list[at].redTeam } : {}) };
    if (at < 0 && list.length >= POSITIONS_MAX) throw Object.assign(new Error(`The book holds ${POSITIONS_MAX} positions. Close one to add another.`), { status: 400 });
    if (at >= 0) list[at] = next; else list.unshift(next);
    saved = next;
    return { ...extra, book: list };
  });
  return saved;
}

export async function deletePosition(userId: string, id: string): Promise<void> {
  await updateExtra(userId, (extra) => ({ ...extra, book: normalizeBook(extra.book).filter((t) => t.id !== id) }));
}

export async function setRedTeam(userId: string, id: string, redTeam: NonNullable<Position["redTeam"]>): Promise<void> {
  await updateExtra(userId, (extra) => ({ ...extra, book: normalizeBook(extra.book).map((t) => (t.id === id ? normalizePosition({ ...t, redTeam }) ?? t : t)) }));
}

/** The last week's Newsroom stories naming any of these tickers, most important first, five per ticker. */
export async function newsFor(tickers: string[]): Promise<Map<string, PositionNews[]>> {
  const out = new Map<string, PositionNews[]>();
  if (!tickers.length) return out;
  const c = schema.newsClusters;
  const rows = await requireDb().select({ id: c.id, headline: c.headline, at: c.firstSeenAt, tickers: c.tickers }).from(c)
    .where(and(gte(c.firstSeenAt, new Date(Date.now() - 7 * 86_400_000)), sql`(${sql.join(tickers.map((t) => sql`${c.tickers} @> ${JSON.stringify([t])}::jsonb`), sql` or `)})`))
    .orderBy(desc(c.importance)).limit(200).catch(() => []);
  for (const r of rows) for (const t of r.tickers) {
    if (!tickers.includes(t)) continue;
    const list = out.get(t) ?? [];
    if (list.length < 5) list.push({ id: r.id, headline: r.headline, at: r.at.toISOString() });
    out.set(t, list);
  }
  return out;
}

/** Every position's thesis checked, most urgent first. A company that cannot be read leaves it "unknown". */
export async function evaluateBook(book: Position[], now = new Date()): Promise<Evaluation[]> {
  const tickers = [...new Set(book.map((t) => t.ticker))];
  const companies = new Map<string, Awaited<ReturnType<typeof getCompanyData>>>();
  let i = 0;
  // Six at a time: a desk of 25 names does not open 25 SEC reads at once.
  await Promise.all(Array.from({ length: Math.min(6, tickers.length) }, async () => {
    while (i < tickers.length) { const t = tickers[i++]; companies.set(t, await getCompanyData(t).catch(() => null)); }
  }));
  const news = await newsFor(tickers);
  return book.map((t) => {
    const c = companies.get(t.ticker) ?? null;
    return evaluate(t, c, c ? derive(c) : null, news.get(t.ticker) ?? [], now);
  }).sort(byUrgency);
}

/**
 * Add several positions at once (an import, or the sample book). A ticker already in the book is skipped,
 * not overwritten; what does not fit under POSITIONS_MAX is reported. Returns what was added and skipped.
 */
export async function addPositions(userId: string, raws: unknown[]): Promise<{ added: Position[]; skipped: string[] }> {
  const now = new Date().toISOString();
  const added: Position[] = [], skipped: string[] = [];
  await updateExtra(userId, (extra) => {
    const list = normalizeBook(extra.book);
    for (const raw of raws) {
      const p = normalizePosition({ ...(raw as object), id: undefined }, now);
      if (!p) continue;
      if (list.some((x) => x.ticker === p.ticker)) { skipped.push(`${p.ticker} is already in the book`); continue; }
      if (list.length >= POSITIONS_MAX) { skipped.push(`${p.ticker}: the book holds ${POSITIONS_MAX} positions`); continue; }
      list.push(p); added.push(p);
    }
    return { ...extra, book: list };
  });
  return { added, skipped };
}

/** The day's history point for each position, written on the first read of the day that lacks one. */
export async function noteHistory(userId: string, evals: Evaluation[], now = new Date()): Promise<BookHistory> {
  const [row] = await requireDb().select({ extra: schema.profiles.extra }).from(schema.profiles).where(eq(schema.profiles.userId, userId));
  const state = normalizeBookState((row?.extra as Record<string, unknown> | undefined)?.bookState);
  if (!needsPoint(state.history, evals, now)) return state.history;
  let history = state.history;
  await updateExtra(userId, (extra) => {
    const cur = normalizeBookState(extra.bookState);
    history = recordHistory(cur.history, evals, now);
    return { ...extra, bookState: { ...cur, history } };
  });
  return history;
}
