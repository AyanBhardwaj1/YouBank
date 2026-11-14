/**
 * Each venue's public JSON into the one Market shape (./types.ts). Pure and defensive: a venue that adds,
 * renames or drops a field costs that field, never the page. Tested against trimmed responses in
 * scripts/fixtures/predict by scripts/test-predict.ts.
 *
 * - Kalshi (trade-api v2): prices are fixed-point dollar strings (yes_bid_dollars, last_price_dollars),
 *   counts are fixed-point contract strings (volume_24h_fp). A 24-hour change is last price minus
 *   previous_price_dollars (the price a day earlier). Volume is in contracts; it is turned into dollars at
 *   the yes price so venues compare.
 * - Polymarket (Gamma): outcomes, outcomePrices and clobTokenIds are JSON-encoded strings. The first
 *   outcome is the "yes" side (for a two-team game, the first team). oneDayPriceChange is the day's move.
 * - Gemini Predictions: events with a `contracts` array, each with an instrumentSymbol and `prices`
 *   (bestBid, bestAsk, lastTradePrice as decimal strings). Field names are accepted in the documented
 *   variants, since the sample could not be captured live.
 * - Manifold: binary markets only; play money, kept as a calibration reference.
 */
import { categorize } from "./categories";
import type { Book, Market, MarketStatus, PricePoint } from "./types";

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown, max = 400): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : typeof v === "number" ? String(v) : "");
/** A number from a number or a numeric string; null for anything else (empty strings included). */
export function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string" || !v.trim()) return null;
  const n = Number(v.trim());
  return Number.isFinite(n) ? n : null;
}
/** A price in [0, 1]; null outside it. */
const price = (v: unknown): number | null => { const n = num(v); return n !== null && n >= 0 && n <= 1 ? n : null; };
const iso = (v: unknown): string | null => {
  if (typeof v === "number" && Number.isFinite(v)) return new Date(v > 1e12 ? v : v * 1000).toISOString();
  if (typeof v !== "string" || !v.trim()) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};
/** Gamma's JSON-in-a-string arrays ("[\"Yes\", \"No\"]"), or a real array. */
function jsonList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => str(x, 200));
  if (typeof v !== "string") return [];
  try { const p = JSON.parse(v); return Array.isArray(p) ? p.map((x) => str(x, 200)) : []; } catch { return []; }
}
const round4 = (v: number | null) => (v === null ? null : Math.round(v * 10_000) / 10_000);
/** The mid of a bid and an ask when both are real and the spread is not absurd; else the last trade; else either side. */
export function impliedProb(bid: number | null, ask: number | null, last: number | null): number | null {
  const okBid = bid !== null && bid > 0, okAsk = ask !== null && ask > 0 && ask < 1;
  if (okBid && okAsk && ask! >= bid! && ask! - bid! <= 0.1) return round4((bid! + ask!) / 2);
  if (last !== null && last > 0 && last < 1) return round4(last);
  if (okBid && okAsk) return round4((bid! + ask!) / 2);
  return last ?? (okBid ? bid : okAsk ? ask : null);
}
const clipRules = (...parts: string[]) => parts.filter(Boolean).join(" ").slice(0, 2_000);

/* ---------------- Kalshi ---------------- */

function kalshiStatus(s: string, result: string): { status: MarketStatus; result: "yes" | "no" | null } {
  const r = result === "yes" || result === "no" ? result : null;
  if (/^(settled|finalized)$/.test(s) || (r && /^(closed|determined)$/.test(s))) return { status: r ? "resolved" : "closed", result: r };
  if (/^(closed|determined|inactive|paused)$/.test(s)) return { status: "closed", result: null };
  return { status: "open", result: null };
}

