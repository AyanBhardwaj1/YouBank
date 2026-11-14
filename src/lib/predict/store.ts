/**
 * Reading the venues: public market-data endpoints only, no keys, no trading. Server only.
 *
 * Every read goes through fetchRetry (a timeout per attempt and one polite retry) and the shared cache
 * (src/lib/cache.ts) with stale-if-error: when a venue is down, the last good snapshot answers (flagged
 * stale) for up to a week, and a venue with no snapshot at all is simply missing from the list. Nothing
 * here throws to a page: loadMarkets() always answers, with each venue's state.
 *
 * Endpoints and how long each answer is kept fresh:
 * - Kalshi   GET api.elections.kalshi.com/trade-api/v2/events?status=open&with_nested_markets=true (3 min)
 *            GET …/markets/{ticker} (2 min), …/series/{s}/markets/{t}/candlesticks (10 min), …/markets/{t}/orderbook (30 s)
 * - Polymarket GET gamma-api.polymarket.com/events?active=true&closed=false&order=volume24hr (3 min), /markets/{id} (2 min)
 *            GET clob.polymarket.com/prices-history (10 min), /book (30 s)
 * - Gemini   GET api.gemini.com/v1/prediction-markets/events?status=active (5 min), /events/{ticker} (2 min)
 * - Manifold GET api.manifold.markets/v0/search-markets (10 min), /v0/market/{id} (2 min)
 */
import { cacheEntry, cacheJson } from "@/lib/cache";
import { logError } from "@/lib/errors";
import { fetchRetry } from "@/lib/net";
import { predictSignalsFor, type TickerEvent } from "./exposure";
import { geminiEvents, kalshiBook, kalshiCandles, kalshiEvents, kalshiMarkets, manifoldMarkets, polymarketBook, polymarketEvents, polymarketHistory } from "./normalize";
import { VENUE_LABEL, VENUES, type Book, type Market, type PricePoint, type Venue, type VenueState } from "./types";

const MIN = 60_000;
const WEEK = 7 * 24 * 60 * MIN;
const BASE = {
  kalshi: "https://api.elections.kalshi.com/trade-api/v2",
  gamma: "https://gamma-api.polymarket.com",
  clob: "https://clob.polymarket.com",
  gemini: "https://api.gemini.com/v1/prediction-markets",
  manifold: "https://api.manifold.markets/v0",
};
export const TTL: Record<Venue, number> = { kalshi: 3 * MIN, polymarket: 3 * MIN, gemini: 5 * MIN, manifold: 10 * MIN };

/** GET a venue's JSON. A non-2xx answer throws "<Venue> <status>" (a 5xx reads as the source being down). */
async function getJson(label: string, url: string, timeoutMs = 8_000): Promise<unknown> {
  const res = await fetchRetry(url, { timeoutMs, retries: 1, deadlineMs: timeoutMs * 2 + 1_500, headers: { accept: "application/json", "user-agent": "YouBank/1.0 (research; read-only)" } });
  if (!res.ok) { void res.body?.cancel().catch(() => undefined); throw new Error(`${label} ${res.status}`); }
  return res.json();
}

/* ---------------- Lists ---------------- */

async function loadKalshi(): Promise<Market[]> {
  const out: Market[] = [];
  let cursor = "";
  // Three pages of 200 events: every open economics, politics and company event, and the busiest of the rest.
  for (let page = 0; page < 3; page++) {
    const j = await getJson("Kalshi", `${BASE.kalshi}/events?status=open&with_nested_markets=true&limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`) as { cursor?: string };
    out.push(...kalshiEvents(j));
    cursor = typeof j?.cursor === "string" ? j.cursor : "";
    if (!cursor) break;
  }
  return out;
}

async function loadPolymarket(): Promise<Market[]> {
  const pages = await Promise.all([0, 100].map((offset) => getJson("Polymarket", `${BASE.gamma}/events?active=true&closed=false&archived=false&order=volume24hr&ascending=false&limit=100&offset=${offset}`)));
  return pages.flatMap(polymarketEvents);
}

