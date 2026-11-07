/**
 * Where the book lives (profiles.extra.book, at most 25 positions per person) and how it is checked on the
 * server: every position's thesis against its company's SEC record and price (src/lib/company.ts, cached
 * six hours for filings and a minute in memory), its next earnings date, cached insider-selling and
 * new-filing facts (./insiders-store.ts, ./filings-store.ts) and this week's Newsroom stories that name its
 * ticker. Also bulk adds, daily history points, team sharing, the alerts switch and positions proposed by
 * the person's AI apps (./proposals.ts). Saves go through the
 * profile row lock (src/lib/prefs/extra.ts), like every preference.
 */
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { getCompanyData } from "@/lib/company";
import { nasdaqEarningsDate, nasdaqEnabled } from "@/lib/market/nasdaq";
import { cachedInsiderFact, fetchInsiderFact } from "./insiders-store";
import { cachedFilingFact, noteNewFiling } from "./filings-store";
import { derive } from "@/lib/metrics";
import { updateExtra } from "@/lib/prefs/extra";
import { logError } from "@/lib/errors";
import { needsPoint, normalizeBookState, recordHistory, type BookHistory } from "./alerts";
import { normalizeProposals, withProposal, type Proposal } from "./proposals";
import type { Committee } from "./committee";
import { factsFrom, type FilingFact } from "./letter";
import { freshForecast, standing, supersede } from "./forecast";
import { catalystEntry, changesOf, goalpostEntry, recentVerdict, withEntries, type CatalystOutcome } from "./decisions";
import { catalystsDue } from "./discipline";
import { bookTodos } from "./todo";
import { healthLine, processHealth } from "./process";

import { calibrationOf, closedFrom, JOURNAL_MAX, normalizeJournal, type ClosedPosition, type CloseReason } from "./journal";
import type { RiskHeadline } from "./risk";
import { byUrgency, evaluate, normalizePosition, normalizeBook, POSITIONS_MAX, summarize, type Evaluation, type NextEarnings, type Position, type PositionNews } from "./position";

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
    // A red team and a committee are written by the server only; an edit keeps the ones it has.
    const prev = at >= 0 ? list[at] : null;
    // So are earlier forecasts: a changed or removed forecast stays scored (forecast.ts supersede).
    const { committee: _ignored, pastForecasts: _past, log: _log, ...posted } = t;
    void _ignored; void _past; void _log;
    const fresh = freshForecast(posted.conviction, prev?.conviction, now.slice(0, 10));
    if (fresh.error) throw Object.assign(new Error(fresh.error), { status: 400 });
    const { conviction: _posted, ...rest } = posted;
    void _posted;
    const past = supersede(prev?.pastForecasts, prev?.conviction, fresh.conviction, now.slice(0, 10));
    const next: Position = { ...rest, ...(fresh.conviction ? { conviction: fresh.conviction } : {}), createdAt: prev ? prev.createdAt : now, updatedAt: now, ...(prev?.redTeam ? { redTeam: prev.redTeam } : {}), ...(prev?.committee ? { committee: prev.committee } : {}), ...(past.length ? { pastForecasts: past } : {}) };
    // The decision journal: what this save changed, written by the server (decisions.ts), and the PM's note.
    const note = raw && typeof raw === "object" && typeof (raw as { note?: unknown }).note === "string" ? (raw as { note: string }).note : undefined;
    // A position added from an AI app's proposal: where it came from, and the app's reasoning in its own name,
    // read from the stored proposal (never from what the client sent), so it is never mistaken for the PM's note.
    const fromId = raw && typeof raw === "object" ? (raw as { fromProposal?: unknown }).fromProposal : undefined;
    const proposal = !prev && typeof fromId === "string" ? normalizeProposals(extra.bookProposals).find((x) => x.id === fromId) : undefined;
    const origin = proposal ? [`Proposed by ${proposal.from}${proposal.rationale ? `, whose reasoning was: "${proposal.rationale}"` : "."}`] : [];
    // Loosening a kill criterion while the thesis reads broken or on watch is recorded as such (decisions.ts).
    const goalposts = goalpostEntry(prev, next, prev ? recentVerdict(normalizeBookState(extra.bookState).history[prev.id]) : undefined);
    const log = withEntries(prev?.log, [...changesOf(prev, next), ...origin, ...(goalposts ? [goalposts] : [])], now, note);
    if (log.length) next.log = log;
    if (at < 0 && list.length >= POSITIONS_MAX) throw Object.assign(new Error(`The book holds ${POSITIONS_MAX} positions. Close one to add another.`), { status: 400 });
    if (at >= 0) list[at] = next; else list.unshift(next);
    saved = next;
    return { ...extra, book: list };
  });
  return saved;
}