/** One Kalshi market (trade-api v2 Market), with what its event and series add. */
export function kalshiMarket(raw: unknown, event: { title?: string; category?: string; series?: string; siblings?: number } = {}): Market | null {
  const m = obj(raw);
  const id = str(m.ticker, 120);
  if (!id) return null;
  const eventId = str(m.event_ticker, 120);
  const series = event.series || eventId.split("-")[0] || id.split("-")[0];
  const bid = price(m.yes_bid_dollars), ask = price(m.yes_ask_dollars), last = price(m.last_price_dollars), prev = price(m.previous_price_dollars);
  const { status, result } = kalshiStatus(str(m.status, 30), str(m.result, 10));
  const prob = status === "resolved" ? (result === "yes" ? 1 : 0) : impliedProb(bid && bid > 0 ? bid : null, ask && ask > 0 ? ask : null, last);
  const contracts24 = num(m.volume_24h_fp) ?? num(m.volume_24h), contracts = num(m.volume_fp) ?? num(m.volume);
  const atPrice = prob !== null && prob > 0 && prob < 1 ? prob : last ?? 0.5;
  const title = str(event.title, 300) || str(m.title, 300);
  const marketTitle = str(m.title, 300);
  const outcome = str(m.yes_sub_title, 120);
  return {
    key: `kalshi:${id}`, venue: "kalshi", id, eventId, title,
    // A single-market event repeats its own title as the outcome; that adds nothing.
    outcome: outcome && outcome !== title ? outcome : (event.siblings ?? 1) > 1 && marketTitle !== title ? marketTitle : "",
    question: marketTitle || title,
    category: categorize(`${title} ${marketTitle}`, [event.category]),
    prob, change24h: status === "open" && last !== null && prev !== null && last > 0 && prev > 0 ? round4(last - prev) : null,
    bid: bid && bid > 0 ? bid : null, ask: ask && ask > 0 && ask < 1 ? ask : null,
    volume24h: contracts24 === null ? null : Math.round(contracts24 * atPrice),
    volume: contracts === null ? null : Math.round(contracts * atPrice),
    liquidity: num(m.liquidity_dollars), openInterest: num(m.open_interest_fp) ?? num(m.open_interest),
    closeTime: iso(m.close_time), status, result,
    url: `https://kalshi.com/markets/${encodeURIComponent(series.toLowerCase())}`,
    rules: clipRules(str(m.rules_primary, 1_200), str(m.rules_secondary, 800)),
    realMoney: true, seriesId: series,
  };
}

/** GET /events?with_nested_markets=true → markets. */
export function kalshiEvents(json: unknown): Market[] {
  const out: Market[] = [];
  for (const e of arr(obj(json).events)) {
    const ev = obj(e);
    const meta = { title: str(ev.title, 300), category: str(ev.category, 60), series: str(ev.series_ticker, 60), siblings: arr(ev.markets).length };
    for (const m of arr(ev.markets)) { const x = kalshiMarket(m, meta); if (x) out.push(x); }
  }
  return out;
}

/** GET /markets (a page of markets without their events) or GET /markets/{ticker} ({ market }). */
export function kalshiMarkets(json: unknown): Market[] {
  const j = obj(json);
  const list = j.market ? [j.market] : arr(j.markets);
  return list.map((m) => kalshiMarket(m)).filter((m): m is Market => !!m);
}

/** Candlesticks → a probability history: the closing trade, else the mid of the closing bid and ask. */
export function kalshiCandles(json: unknown): PricePoint[] {
  const out: PricePoint[] = [];
  for (const c of arr(obj(json).candlesticks)) {
    const k = obj(c);
    const t = num(k.end_period_ts);
    if (t === null) continue;
    const close = price(obj(k.price).close_dollars), bid = price(obj(k.yes_bid).close_dollars), ask = price(obj(k.yes_ask).close_dollars);
    const p = close !== null && close > 0 ? close : bid !== null && ask !== null && ask > 0 ? (bid + ask) / 2 : null;
    if (p !== null) out.push({ t: t * 1000, p: round4(p)! });
  }
  return out.sort((a, b) => a.t - b.t);
}

/** Kalshi's book holds yes bids and no bids (ascending); a no bid at x is a yes ask at 1 - x. */
export function kalshiBook(json: unknown): Book | null {
  const b = obj(obj(json).orderbook_fp ?? obj(json).orderbook);
  const level = (l: unknown): [number, number] | null => { const a = arr(l); const p = price(a[0]), s = num(a[1]); return p !== null && s !== null && s > 0 ? [p, s] : null; };
  const yes = arr(b.yes_dollars ?? b.yes).map(level).filter((x): x is [number, number] => !!x);
  const no = arr(b.no_dollars ?? b.no).map(level).filter((x): x is [number, number] => !!x);
  if (!yes.length && !no.length) return null;
  return {
    bids: yes.sort((a, c) => c[0] - a[0]),
    asks: no.map(([p, s]) => [round4(1 - p)!, s] as [number, number]).sort((a, c) => a[0] - c[0]),
  };
}

/* ---------------- Polymarket ---------------- */