const loadGemini = async (): Promise<Market[]> => geminiEvents(await getJson("Gemini", `${BASE.gemini}/events?status=active&limit=100`));
const loadManifold = async (): Promise<Market[]> => manifoldMarkets(await getJson("Manifold", `${BASE.manifold}/search-markets?term=&filter=open&contractType=BINARY&sort=liquidity&limit=200`));

const LOADERS: Record<Venue, () => Promise<Market[]>> = { kalshi: loadKalshi, polymarket: loadPolymarket, gemini: loadGemini, manifold: loadManifold };

/** Per venue, at most this many markets are kept (the most traded): the list stays well under the shared cache's row limit. */
export const LIST_MAX = 1_500;
/**
 * A list as it is cached: the most traded LIST_MAX markets with their rules cut to a preview (the detail page
 * reads the market itself for the full text). Pure.
 */
export function slim(ms: Market[]): Market[] {
  return [...ms].sort((a, b) => (b.volume24h ?? 0) - (a.volume24h ?? 0) || (b.volume ?? 0) - (a.volume ?? 0)).slice(0, LIST_MAX).map((m) => (m.rules.length > 400 ? { ...m, rules: `${m.rules.slice(0, 397)}…` } : m));
}

/** The last good list per venue in this process, for when the shared cache itself cannot be read. */
const lastGood = new Map<Venue, { markets: Market[]; at: number }>();

/** One venue's open markets: cached, stale-if-error for a week, never throwing. */
export async function venueMarkets(v: Venue): Promise<{ markets: Market[]; state: VenueState }> {
  try {
    const e = await cacheEntry(`predict:v1:list:${v}`, TTL[v], async () => {
      const ms = await LOADERS[v]();
      // An empty answer from a venue that normally lists hundreds is a fault, not news: keep the last list.
      if (!ms.length) throw new Error(`${VENUE_LABEL[v]} returned no markets`);
      return slim(ms);
    }, { shared: true, staleMs: TTL[v], staleIfErrorMs: WEEK });
    lastGood.set(v, { markets: e.value, at: e.fetchedAt });
    return { markets: e.value, state: { venue: v, ok: true, count: e.value.length, stale: e.stale, fetchedAt: new Date(e.fetchedAt).toISOString() } };
  } catch (err) {
    logError(err, { where: `predict-list-${v}` });
    const last = lastGood.get(v);
    if (last) return { markets: last.markets, state: { venue: v, ok: true, count: last.markets.length, stale: true, fetchedAt: new Date(last.at).toISOString() } };
    return { markets: [], state: { venue: v, ok: false, count: 0, stale: false, fetchedAt: null } };
  }
}

/** Every venue's open markets, with each venue's state. Never throws. */
export async function loadMarkets(venues: Venue[] = VENUES): Promise<{ markets: Market[]; venues: VenueState[] }> {
  const all = await Promise.all(venues.map(venueMarkets));
  return { markets: all.flatMap((x) => x.markets), venues: all.map((x) => x.state) };
}

/* ---------------- One market ---------------- */

export const KEY_RE = /^(kalshi|polymarket|gemini|manifold):[A-Za-z0-9._\-:]{1,120}$/;
export function parseKey(key: string): { venue: Venue; id: string } | null {
  if (!KEY_RE.test(key)) return null;
  const i = key.indexOf(":");
  return { venue: key.slice(0, i) as Venue, id: key.slice(i + 1) };
}

/**
 * One market by its key: from the lists when it is there, else from the venue (a closed or resolved market
 * drops off the lists, and that is when forecasts are scored). `eventId` is needed for Gemini, whose single
 * reads are by event. Null when it cannot be found or read.
 */
