/**
 * Token prices, market caps and history from CoinGecko. Server only.
 *
 * Keyless by default (a few calls a minute, so answers are cached for minutes). Two optional keys:
 * - COINGECKO_DEMO_KEY: CoinGecko's free "demo" key, which only raises the free limits;
 * - COINGECKO_PRO_KEY: the paid Pro API (more tokens, minute-level history). It is only used when a
 *   person with the "crypto.pro-data" feature explicitly asks for Pro data, never for page loads.
 *
 * Percent changes are returned as decimals (0.05 is 5%), the convention of every terminal screen.
 */
import { COINGECKO, coingeckoCoin, type Cite } from "./sources";
import { arr, cachedJson, CryptoDataError, HOUR, MIN, num, str, webUrl } from "./http";

/** The calls this request may make to CoinGecko: the free API, or the paid Pro API for a person entitled to it. */
export type Tier = "free" | "pro";

function cg(path: string, tier: Tier): { url: string; headers: Record<string, string>; source: string } {
  const pro = process.env.COINGECKO_PRO_KEY?.trim();
  if (tier === "pro" && pro) return { url: `https://pro-api.coingecko.com/api/v3${path}`, headers: { "x-cg-pro-api-key": pro }, source: "CoinGecko Pro" };
  const demo = process.env.COINGECKO_DEMO_KEY?.trim();
  return { url: `https://api.coingecko.com/api/v3${path}`, headers: demo ? { "x-cg-demo-api-key": demo } : {}, source: "CoinGecko" };
}

/** Whether the paid CoinGecko API is configured at all (the Pro switch says so when it is not). */
export const hasCoinGeckoPro = () => !!process.env.COINGECKO_PRO_KEY?.trim();

async function get<T, R>(path: string, key: string, ttlMs: number, shape: (raw: T) => R, tier: Tier = "free"): Promise<R> {
  const r = cg(path, tier);
  return cachedJson<T, R>(r.url, { key: `crypto:cg:${tier}:${key}`, ttlMs, source: r.source, headers: r.headers }, shape);
}

/* ---------------- Markets ---------------- */

export type TokenRow = {
  id: string; symbol: string; name: string; image: string; rank: number | null;
  price: number | null; marketCap: number | null; fdv: number | null; volume24h: number | null;
  d1: number | null; d7: number | null; d30: number | null; y1: number | null;
  circulating: number | null; total: number | null; max: number | null; athChange: number | null;
  /** Seven days of prices, thinned to about 42 points, for a sparkline. */
  spark: number[];
};

type RawMarket = Record<string, unknown> & { sparkline_in_7d?: { price?: unknown[] } };

const pct = (v: unknown) => { const n = num(v); return n === null ? null : n / 100; };
const thin = (xs: number[], n: number) => (xs.length <= n ? xs : Array.from({ length: n }, (_, i) => xs[Math.round((i * (xs.length - 1)) / (n - 1))]));

/** CoinGecko /coins/markets rows, normalised. Pure, for tests. */
export function parseMarkets(raw: unknown): TokenRow[] {
  return arr<RawMarket>(raw).filter((r) => r && typeof r.id === "string").map((r) => ({
    id: str(r.id), symbol: str(r.symbol).toUpperCase(), name: str(r.name), image: str(r.image), rank: num(r.market_cap_rank),
    price: num(r.current_price), marketCap: num(r.market_cap), fdv: num(r.fully_diluted_valuation), volume24h: num(r.total_volume),
    d1: pct(r.price_change_percentage_24h_in_currency ?? r.price_change_percentage_24h), d7: pct(r.price_change_percentage_7d_in_currency),
    d30: pct(r.price_change_percentage_30d_in_currency), y1: pct(r.price_change_percentage_1y_in_currency),
    circulating: num(r.circulating_supply), total: num(r.total_supply), max: num(r.max_supply), athChange: pct(r.ath_change_percentage),
    spark: thin(arr<unknown>(r.sparkline_in_7d?.price).map(num).filter((x): x is number => x !== null), 42),
  }));
}