/** One Gamma market. `event` carries the event's title, slug and tags when the market came nested in one. */
export function polymarketMarket(raw: unknown, event: { id?: string; title?: string; slug?: string; tags?: string[] } = {}): Market | null {
  const m = obj(raw);
  const id = str(m.id, 40);
  if (!id) return null;
  const outcomes = jsonList(m.outcomes), prices = jsonList(m.outcomePrices).map(price), tokens = jsonList(m.clobTokenIds);
  if (outcomes.length !== 2) return null; // only binary markets: a market's first outcome is its yes side
  const ev = obj(arr(m.events)[0]);
  const eventTitle = event.title || str(ev.title, 300);
  const question = str(m.question, 300);
  const title = eventTitle || question;
  const group = str(m.groupItemTitle, 120);
  const closed = m.closed === true;
  // A closed market priced at 1 and 0 has resolved; the winning side is the one at 1. A closed market at
  // other prices (a dispute under way, a 50-50 refund) stays closed and unscored.
  const p0 = prices[0] ?? null, p1 = prices[1] ?? null;
  const settled = closed && p0 !== null && p1 !== null && ((p0 >= 0.99 && p1 <= 0.01) || (p0 <= 0.01 && p1 >= 0.99));
  const status: MarketStatus = closed ? (settled ? "resolved" : "closed") : m.active === false ? "closed" : "open";
  const result = status === "resolved" ? (p0! >= 0.99 ? "yes" : "no") : null;
  const bid = price(m.bestBid), ask = price(m.bestAsk), last = price(m.lastTradePrice);
  const prob = status === "resolved" ? (result === "yes" ? 1 : 0) : impliedProb(bid && bid > 0 ? bid : null, ask && ask > 0 ? ask : null, last ?? p0);
  const yesNo = /^yes$/i.test(outcomes[0]) && /^no$/i.test(outcomes[1]);
  const slug = event.slug || str(ev.slug, 200) || str(m.slug, 200);
  return {
    key: `polymarket:${id}`, venue: "polymarket", id, eventId: event.id || str(ev.id, 40) || id, title,
    outcome: group || (eventTitle && question !== eventTitle ? question : "") || (yesNo ? "" : outcomes[0]),
    question: question || title,
    category: categorize(`${title} ${question}`, event.tags ?? []),
    prob, change24h: status === "open" ? round4(num(m.oneDayPriceChange)) : null,
    bid: bid && bid > 0 ? bid : null, ask: ask && ask > 0 && ask < 1 ? ask : null,
    volume24h: num(m.volume24hr) ?? num(m.volume24hrClob), volume: num(m.volumeNum) ?? num(m.volume),
    liquidity: num(m.liquidityNum) ?? num(m.liquidity), openInterest: num(m.openInterest),
    closeTime: iso(m.endDate ?? m.endDateIso), status, result,
    url: `https://polymarket.com/event/${encodeURIComponent(slug)}`,
    rules: str(m.description, 2_000), realMoney: true, tokenId: tokens[0] || undefined,
  };
}

/** GET /events (nested markets) → markets. Also accepts a bare list of markets (GET /markets). */
export function polymarketEvents(json: unknown): Market[] {
  const out: Market[] = [];
  for (const e of arr(json)) {
    const ev = obj(e);
    if (!Array.isArray(ev.markets)) { const x = polymarketMarket(ev); if (x) out.push(x); continue; }
    const meta = { id: str(ev.id, 40), title: str(ev.title, 300), slug: str(ev.slug, 200), tags: arr(ev.tags).map((t) => str(obj(t).label, 60)).filter(Boolean) };
    // Inside a closed event, markets that are no longer listed are left out.
    for (const m of ev.markets) { const x = polymarketMarket(m, meta); if (x) out.push(x); }
  }
  return out;
}

/** CLOB /prices-history → points (t in seconds there, ms here). */
export function polymarketHistory(json: unknown): PricePoint[] {
  return arr(obj(json).history).map((h) => { const x = obj(h); const t = num(x.t), p = price(x.p); return t !== null && p !== null ? { t: t * 1000, p: round4(p)! } : null; })
    .filter((x): x is PricePoint => !!x).sort((a, b) => a.t - b.t);
}

/** CLOB /book → the yes token's bids and asks, best first. */
export function polymarketBook(json: unknown): Book | null {
  const j = obj(json);
  const level = (l: unknown): [number, number] | null => { const x = obj(l); const p = price(x.price), s = num(x.size); return p !== null && s !== null && s > 0 ? [p, s] : null; };
  const bids = arr(j.bids).map(level).filter((x): x is [number, number] => !!x).sort((a, b) => b[0] - a[0]);
  const asks = arr(j.asks).map(level).filter((x): x is [number, number] => !!x).sort((a, b) => a[0] - b[0]);
  return bids.length || asks.length ? { bids, asks } : null;
}

/* ---------------- Gemini ---------------- */

function geminiStatus(s: string): MarketStatus {
  if (/(settled|resolved|finali[sz]ed)/i.test(s)) return "resolved";
  if (/(closed|expired|halted|suspended|inactive)/i.test(s)) return "closed";
  return "open";
}