export async function marketByKey(key: string, opts: { eventId?: string; fresh?: boolean } = {}): Promise<Market | null> {
  const k = parseKey(key);
  if (!k) return null;
  if (!opts.fresh) {
    const { markets } = await venueMarkets(k.venue);
    const hit = markets.find((m) => m.key === key);
    if (hit) return hit;
  }
  try {
    return await cacheJson(`predict:v1:one:${key}`, 2 * MIN, async () => {
      let list: Market[] = [];
      if (k.venue === "kalshi") list = kalshiMarkets(await getJson("Kalshi", `${BASE.kalshi}/markets/${encodeURIComponent(k.id)}`));
      else if (k.venue === "polymarket") list = polymarketEvents([await getJson("Polymarket", `${BASE.gamma}/markets/${encodeURIComponent(k.id)}`)]);
      else if (k.venue === "manifold") list = manifoldMarkets(await getJson("Manifold", `${BASE.manifold}/market/${encodeURIComponent(k.id)}`));
      else if (k.venue === "gemini" && opts.eventId) list = geminiEvents({ data: [await getJson("Gemini", `${BASE.gemini}/events/${encodeURIComponent(opts.eventId)}`)] });
      const m = list.find((x) => x.key === key);
      if (!m) throw new Error(`${VENUE_LABEL[k.venue]} market not found`);
      return m;
    }, { staleIfErrorMs: WEEK });
  } catch (e) {
    logError(e, { where: "predict-one" });
    return null;
  }
}

export type Range = "1w" | "1m" | "3m";
const RANGE_DAYS: Record<Range, number> = { "1w": 7, "1m": 30, "3m": 90 };

/** A market's probability history over a range; empty when the venue has none or cannot be read. */
export async function priceHistory(m: Market, range: Range = "1m"): Promise<PricePoint[]> {
  const days = RANGE_DAYS[range];
  try {
    return await cacheJson(`predict:v1:hist:${m.key}:${range}`, 10 * MIN, async () => {
      const end = Math.floor(Date.now() / 1000), start = end - days * 86_400;
      if (m.venue === "kalshi" && m.seriesId) {
        const period = days <= 7 ? 60 : 1440;
        return kalshiCandles(await getJson("Kalshi", `${BASE.kalshi}/series/${encodeURIComponent(m.seriesId)}/markets/${encodeURIComponent(m.id)}/candlesticks?start_ts=${start}&end_ts=${end}&period_interval=${period}`));
      }
      if (m.venue === "polymarket" && m.tokenId) {
        const fidelity = days <= 7 ? 60 : days <= 30 ? 360 : 1440;
        return polymarketHistory(await getJson("Polymarket", `${BASE.clob}/prices-history?market=${encodeURIComponent(m.tokenId)}&startTs=${start}&endTs=${end}&fidelity=${fidelity}`));
      }
      return [];
    }, { staleIfErrorMs: WEEK });
  } catch (e) {
    logError(e, { where: "predict-history" });
    return [];
  }
}

/** The order book (yes side), or the venue's best bid and ask when the full book cannot be read. */
export async function orderBook(m: Market): Promise<{ book: Book | null; depth: boolean }> {
  const top = (): { book: Book | null; depth: boolean } => ({ book: m.bid !== null || m.ask !== null ? { bids: m.bid !== null ? [[m.bid, 0]] : [], asks: m.ask !== null ? [[m.ask, 0]] : [] } : null, depth: false });
  try {
    const book = await cacheJson<Book | null>(`predict:v1:book:${m.key}`, 30_000, async () => {
      if (m.venue === "kalshi") return kalshiBook(await getJson("Kalshi", `${BASE.kalshi}/markets/${encodeURIComponent(m.id)}/orderbook?depth=10`, 5_000));
      if (m.venue === "polymarket" && m.tokenId) return polymarketBook(await getJson("Polymarket", `${BASE.clob}/book?token_id=${encodeURIComponent(m.tokenId)}`, 5_000));
      return null;
    }, { staleIfErrorMs: 5 * MIN });
    return book && (book.bids.length || book.asks.length) ? { book: { bids: book.bids.slice(0, 10), asks: book.asks.slice(0, 10) }, depth: true } : top();
  } catch {
    // Kalshi may ask for a signed request for the book: its best bid and ask still come with the market.
    return top();
  }
}

/** predictSignalsFor (./exposure.ts) over today's markets: what Edge, Home or MCP calls with a ticker list. Never throws. */
export async function loadPredictSignals(tickers: string[], perTicker = 5): Promise<Record<string, TickerEvent[]>> {
  const { markets } = await loadMarkets(["kalshi", "polymarket", "gemini"]);
  return predictSignalsFor(tickers, markets, { perTicker });
}