export async function deletePosition(userId: string, id: string): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  await updateExtra(userId, (extra) => {
    const list = normalizeBook(extra.book);
    const p = list.find((t) => t.id === id);
    // A forecast already on the record is not erased: close the position instead, and it stays scored.
    if (p && standing(today, p.conviction, p.committee?.forecast, ...(p.pastForecasts ?? []))) throw Object.assign(new Error("This position carries a forecast already on the record. Close it instead, so the forecast stays scored."), { status: 409 });
    return { ...extra, book: list.filter((t) => t.id !== id) };
  });
}

/* ---------------- The track record: closed positions ---------------- */

/** Each position's daily verdict history (profiles.extra.bookState). */
export async function loadBookHistory(userId: string): Promise<BookHistory> {
  const [row] = await requireDb().select({ extra: schema.profiles.extra }).from(schema.profiles).where(eq(schema.profiles.userId, userId));
  return normalizeBookState((row?.extra as Record<string, unknown> | undefined)?.bookState).history;
}

export async function loadJournal(userId: string): Promise<ClosedPosition[]> {
  const [row] = await requireDb().select({ extra: schema.profiles.extra }).from(schema.profiles).where(eq(schema.profiles.userId, userId));
  return normalizeJournal((row?.extra as Record<string, unknown> | undefined)?.bookClosed);
}

/**
 * Close a position into the track record: it leaves the book and is kept, newest first, with its exit (the
 * price given, else the price now), the reason, its verdict and the first day its thesis broke. One write,
 * under the profile's row lock. Null when the position is not in the book.
 */
export async function closePosition(userId: string, id: string, opts: { exit: number | null; reason: CloseReason; note: string }, now = new Date()): Promise<ClosedPosition | null> {
  const book = await loadBook(userId);
  const p = book.find((x) => x.id === id);
  if (!p) return null;
  const [ev] = await evaluateBook([p], now).catch(() => [] as Evaluation[]);
  let closed: ClosedPosition | null = null;
  await updateExtra(userId, (extra) => {
    const list = normalizeBook(extra.book);
    const at = list.findIndex((x) => x.id === id);
    if (at < 0) return extra;
    const state = normalizeBookState(extra.bookState);
    closed = closedFrom(list[at], ev?.verdict ?? "unknown", state.history[id] ?? [], opts.exit ?? ev?.price ?? null, opts.reason, opts.note, now);
    return { ...extra, book: list.filter((x) => x.id !== id), bookClosed: [closed, ...normalizeJournal(extra.bookClosed).filter((x) => x.id !== id)].slice(0, JOURNAL_MAX) };
  });
  return closed;
}

/** A note in a position's decision journal, dated now. Null when the position is not in the book. */
export async function addNote(userId: string, id: string, text: string): Promise<Position | null> {
  let saved: Position | null = null;
  const now = new Date().toISOString();
  await updateExtra(userId, (extra) => ({
    ...extra,
    book: normalizeBook(extra.book).map((t) => {
      if (t.id !== id) return t;
      const p = normalizePosition({ ...t, log: withEntries(t.log, [], now, text) }) ?? t;
      saved = p;
      return p;
    }),
  }));
  return saved;
}