/** The largest tokens by market cap. `category` is a CoinGecko category id (e.g. "real-world-assets-rwa"). */
export function tokenMarkets(opts: { perPage?: number; page?: number; category?: string; ids?: string[]; tier?: Tier } = {}): Promise<TokenRow[]> {
  const per = Math.min(250, Math.max(10, opts.perPage ?? 100));
  const q = new URLSearchParams({ vs_currency: "usd", order: "market_cap_desc", per_page: String(per), page: String(opts.page ?? 1), sparkline: "true", price_change_percentage: "24h,7d,30d,1y" });
  if (opts.category) q.set("category", opts.category);
  if (opts.ids?.length) q.set("ids", opts.ids.slice(0, 100).join(","));
  return get(`/coins/markets?${q}`, `markets:${q}`, 5 * MIN, parseMarkets, opts.tier ?? "free");
}

export type GlobalStats = { totalMarketCap: number | null; totalVolume: number | null; btcDominance: number | null; ethDominance: number | null; change24h: number | null; coins: number | null; updatedAt: string };

/** CoinGecko /global, normalised. Pure, for tests. */
export function parseGlobal(raw: unknown): GlobalStats {
  const d = ((raw as { data?: Record<string, unknown> })?.data ?? {}) as Record<string, Record<string, unknown> | unknown>;
  const usd = (k: string) => num((d[k] as Record<string, unknown> | undefined)?.usd);
  const share = (k: string) => pct((d.market_cap_percentage as Record<string, unknown> | undefined)?.[k]);
  const at = num(d.updated_at);
  return { totalMarketCap: usd("total_market_cap"), totalVolume: usd("total_volume"), btcDominance: share("btc"), ethDominance: share("eth"), change24h: pct(d.market_cap_change_percentage_24h_usd), coins: num(d.active_cryptocurrencies), updatedAt: at ? new Date(at * 1000).toISOString() : new Date().toISOString() };
}

export const globalStats = () => get("/global", "global", 5 * MIN, parseGlobal);

/* ---------------- One token ---------------- */

export type TokenInfo = {
  id: string; symbol: string; name: string; description: string; categories: string[]; homepage: string; genesis: string | null;
  /** Contract addresses by CoinGecko platform name ("ethereum", "base", "solana"…). */
  platforms: Record<string, string>;
  price: number | null; marketCap: number | null; fdv: number | null; volume24h: number | null;
  circulating: number | null; total: number | null; max: number | null; ath: number | null; athDate: string | null;
  d1: number | null; d7: number | null; d30: number | null; y1: number | null; updatedAt: string;
};

/** CoinGecko /coins/{id}, normalised. Pure, for tests. */
export function parseCoin(raw: unknown): TokenInfo {
  const r = (raw ?? {}) as Record<string, unknown>;
  const m = (r.market_data ?? {}) as Record<string, unknown>;
  const usd = (k: string) => num((m[k] as Record<string, unknown> | undefined)?.usd);
  const links = (r.links ?? {}) as Record<string, unknown>;
  const desc = str((r.description as Record<string, unknown> | undefined)?.en).replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  const platforms: Record<string, string> = {};
  for (const [k, v] of Object.entries((r.platforms ?? {}) as Record<string, unknown>)) if (k && typeof v === "string" && v) platforms[k] = v;
  return {
    id: str(r.id), symbol: str(r.symbol).toUpperCase(), name: str(r.name), description: desc.slice(0, 1200), categories: arr<unknown>(r.categories).map(str).filter(Boolean).slice(0, 8),
    homepage: arr<unknown>(links.homepage).map(webUrl).find(Boolean) ?? "", genesis: str(r.genesis_date) || null, platforms,
    price: usd("current_price"), marketCap: usd("market_cap"), fdv: usd("fully_diluted_valuation"), volume24h: usd("total_volume"),
    circulating: num(m.circulating_supply), total: num(m.total_supply), max: num(m.max_supply), ath: usd("ath"), athDate: str((m.ath_date as Record<string, unknown> | undefined)?.usd) || null,
    d1: pct(m.price_change_percentage_24h), d7: pct(m.price_change_percentage_7d), d30: pct(m.price_change_percentage_30d), y1: pct(m.price_change_percentage_1y),
    updatedAt: str(r.last_updated) || new Date().toISOString(),
  };
}