/** GET /v1/prediction-markets/events → one market per contract. */
export function geminiEvents(json: unknown): Market[] {
  const j = obj(json);
  const events = Array.isArray(json) ? json : arr(j.data ?? j.events ?? j.results);
  const out: Market[] = [];
  for (const e of events) {
    const ev = obj(e);
    const ticker = str(ev.ticker ?? ev.eventTicker ?? ev.event_ticker, 80);
    const title = str(ev.title ?? ev.name, 300);
    if (!ticker || !title) continue;
    const contracts = arr(ev.contracts ?? ev.markets);
    const evVolume = num(ev.volume ?? ev.volumeUsd ?? ev.totalVolume);
    for (const c of contracts) {
      const k = obj(c);
      const id = str(k.instrumentSymbol ?? k.symbol ?? k.ticker, 120);
      if (!id) continue;
      const p = obj(k.prices ?? k.price);
      const bid = price(p.bestBid ?? k.bestBid), ask = price(p.bestAsk ?? k.bestAsk), last = price(p.lastTradePrice ?? k.lastTradePrice);
      const status = geminiStatus(str(k.status ?? ev.status, 30));
      const res = str(k.resolution ?? k.result ?? k.outcome, 10).toLowerCase();
      const result = status === "resolved" && (res === "yes" || res === "no") ? (res as "yes" | "no") : null;
      const label = str(k.label ?? k.title ?? k.name, 160);
      out.push({
        key: `gemini:${id}`, venue: "gemini", id, eventId: ticker, title,
        outcome: /^yes$/i.test(label) || label === title ? "" : label,
        question: /^yes$/i.test(label) || !label ? title : `${title}: ${label}`,
        category: categorize(`${title} ${label}`, [str(ev.category, 60)]),
        prob: status === "resolved" && result ? (result === "yes" ? 1 : 0) : impliedProb(bid && bid > 0 ? bid : null, ask && ask > 0 ? ask : null, last),
        change24h: null, bid: bid && bid > 0 ? bid : null, ask: ask && ask > 0 && ask < 1 ? ask : null,
        // Gemini reports volume per event, in US dollars; spread over its contracts it would be invented, so it stays on one.
        volume24h: null, volume: contracts.length === 1 ? evVolume : null, liquidity: null, openInterest: null,
        closeTime: iso(k.expiryDate ?? ev.expiryDate ?? k.closeTime ?? ev.closeTime), status: result ? "resolved" : status === "resolved" ? "closed" : status, result,
        url: str(ev.url, 300).startsWith("https://") ? str(ev.url, 300) : `https://www.gemini.com/predictions/${encodeURIComponent(ticker)}`,
        rules: str(ev.description ?? ev.rules ?? k.rules, 2_000), realMoney: true,
      });
    }
  }
  return out;
}

/* ---------------- Manifold ---------------- */

/** GET /v0/search-markets (or /v0/markets) → binary markets. */
export function manifoldMarkets(json: unknown): Market[] {
  const out: Market[] = [];
  for (const raw of Array.isArray(json) ? json : [json]) {
    const m = obj(raw);
    const id = str(m.id, 40), q = str(m.question, 300);
    if (!id || !q || m.outcomeType !== "BINARY") continue;
    const resolved = m.isResolved === true;
    const res = str(m.resolution, 10).toUpperCase();
    const result = resolved && (res === "YES" || res === "NO") ? (res === "YES" ? "yes" : "no") : null;
    const url = str(m.url, 300);
    out.push({
      key: `manifold:${id}`, venue: "manifold", id, eventId: id, title: q, outcome: "", question: q, category: categorize(q, arr(m.groupSlugs).map((g) => str(g, 60))),
      prob: result ? (result === "yes" ? 1 : 0) : price(m.probability), change24h: null, bid: null, ask: null,
      volume24h: num(m.volume24Hours), volume: num(m.volume), liquidity: num(m.totalLiquidity), openInterest: null,
      closeTime: iso(m.closeTime), status: resolved ? (result ? "resolved" : "closed") : "open", result,
      url: url.startsWith("https://manifold.markets/") ? url : `https://manifold.markets/market/${encodeURIComponent(id)}`,
      rules: str(m.textDescription ?? m.description, 2_000), realMoney: false,
    });
  }
  return out;
}

/** The label a market goes by in a list: the event, and the outcome when there is one. */
export const marketLabel = (m: Pick<Market, "title" | "outcome">) => (m.outcome ? `${m.title}: ${m.outcome}` : m.title);