/**
 * Record whether a passed catalyst played out (decisions.ts catalystEntry), once per catalyst. Returns the
 * position, or a reason it could not be recorded.
 */
export async function reviewCatalyst(userId: string, id: string, catalystId: string, outcome: CatalystOutcome): Promise<{ position: Position } | { error: string; status: number }> {
  let out: { position: Position } | { error: string; status: number } = { error: "That position was not found.", status: 404 };
  const now = new Date();
  await updateExtra(userId, (extra) => ({
    ...extra,
    book: normalizeBook(extra.book).map((t) => {
      if (t.id !== id) return t;
      const c = t.catalysts.find((x) => x.id === catalystId);
      if (!c) { out = { error: "That catalyst is not on the position.", status: 404 }; return t; }
      if (!catalystsDue(t, now).some((x) => x.id === catalystId)) { out = { error: "That catalyst has not passed yet, or was already reviewed.", status: 400 }; return t; }
      const p = normalizePosition({ ...t, log: withEntries(t.log, [catalystEntry(c.label, c.date, outcome)], now.toISOString()) }) ?? t;
      out = { position: p };
      return p;
    }),
  }));
  return out;
}

/** Remove a record from the track record (one closed by mistake), unless it holds forecasts on the record. */
export async function deleteClosed(userId: string, id: string): Promise<void> {
  await updateExtra(userId, (extra) => {
    const list = normalizeJournal(extra.bookClosed);
    const c = list.find((x) => x.id === id);
    // A record whose forecasts were made before its close keeps them on the record.
    if (c && standing(c.closedAt.slice(0, 10), c.conviction, c.aiConviction, ...(c.pastForecasts ?? []).map((x) => x.f))) throw Object.assign(new Error("This record holds forecasts made before it closed; it stays in the track record so they stay scored."), { status: 409 });
    return { ...extra, bookClosed: list.filter((x) => x.id !== id) };
  });
}

/* ---------------- Proposals from the person's AI apps ---------------- */

export async function loadProposals(userId: string): Promise<Proposal[]> {
  const [row] = await requireDb().select({ extra: schema.profiles.extra }).from(schema.profiles).where(eq(schema.profiles.userId, userId));
  return normalizeProposals((row?.extra as Record<string, unknown> | undefined)?.bookProposals);
}

/** Keep a proposal for the person to review; it never touches the book itself. */
export async function addProposal(userId: string, p: Proposal): Promise<void> {
  await updateExtra(userId, (extra) => ({ ...extra, bookProposals: withProposal(normalizeProposals(extra.bookProposals), p) }));
}

/** A bell notification that an AI app proposed a position, unless the Book's alerts are off. One per proposal. */
export async function noteProposal(userId: string, p: Proposal): Promise<void> {
  if (!(await bookAlertsOn(userId).catch(() => true))) return;
  await requireDb().insert(schema.newsNotifications).values({
    userId, key: `book:proposal:${p.id}`, kind: "alert", urgent: false, url: `/app/book?proposal=${p.id}`,
    title: `${p.from} proposed ${p.position.direction} ${p.position.ticker}`.slice(0, 300),
    body: `${p.position.thesis}${p.rationale ? ` Why: ${p.rationale}` : ""} Nothing is in your book until you review it.`.slice(0, 600),
  }).onConflictDoNothing();
}

/** A proposal dismissed, or added (the editor saved it): gone from the list, and its bell notice marked read. */
export async function dismissProposal(userId: string, id: string): Promise<void> {
  await updateExtra(userId, (extra) => ({ ...extra, bookProposals: normalizeProposals(extra.bookProposals).filter((x) => x.id !== id) }));
  const n = schema.newsNotifications;
  await requireDb().update(n).set({ readAt: new Date() }).where(and(eq(n.userId, userId), eq(n.key, `book:proposal:${id}`))).catch(() => undefined);
}

