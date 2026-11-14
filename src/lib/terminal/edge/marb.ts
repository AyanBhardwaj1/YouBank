/**
 * MARB: the merger-arbitrage monitor. Every pending takeover Edge knows of: the deals database (terms
 * quoted from the merger filings and checked: price per share, exchange ratio, consideration, approvals,
 * second request) and the Newsroom's deal tracker for deals not read yet. For each: the target's and the
 * acquirer's prices now, the offer's value (a stock leg marked at the acquirer's price), the gross spread,
 * the spread annualised to the expected close, the odds the price implies between the unaffected price and
 * the offer, Edge's deal-watch flags on either party, and prediction markets on the deal or its regulator.
 * Each source fails on its own: no prices leaves the terms, no markets leaves the rest. Server only.
 */
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { closes, quotes, type LiveQuote } from "@/lib/market/data";
import { tickerMap } from "@/lib/edgar/tickers";
import { loadMarkets } from "@/lib/predict/store";
import { VENUE_LABEL, type Market } from "@/lib/predict/types";
import { stageOf } from "@/lib/edge/dealimpact";
import { cashLeg, expectedClose, marketMatchesDeal, spreadHistory, spreadRow, type CloseEstimate, type Consideration, type SpreadRow, type Terms } from "../edge-math";
import { attempt, newest, stateOf, type SourceState } from "./common";
import type { Severity } from "../edge-signals";

const DAY = 86_400_000;
const TAKEOVERS = ["acquisition", "merger", "take_private", "tender"];
/** At most this many deals on the monitor (newest first). */
const MAX_ROWS = 120;
const TERM_FIELDS = ["per_share", "exchange_ratio", "consideration", "cvr", "approvals", "second_request", "premium_unaffected", "sign_date"];

export type MarbFlag = { id: number; title: string; side: string; severity: Severity; at: string };
export type MarbMarket = { key: string; venue: string; label: string; prob: number; change24h: number | null; url: string; closeTime: string | null };
export type MarbRow = {
  key: string; dealId: number | null; stage: "signed" | "reported";
  target: string; targetTicker: string; acquirer: string; acquirerTicker: string; kind: string; consideration: Consideration; buyerType: string;
  announced: string | null; sizeUsdMm: number | null;
  terms: Terms & { cvr: string | null; source: "deal database" | "news" | null };
  px: { target: number | null; targetChg: number | null; acquirer: number | null; acquirerChg: number | null; asOf: string | null; source: string | null };
  unaffected: number | null; premium: number | null;
  close: CloseEstimate; spread: SpreadRow;
  approvals: string[]; secondRequest: boolean;
  flags: MarbFlag[]; markets: MarbMarket[];
  url: string; headline: string;
};
export type MarbView = { rows: MarbRow[]; sources: SourceState[]; asOf: string; counts: { deals: number; priced: number; withTerms: number; flagged: number; markets: number } };

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const iso = (d: Date | string | null | undefined) => (d ? (typeof d === "string" ? d.slice(0, 10) : d.toISOString().slice(0, 10)) : null);
const consOf = (v: unknown): Consideration => (v === "cash" || v === "stock" || v === "mixed" ? v : "");

/** The deals database's announced deals of the last 18 months, with their news story's tickers when linked. */
async function dbDeals() {
  const since = new Date(Date.now() - 548 * DAY).toISOString().slice(0, 10);
  const db = requireDb();
  const deals = await db.select({
    id: schema.edgeDeals.id, kind: schema.edgeDeals.kind, announcedAt: schema.edgeDeals.announcedAt, signedAt: schema.edgeDeals.signedAt,
    targetName: schema.edgeDeals.targetName, acquirerName: schema.edgeDeals.acquirerName, targetTicker: schema.edgeDeals.targetTicker, acquirerCik: schema.edgeDeals.acquirerCik,
    buyerType: schema.edgeDeals.buyerType, consideration: schema.edgeDeals.consideration, equityUsdMm: schema.edgeDeals.equityUsdMm, premiumUnaffected: schema.edgeDeals.premiumUnaffected,
    sources: schema.edgeDeals.sources, newsAcq: schema.newsDeals.acquirerTicker, newsTarget: schema.newsDeals.targetTicker, newsUrl: schema.newsDeals.sourceUrl,
  }).from(schema.edgeDeals).leftJoin(schema.newsDeals, eq(schema.newsDeals.clusterId, schema.edgeDeals.newsClusterId))
    .where(and(sql`${schema.edgeDeals.ownerId} is null`, eq(schema.edgeDeals.status, "announced"), gte(schema.edgeDeals.announcedAt, since)))
    .orderBy(desc(schema.edgeDeals.announcedAt)).limit(150);
  const fields = deals.length ? await db.select({ dealId: schema.edgeDealFields.dealId, field: schema.edgeDealFields.field, value: schema.edgeDealFields.value })
    .from(schema.edgeDealFields).where(and(inArray(schema.edgeDealFields.dealId, deals.map((d) => d.id)), eq(schema.edgeDealFields.active, true), inArray(schema.edgeDealFields.field, TERM_FIELDS))) : [];
  const by = new Map<number, Record<string, unknown>>();
  for (const f of fields) { const m = by.get(f.dealId) ?? {}; m[f.field] = f.value; by.set(f.dealId, m); }
  return deals.map((d) => ({ ...d, fields: by.get(d.id) ?? {} }));
}