export function tokenInfo(id: string, tier: Tier = "free"): Promise<TokenInfo> {
  const q = "localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=false";
  return get(`/coins/${encodeURIComponent(id)}?${q}`, `coin:${id}`, 10 * MIN, parseCoin, tier);
}

export type Close = { date: string; close: number };

/** Daily closes from /market_chart, one per day (the last point of each day), oldest first. Pure, for tests. */
export function parseChart(raw: unknown): Close[] {
  const byDay = new Map<string, number>();
  for (const p of arr<unknown[]>((raw as { prices?: unknown })?.prices)) {
    const t = num(p?.[0]), v = num(p?.[1]);
    if (t !== null && v !== null && v > 0) byDay.set(new Date(t).toISOString().slice(0, 10), v);
  }
  return [...byDay.entries()].map(([date, close]) => ({ date, close })).sort((a, b) => (a.date < b.date ? -1 : 1));
}

/** A year of daily closes in dollars. Cached six hours: the history is for volatility and correlations, not the quote. */
export function tokenHistory(id: string, days = 365, tier: Tier = "free"): Promise<Close[]> {
  return get(`/coins/${encodeURIComponent(id)}/market_chart?vs_currency=usd&days=${days}&interval=daily`, `chart:${id}:${days}`, 6 * HOUR, parseChart, tier);
}

/** Dollar prices for many CoinGecko ids at once, with the day's change. */
export function simplePrices(ids: string[]): Promise<Record<string, { usd: number; d1: number | null }>> {
  const list = [...new Set(ids.filter(Boolean))].sort();
  if (!list.length) return Promise.resolve({});
  return get(`/simple/price?ids=${list.join(",")}&vs_currencies=usd&include_24hr_change=true`, `simple:${list.join(",")}`, 2 * MIN, (raw: Record<string, { usd?: unknown; usd_24h_change?: unknown }>) => {
    const out: Record<string, { usd: number; d1: number | null }> = {};
    for (const [k, v] of Object.entries(raw ?? {})) { const p = num(v?.usd); if (p !== null) out[k] = { usd: p, d1: pct(v?.usd_24h_change) }; }
    return out;
  });
}

/* ---------------- Finding a token ---------------- */

/**
 * A CoinGecko id from what a person typed: an id ("uniswap"), a symbol ("UNI", the largest token with
 * it wins, so "ETH" is Ethereum and not a copycat), or a name. Checks the top 250 first, then search.
 */
export async function resolveToken(q: string): Promise<{ id: string; symbol: string; name: string } | null> {
  const s = q.trim().toLowerCase();
  if (!s) return null;
  const top = await tokenMarkets({ perPage: 250 }).catch(() => [] as TokenRow[]);
  const hit = top.find((t) => t.id === s) ?? top.find((t) => t.symbol.toLowerCase() === s) ?? top.find((t) => t.name.toLowerCase() === s);
  if (hit) return { id: hit.id, symbol: hit.symbol, name: hit.name };
  const found = await get(`/search?query=${encodeURIComponent(s)}`, `search:${s}`, 6 * HOUR, (raw: { coins?: unknown[] }) =>
    arr<Record<string, unknown>>(raw?.coins).map((c) => ({ id: str(c.id), symbol: str(c.symbol).toUpperCase(), name: str(c.name), rank: num(c.market_cap_rank) })));
  const best = found.find((c) => c.symbol.toLowerCase() === s && c.rank !== null) ?? found.find((c) => c.id === s) ?? found[0];
  return best ? { id: best.id, symbol: best.symbol, name: best.name } : null;
}

export async function requireToken(q: string) {
  const t = await resolveToken(q);
  if (!t) throw new CryptoDataError(`No token matches "${q.slice(0, 40)}". Try its symbol (ETH) or CoinGecko id (ethereum).`, 404);
  return t;
}

export const marketCite = (asOf?: string): Cite => ({ name: COINGECKO.name, url: "https://www.coingecko.com/", asOf });
export { coingeckoCoin };