/** The bell, when a sitting the person may have walked away from is done. */
export async function noteCommittee(userId: string, p: Position, c: Committee): Promise<void> {
  if (!(await bookAlertsOn(userId).catch(() => true))) return;
  await requireDb().insert(schema.newsNotifications).values({
    userId, key: `book:${p.id}:committee:${c.at}`, kind: "alert", urgent: false, url: `/app/book?position=${p.id}`,
    title: `${p.ticker}: the AI committee says ${c.decision}`.slice(0, 300),
    body: `${c.rationale}${c.forecast ? ` Its forecast: ${Math.round(c.forecast.p * 100)}% that no kill criterion fails by ${c.forecast.by}.` : ""} Advice only; nothing in your book changed.`.slice(0, 600),
  }).onConflictDoNothing();
}

export async function setCommittee(userId: string, id: string, committee: Committee): Promise<boolean> {
  const today = new Date().toISOString().slice(0, 10);
  let found = false;
  await updateExtra(userId, (extra) => ({
    ...extra,
    book: normalizeBook(extra.book).map((t) => {
      if (t.id !== id) return t;
      found = true;
      // The committee's last forecast stays scored when it sits again (forecast.ts supersede).
      const past = supersede(t.pastForecasts, t.committee?.forecast, committee.forecast, today);
      // The sitting goes into the decision journal too, so the record shows what the AI advised and when.
      const log = withEntries(t.log, [`AI committee: ${committee.decision}${committee.forecast ? `, ${Math.round(committee.forecast.p * 100)}% that no kill criterion fails by ${committee.forecast.by}` : ""}.`], committee.at);
      return normalizePosition({ ...t, committee, log, ...(past.length ? { pastForecasts: past } : {}) }) ?? t;
    }),
  }));
  return found;
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

/** A promise's value, or null once `ms` pass; the timer is cleared either way. */
function within<T>(p: Promise<T | null>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([p, new Promise<null>((r) => { timer = setTimeout(() => r(null), ms); })]).finally(() => clearTimeout(timer));
}

/** Every position's thesis checked, most urgent first. A company that cannot be read leaves it "unknown". */
/** Every holding's main percent metrics from its filings (revenue growth, gross, operating and FCF margin), for checking figures written about it. */
export async function holdingFacts(book: Position[], now = new Date()): Promise<FilingFact[]> {
  const PROBE = ["revenue_growth", "gross_margin", "operating_margin", "fcf_margin"] as const;
  const probe = book.map((p) => ({ ...p, criteria: PROBE.map((metric, k) => ({ id: `fact-${k}`, metric, op: ">=" as const, value: 0 })) }));
  return factsFrom(await evaluateBook(probe, now).catch(() => []));
}

export async function evaluateBook(book: Position[], now = new Date()): Promise<Evaluation[]> {
  const tickers = [...new Set(book.map((t) => t.ticker))];
  const companies = new Map<string, Awaited<ReturnType<typeof getCompanyData>>>();
  const earnings = new Map<string, NextEarnings>();
  const calendar = nasdaqEnabled();
  let i = 0;
  // Six at a time: a desk of 25 names does not open 25 SEC reads at once. The earnings date (the exchange's
  // calendar, cached six hours) is read beside the filings, waited for at most 2.5 s; without it a position
  // simply shows none.
  await Promise.all(Array.from({ length: Math.min(6, tickers.length) }, async () => {
    while (i < tickers.length) {
      const t = tickers[i++];
      const [c, e] = await Promise.all([getCompanyData(t).catch(() => null), calendar ? within(nasdaqEarningsDate(t).catch(() => null), 2500) : Promise.resolve(null)]);
      companies.set(t, c); earnings.set(t, e);
    }
  }));
  // Insider selling is read from its cache only (worked out in the daily check, or when such a position is saved).
  const insiderTickers = [...new Set(book.filter((p) => p.criteria.some((c) => c.metric === "insider_selling")).map((p) => p.ticker))];
  const insiders = new Map(await Promise.all(insiderTickers.map(async (t) => [t, await cachedInsiderFact(t)] as const)));
  const filings = new Map(await Promise.all(tickers.map(async (t) => [t, await cachedFilingFact(t)] as const)));
  const news = await newsFor(tickers);
  return book.map((t) => {
    const c = companies.get(t.ticker) ?? null;
    return evaluate(t, c, c ? derive(c) : null, news.get(t.ticker) ?? [], now, earnings.get(t.ticker) ?? null, insiders.get(t.ticker) ?? null, filings.get(t.ticker) ?? null);
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
      // A new position's journal starts here: anything posted with it is not kept.
      const opened = { ...p, log: withEntries([], changesOf(null, p), now) };
      list.push(opened); added.push(opened);
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

/* ---------------- Sharing with a team (read-only) ---------------- */

/** The teams a person shares their book with (profiles.extra.bookShare), cleaned. */
export const sharesOf = (extra: Record<string, unknown> | null | undefined): number[] => {
  const raw = (extra?.bookShare as { teams?: unknown } | undefined)?.teams;
  return Array.isArray(raw) ? [...new Set(raw.filter((x): x is number => Number.isInteger(x) && x > 0))].slice(0, 20) : [];
};

/** Share the book with a team, or stop. Membership is checked by the caller. */
export async function setBookShare(userId: string, teamId: number, on: boolean): Promise<number[]> {
  let teams: number[] = [];
  await updateExtra(userId, (extra) => {
    const cur = sharesOf(extra);
    teams = on ? [...new Set([...cur, teamId])] : cur.filter((t) => t !== teamId);
    return { ...extra, bookShare: { teams } };
  });
  return teams;
}

export type TeamBookMember = {
  userId: string; name: string; email: string; positions: number; summary: ReturnType<typeof summarize>;
  /** Positions with something on the member's Needs you list (todo.ts), and their process health in one line (process.ts). */
  needs: number; health: string;
};
export type TeamEvaluation = Evaluation & { owner: string; ownerName: string; thesis: string; redTeam?: Position["redTeam"]; committee?: Position["committee"]; conviction?: Position["conviction"]; log?: Position["log"] };
export type Conflict = { ticker: string; long: string[]; short: string[] };

/**
 * A team's books, as its members chose to share them: every position checked (companies are shared
 * through the cache, so a name held by three people is read once), each with its owner; per-member
 * exposure; and names held long by one member and short by another.
 */
export async function teamBook(teamId: number, members: { userId: string; name: string; email: string }[], now = new Date()) {
  if (!members.length) return { members: [] as TeamBookMember[], evaluations: [] as TeamEvaluation[], conflicts: [] as Conflict[] };
  const rows = await requireDb().select({ userId: schema.profiles.userId, extra: schema.profiles.extra }).from(schema.profiles)
    .where(sql`${schema.profiles.userId} in (${sql.join(members.map((m) => sql`${m.userId}`), sql`, `)})`);
  const out: TeamBookMember[] = [];
  const evaluations: TeamEvaluation[] = [];
  for (const r of rows) {
    const extra = (r.extra ?? {}) as Record<string, unknown>;
    if (!sharesOf(extra).includes(teamId)) continue;
    const m = members.find((x) => x.userId === r.userId)!;
    const book = normalizeBook(extra.book);
    const evals = await evaluateBook(book, now);
    const history = normalizeBookState(extra.bookState).history;
    out.push({
      userId: m.userId, name: m.name || m.email, email: m.email, positions: book.length, summary: summarize(evals),
      needs: new Set(bookTodos(book, history, now).map((x) => x.positionId)).size,
      // From what the member shares (open positions); their closed record and its calibration stay theirs.
      health: healthLine(processHealth({ open: book, closed: [], history, calibration: calibrationOf(book, history, [], now), now })),
    });
    for (const e of evals) {
      const p = book.find((x) => x.id === e.positionId);
      evaluations.push({ ...e, owner: m.userId, ownerName: m.name || m.email, thesis: p?.thesis ?? "", ...(p?.redTeam ? { redTeam: p.redTeam } : {}), ...(p?.committee ? { committee: p.committee } : {}), ...(p?.conviction ? { conviction: p.conviction } : {}), ...(p?.log?.length ? { log: p.log } : {}) });
    }
  }
  const byTicker = new Map<string, { long: string[]; short: string[] }>();
  for (const e of evaluations) {
    const t = byTicker.get(e.ticker) ?? { long: [], short: [] };
    t[e.direction].push(e.ownerName);
    byTicker.set(e.ticker, t);
  }
  const conflicts = [...byTicker.entries()].filter(([, v]) => v.long.length && v.short.length).map(([ticker, v]) => ({ ticker, ...v }));
  return { members: out, evaluations: evaluations.sort(byUrgency), conflicts };
}

/**
 * Each sharing member's own risk headline (beta-adjusted net, one-day VaR, worst replay), side by side. Not
 * added up: each member's weights are a share of their own book, so a sum would mean nothing. Cached per
 * book and day like the Book's own risk panel.
 */
export async function teamRisk(teamId: number, members: { userId: string }[], now = new Date()): Promise<Record<string, RiskHeadline>> {
  if (!members.length) return {};
  const [{ riskOf }, { headline }] = await Promise.all([import("./risk-store"), import("./risk")]);
  const rows = await requireDb().select({ userId: schema.profiles.userId, extra: schema.profiles.extra }).from(schema.profiles)
    .where(sql`${schema.profiles.userId} in (${sql.join(members.map((m) => sql`${m.userId}`), sql`, `)})`);
  const books = rows.flatMap((r) => {
    const extra = (r.extra ?? {}) as Record<string, unknown>;
    const book = sharesOf(extra).includes(teamId) ? normalizeBook(extra.book) : [];
    return book.some((p) => p.weight) ? [{ userId: r.userId, book }] : [];
  });
  // Four at a time (each may fetch a year of prices the first time today), and none past 80 s, inside the route's two minutes.
  const out: Record<string, RiskHeadline> = {};
  const stop = Date.now() + 80_000;
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(4, books.length) }, async () => {
    while (i < books.length) {
      const b = books[i++];
      if (Date.now() > stop) continue;
      const risk = await riskOf(b.book, now).catch(() => null);
      if (risk) out[b.userId] = headline(risk);
    }
  }));
  return out;
}

/** Whether the daily check sends alerts (profiles.extra.bookAlerts; on unless turned off). */
export async function bookAlertsOn(userId: string): Promise<boolean> {
  const [row] = await requireDb().select({ extra: schema.profiles.extra }).from(schema.profiles).where(eq(schema.profiles.userId, userId));
  return (row?.extra as Record<string, unknown> | undefined)?.bookAlerts !== false;
}

export async function setBookAlerts(userId: string, on: boolean): Promise<boolean> {
  await updateExtra(userId, (extra) => ({ ...extra, bookAlerts: on }));
  return on;
}

/** Work out insider selling for these tickers now (EDGAR), within the time given; each is cached 30 hours. */
export async function warmInsiders(tickers: string[], deadline: number): Promise<number> {
  let done = 0;
  for (const t of tickers) {
    if (Date.now() > deadline) break;
    const c = await getCompanyData(t).catch(() => null);
    if (!c?.cik) continue;
    await fetchInsiderFact(t, c.cik).then(() => { done++; }, (e) => logError(e, { where: "book-insiders" }));
  }
  return done;
}

/** Look for new 10-Qs and 10-Ks among these tickers, within the time given (src/lib/book/filings.ts). */
/** Read each held name's new periodic filing, if any; returns how many were read on this run. */
export async function warmFilings(tickers: string[], deadline: number): Promise<number> {
  let fresh = 0;
  for (const t of tickers) {
    if (Date.now() > deadline) break;
    const c = await getCompanyData(t).catch(() => null);
    if (!c) continue;
    await noteNewFiling(t, c).then((f) => { if (f) fresh++; }, (e) => logError(e, { where: "book-filings" }));
  }
  return fresh;
}