/** The Newsroom's takeovers of the last nine months, less targets the deals database shows completed or terminated. */
async function newsDeals() {
  const db = requireDb();
  const [rows, done] = await Promise.all([
    db.select({ d: schema.newsDeals, headline: schema.newsClusters.headline }).from(schema.newsDeals).innerJoin(schema.newsClusters, eq(schema.newsClusters.id, schema.newsDeals.clusterId))
      .where(and(gte(schema.newsDeals.announcedAt, new Date(Date.now() - 270 * DAY)), inArray(schema.newsDeals.kind, TAKEOVERS), eq(schema.newsDeals.status, "announced"))).orderBy(desc(schema.newsDeals.announcedAt)).limit(200),
    db.select({ t: schema.edgeDeals.targetTicker }).from(schema.edgeDeals).where(sql`${schema.edgeDeals.status} in ('completed', 'terminated') and ${schema.edgeDeals.targetTicker} <> ''`),
  ]);
  const finished = new Set(done.map((r) => r.t));
  return rows.filter((r) => r.d.targetTicker && !finished.has(r.d.targetTicker));
}

/** CIK → ticker from SEC's ticker file (for acquirers the deals database knows only by CIK). Empty when SEC does not answer. */
async function cikTickers(ciks: string[]): Promise<Map<string, string>> {
  const want = new Set(ciks.filter(Boolean).map((c) => c.padStart(10, "0")));
  const out = new Map<string, string>();
  if (!want.size) return out;
  for (const r of (await tickerMap()).values()) if (want.has(r.cik) && !out.has(r.cik)) out.set(r.cik, r.ticker);
  return out;
}

/** Deal-watch cards (the last 120 days) by ticker. */
async function flagsByTicker(tickers: string[]): Promise<Map<string, MarbFlag[]>> {
  const out = new Map<string, MarbFlag[]>();
  if (!tickers.length) return out;
  const rows = await requireDb().select({ id: schema.edgeDetections.id, title: schema.edgeDetections.title, tickers: schema.edgeDetections.tickers, side: sql<string>`${schema.edgeDetections.visual}->>'side'`, ticker: sql<string>`${schema.edgeDetections.visual}->>'ticker'`, severity: sql<string>`${schema.edgeDetections.visual}->>'severity'`, at: schema.edgeDetections.detectedAt })
    .from(schema.edgeDetections).where(sql`${schema.edgeDetections.kind} = 'deal_impact' and ${schema.edgeDetections.ownerId} is null and ${schema.edgeDetections.detectedAt} > now() - interval '120 days'`)
    .orderBy(desc(schema.edgeDetections.detectedAt)).limit(400);
  for (const r of rows) {
    const t = r.ticker || r.tickers[0];
    if (!t || !tickers.includes(t)) continue;
    const list = out.get(t) ?? [];
    list.push({ id: r.id, title: r.title, side: r.side ?? "", severity: r.severity === "high" || r.severity === "low" ? r.severity : "medium", at: r.at.toISOString() });
    out.set(t, list);
  }
  return out;
}

const marketOf = (m: Market): MarbMarket => ({ key: m.key, venue: VENUE_LABEL[m.venue], label: m.outcome ? `${m.title}: ${m.outcome}` : m.title, prob: m.prob ?? 0, change24h: m.change24h, url: m.url, closeTime: m.closeTime });

/** The acquirer's close on or just after signing, for the cash leg of a mixed deal. */
const closeAt = async (ticker: string, date: string) => (await closes(ticker, date)).find((c) => c.date >= date)?.close ?? null;

const SEV_RANK: Record<Severity, number> = { high: 3, medium: 2, low: 1 };

export async function marbView(now = Date.now()): Promise<MarbView> {
  const [dbr, nwr] = await Promise.all([attempt("marb-deals", [], dbDeals), attempt("marb-news", [], newsDeals)]);
  const ciks = await attempt("marb-ciks", new Map<string, string>(), () => cikTickers(dbr.value.filter((d) => !d.newsAcq).map((d) => d.acquirerCik)));

  type Draft = Omit<MarbRow, "px" | "close" | "spread" | "flags" | "markets">;
  const drafts: Draft[] = [];
  // When each deal was signed: the acquirer's price then splits a mixed deal's stated value into cash and stock.
  const signed = new Map<string, string | null>();
  const seen = new Set<string>();
  for (const d of dbr.value) {
    const f = d.fields;
    const cons = consOf(f.consideration) || consOf(d.consideration);
    const perShare = num(f.per_share), ratio = num(f.exchange_ratio), premium = num(f.premium_unaffected) ?? d.premiumUnaffected;
    const targetTicker = d.targetTicker || d.newsTarget || "";
    const acquirerTicker = d.newsAcq || ciks.value.get(d.acquirerCik.padStart(10, "0")) || "";
    if (targetTicker) seen.add(targetTicker);
    drafts.push({
      key: `deal:${d.id}`, dealId: d.id, stage: "signed", target: d.targetName || targetTicker, targetTicker, acquirer: d.acquirerName || acquirerTicker, acquirerTicker, kind: d.kind, consideration: cons, buyerType: d.buyerType,
      announced: iso(d.announcedAt), sizeUsdMm: d.equityUsdMm,
      terms: { consideration: cons, cash: cons === "cash" ? perShare : null, ratio, stated: perShare, cvr: typeof f.cvr === "string" ? f.cvr : null, source: perShare || ratio ? "deal database" : null },
      unaffected: perShare && premium && premium > -0.9 ? Math.round((perShare / (1 + premium)) * 100) / 100 : null, premium,
      approvals: Array.isArray(f.approvals) ? f.approvals.map(String) : [], secondRequest: f.second_request === "yes",
      url: d.sources[0]?.url || d.newsUrl || "", headline: "",
    });
    signed.set(`deal:${d.id}`, typeof f.sign_date === "string" ? f.sign_date : iso(d.signedAt) ?? iso(d.announcedAt));
  }
  for (const { d, headline } of nwr.value) {
    if (seen.has(d.targetTicker)) continue;
    seen.add(d.targetTicker);
    const cons = consOf(d.consideration);
    const unaffected = num(d.unaffectedPrice) ?? (num(d.perShare) && num(d.premium) ? Math.round((d.perShare! / (1 + d.premium!)) * 100) / 100 : null);
    drafts.push({
      key: `news:${d.id}`, dealId: null, stage: stageOf(headline) === "reported" ? "reported" : "signed", target: d.target || d.targetTicker, targetTicker: d.targetTicker, acquirer: d.acquirer || d.acquirerTicker, acquirerTicker: d.acquirerTicker,
      kind: d.kind, consideration: cons, buyerType: "", announced: iso(d.announcedAt), sizeUsdMm: num(d.valueUsd) !== null ? d.valueUsd! / 1e6 : null,
      terms: { consideration: cons, cash: cons === "cash" ? num(d.perShare) : null, ratio: null, stated: num(d.perShare), cvr: null, source: num(d.perShare) ? "news" : null },
      unaffected, premium: num(d.premium), approvals: [], secondRequest: false, url: d.sourceUrl, headline,
    });
    signed.set(`news:${d.id}`, iso(d.announcedAt));
  }

  // The newest deals first, at most MAX_ROWS of them, so pricing stays one short round of quotes.
  drafts.sort((a, b) => (b.announced ?? "").localeCompare(a.announced ?? ""));
  drafts.splice(MAX_ROWS);
  const tickers = [...new Set(drafts.flatMap((d) => [d.targetTicker, d.acquirerTicker]).filter(Boolean))];
  const [px, flags, mk] = await Promise.all([
    attempt<Record<string, LiveQuote>>("marb-quotes", {}, () => (tickers.length ? quotes(tickers) : Promise.resolve({}))),
    attempt("marb-flags", new Map<string, MarbFlag[]>(), () => flagsByTicker(tickers)),
    attempt("marb-markets", { markets: [] as Market[], venues: [] as { venue: string; ok: boolean; fetchedAt: string | null; stale: boolean }[] }, () => (drafts.length ? loadMarkets(["kalshi", "polymarket"]) : Promise.resolve({ markets: [], venues: [] }))),
  ]);
  // The cash leg of a mixed deal needs the acquirer's price at signing (a few deals at most).
  const legs = new Map<string, number | null>();
  await Promise.all(drafts.filter((d) => d.consideration === "mixed" && d.terms.ratio && d.terms.stated && d.acquirerTicker && signed.get(d.key)).slice(0, 12).map(async (d) => {
    const at = await attempt("marb-signing-close", null as number | null, () => closeAt(d.acquirerTicker, signed.get(d.key)!));
    legs.set(d.key, cashLeg(d.terms.stated, d.terms.ratio, at.value));
  }));
  const open = mk.value.markets.filter((m) => m.status === "open" && m.prob !== null);

  const rows: MarbRow[] = drafts.map((d) => {
    const t = px.value[d.targetTicker], a = d.acquirerTicker ? px.value[d.acquirerTicker] : undefined;
    const terms = { ...d.terms, cash: d.consideration === "mixed" ? legs.get(d.key) ?? null : d.terms.cash };
    const close = expectedClose({ kind: d.kind, consideration: d.consideration, announced: d.announced ?? "", approvals: d.approvals, secondRequest: d.secondRequest }, now);
    const spread = spreadRow(terms, { target: t?.price ?? null, acquirer: a?.price ?? null, unaffected: d.unaffected }, close.daysForReturn);
    const f = [...(flags.value.get(d.targetTicker) ?? []), ...(d.acquirerTicker ? flags.value.get(d.acquirerTicker) ?? [] : [])].sort((x, y) => SEV_RANK[y.severity] - SEV_RANK[x.severity] || y.at.localeCompare(x.at));
    const markets = open.filter((m) => marketMatchesDeal({ title: m.title, outcome: m.outcome, question: m.question }, d)).sort((x, y) => (y.volume24h ?? 0) - (x.volume24h ?? 0)).slice(0, 3).map(marketOf);
    return { ...d, terms, close, spread, flags: f.slice(0, 6), markets, px: { target: t?.price ?? null, targetChg: t?.changePct ?? null, acquirer: a?.price ?? null, acquirerChg: a?.changePct ?? null, asOf: newest([t?.asOf, a?.asOf]), source: t?.source ?? a?.source ?? null } };
  }).sort((x, y) => (y.spread.annualised ?? -Infinity) - (x.spread.annualised ?? -Infinity));

  const priced = rows.filter((r) => r.px.target !== null).length;
  const venues = mk.value.venues;
  const sources: SourceState[] = [
    stateOf("deals", "Edge deals database (EDGAR merger filings)", dbr.ok, dbr.value.length, null, { note: "terms quoted from the filings and checked" }),
    stateOf("news", "Newsroom deal tracker", nwr.ok, nwr.value.length, null, { note: "deals not read from filings yet, terms from the story" }),
    stateOf("prices", "Market prices", px.ok && (priced > 0 || !rows.length), priced, newest(rows.map((r) => r.px.asOf)), { note: priced < rows.length ? `${rows.length - priced} of ${rows.length} targets without a price` : undefined }),
    stateOf("flags", "Edge deal watch", flags.ok, [...flags.value.values()].flat().length, newest([...flags.value.values()].flat().map((f) => f.at))),
    ...(venues.length ? venues.map((v) => stateOf(`predict-${v.venue}`, `${VENUE_LABEL[v.venue as keyof typeof VENUE_LABEL] ?? v.venue} prediction markets`, mk.ok && v.ok, v.ok ? 1 : 0, v.fetchedAt, { note: v.stale ? "last good list" : undefined })) : [stateOf("predict", "Prediction markets", mk.ok, 0, null)]),
  ];
  return {
    rows, sources, asOf: new Date(now).toISOString(),
    counts: { deals: rows.length, priced, withTerms: rows.filter((r) => r.spread.offer !== null).length, flagged: rows.filter((r) => r.flags.length).length, markets: rows.filter((r) => r.markets.length).length },
  };
}

export type SpreadHistoryView = { points: { date: string; offer: number; spreadPct: number }[]; source: string | null; note: string };

/** A deal's spread each day since announcement, from daily closes of the target and the acquirer. */
export async function spreadHistoryView(q: { target: string; acquirer: string; terms: Terms; from: string }): Promise<SpreadHistoryView> {
  const needsAcq = (q.terms.consideration === "stock" || q.terms.consideration === "mixed") && !!q.terms.ratio;
  const [t, a] = await Promise.all([
    attempt("marb-history-target", [] as { date: string; close: number }[], () => closes(q.target, q.from)),
    attempt("marb-history-acquirer", [] as { date: string; close: number }[], () => (needsAcq && q.acquirer ? closes(q.acquirer, q.from) : Promise.resolve([]))),
  ]);
  const points = spreadHistory(q.terms, t.value, a.value);
  const note = !t.ok ? "Daily prices for the target are not available right now." : needsAcq && !a.ok ? "Daily prices for the acquirer are not available right now, so the stock leg cannot be marked." : !points.length ? "No trading days since announcement yet." : `${points.length} trading days since ${q.from}; the stock leg marked at each day's close.`;
  return { points, source: t.ok ? "Daily closes (market data layer)" : null, note };
}
