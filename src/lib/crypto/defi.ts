/**
 * DeFi from DefiLlama's open API: value locked by chain and protocol, stablecoin supply and flows,
 * fees and revenue (the cash flows token valuation starts from), lending and pool yields, and
 * tokenized real-world assets. Server only.
 *
 * DefiLlama's payloads are large (the yields list is megabytes), so each is cut down to what the
 * screens use before it is cached, and cached for up to an hour: these figures move by the day.
 */
import { arr, cachedJson, HOUR, num, str } from "./http";
import { llamaPage, llamaProtocol, type Cite } from "./sources";

const API = "https://api.llama.fi";
const STABLES = "https://stablecoins.llama.fi";
const YIELDS = "https://yields.llama.fi";
const SRC = "DefiLlama";
const pct = (v: unknown) => { const n = num(v); return n === null ? null : n / 100; };

/* ---------------- Protocols and chains ---------------- */

export type Protocol = {
  name: string; slug: string; symbol: string; category: string; chains: string[]; tvl: number | null;
  d1: number | null; d7: number | null; mcap: number | null; geckoId: string | null; url: string;
};

/** /protocols, normalised and sorted by TVL. Pure, for tests. */
export function parseProtocols(raw: unknown): Protocol[] {
  return arr<Record<string, unknown>>(raw).filter((p) => p && typeof p.name === "string").map((p) => ({
    name: str(p.name), slug: str(p.slug) || str(p.name).toLowerCase().replace(/\s+/g, "-"), symbol: str(p.symbol) === "-" ? "" : str(p.symbol),
    category: str(p.category), chains: arr<unknown>(p.chains).map(str).filter(Boolean), tvl: num(p.tvl), d1: pct(p.change_1d), d7: pct(p.change_7d),
    mcap: num(p.mcap), geckoId: str(p.gecko_id) || null, url: str(p.url),
  })).sort((a, b) => (b.tvl ?? 0) - (a.tvl ?? 0));
}

/** Every protocol (about 4,000 with TVL; the long tail under $100k is dropped before caching). */
export const protocols = () => cachedJson(`${API}/protocols`, { key: "crypto:llama:protocols:v1", ttlMs: HOUR, source: SRC, timeoutMs: 25_000 }, (raw: unknown) => parseProtocols(raw).filter((p) => (p.tvl ?? 0) >= 100_000 || p.category === "RWA"));

export type ChainTvl = { name: string; tvl: number; symbol: string; geckoId: string | null };

export const chainTvls = () => cachedJson(`${API}/v2/chains`, { key: "crypto:llama:chains:v1", ttlMs: HOUR, source: SRC }, (raw: unknown) =>
  arr<Record<string, unknown>>(raw).map((c) => ({ name: str(c.name), tvl: num(c.tvl) ?? 0, symbol: str(c.tokenSymbol), geckoId: str(c.gecko_id) || null })).filter((c) => c.tvl > 0).sort((a, b) => b.tvl - a.tvl));

/** Total DeFi TVL by day (the last 365). */
export const tvlHistory = () => cachedJson(`${API}/v2/historicalChainTvl`, { key: "crypto:llama:tvlhist:v1", ttlMs: HOUR, source: SRC }, (raw: unknown) =>
  arr<Record<string, unknown>>(raw).map((d) => ({ date: new Date((num(d.date) ?? 0) * 1000).toISOString().slice(0, 10), tvl: num(d.tvl) ?? 0 })).slice(-365));

/** A protocol's TVL now and by day for a year. */
export function protocolTvl(slug: string) {
  return cachedJson(`${API}/protocol/${encodeURIComponent(slug)}`, { key: `crypto:llama:protocol:${slug}`, ttlMs: HOUR, source: SRC, timeoutMs: 25_000 }, (raw: Record<string, unknown>) => {
    const series = arr<Record<string, unknown>>(raw?.tvl).map((d) => ({ date: new Date((num(d.date) ?? 0) * 1000).toISOString().slice(0, 10), tvl: num(d.totalLiquidityUSD) ?? 0 })).slice(-365);
    const chains: Record<string, number> = {};
    for (const [k, v] of Object.entries((raw?.currentChainTvls ?? {}) as Record<string, unknown>)) if (!/-|staking|pool2|borrowed|treasury|vesting/i.test(k)) { const n = num(v); if (n) chains[k] = n; }
    return { name: str(raw?.name), description: str(raw?.description).slice(0, 800), category: str(raw?.category), url: str(raw?.url), twitter: str(raw?.twitter), series, chains };
  });
}

/** The DefiLlama protocol behind a CoinGecko token, if there is one (Uniswap for "uniswap", Aave for "aave"). */
export async function protocolForGecko(geckoId: string): Promise<Protocol | null> {
  const all = await protocols().catch(() => [] as Protocol[]);
  // Several protocols can share a token (Uniswap V2, V3…); DefiLlama's parent carries the token, else take the largest.
  return all.find((p) => p.geckoId === geckoId) ?? null;
}

/* ---------------- Fees and revenue ---------------- */

export type Cashflow = { name: string; slug: string; category: string; fees24h: number | null; fees30d: number | null; fees1y: number | null; revenue30d: number | null; revenue1y: number | null; holdersRevenue30d: number | null };

type Overview = { protocols?: Record<string, unknown>[] };

/** Fees, revenue and holders' revenue for every protocol, keyed by slug. Pure, for tests. */
export function mergeCashflows(fees: Overview, revenue: Overview, holders: Overview): Cashflow[] {
  const key = (p: Record<string, unknown>) => str(p.slug) || str(p.name).toLowerCase().replace(/\s+/g, "-");
  const rev = new Map(arr<Record<string, unknown>>(revenue?.protocols).map((p) => [key(p), p]));
  const hold = new Map(arr<Record<string, unknown>>(holders?.protocols).map((p) => [key(p), p]));
  return arr<Record<string, unknown>>(fees?.protocols).map((p) => {
    const k = key(p), r = rev.get(k), h = hold.get(k);
    return { name: str(p.displayName) || str(p.name), slug: k, category: str(p.category), fees24h: num(p.total24h), fees30d: num(p.total30d), fees1y: num(p.total1y), revenue30d: num(r?.total30d), revenue1y: num(r?.total1y), holdersRevenue30d: num(h?.total30d) };
  }).filter((c) => (c.fees30d ?? 0) > 0).sort((a, b) => (b.fees30d ?? 0) - (a.fees30d ?? 0));
}

const overview = (dataType: string) => cachedJson(`${API}/overview/fees?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true&dataType=${dataType}`, { key: `crypto:llama:fees:${dataType}`, ttlMs: HOUR, source: SRC, timeoutMs: 25_000 },
  (raw: Overview) => ({ protocols: arr<Record<string, unknown>>(raw?.protocols).map((p) => ({ name: p.name, displayName: p.displayName, slug: p.slug, category: p.category, total24h: p.total24h, total30d: p.total30d, total1y: p.total1y })) }));

export async function cashflows(): Promise<Cashflow[]> {
  const [fees, revenue, holders] = await Promise.all([overview("dailyFees"), overview("dailyRevenue").catch(() => ({})), overview("dailyHoldersRevenue").catch(() => ({}))]);
  return mergeCashflows(fees, revenue, holders);
}

/* ---------------- Stablecoins ---------------- */

export type Stablecoin = { name: string; symbol: string; pegType: string; mechanism: string; supply: number; d1: number | null; d7: number | null; d30: number | null; price: number | null; chains: { chain: string; supply: number }[] };

const pegged = (v: unknown) => num((v as Record<string, unknown> | undefined)?.peggedUSD) ?? num((v as Record<string, unknown> | undefined)?.peggedEUR) ?? 0;

/** /stablecoins, normalised: supply now and its change (the flows), largest chains. Pure, for tests. */
export function parseStablecoins(raw: unknown): Stablecoin[] {
  return arr<Record<string, unknown>>((raw as { peggedAssets?: unknown })?.peggedAssets).map((s) => {
    const supply = pegged(s.circulating);
    const chg = (k: string) => { const prev = pegged(s[k]); return prev > 0 ? supply / prev - 1 : null; };
    const chains = Object.entries((s.chainCirculating ?? {}) as Record<string, { current?: unknown }>).map(([chain, v]) => ({ chain, supply: pegged(v?.current) })).filter((c) => c.supply > 0).sort((a, b) => b.supply - a.supply).slice(0, 6);
    return { name: str(s.name), symbol: str(s.symbol), pegType: str(s.pegType).replace(/^pegged/, ""), mechanism: str(s.pegMechanism), supply, d1: chg("circulatingPrevDay"), d7: chg("circulatingPrevWeek"), d30: chg("circulatingPrevMonth"), price: num(s.price), chains };
  }).filter((s) => s.supply > 1_000_000).sort((a, b) => b.supply - a.supply);
}

export const stablecoins = () => cachedJson(`${STABLES}/stablecoins?includePrices=true`, { key: "crypto:llama:stables:v1", ttlMs: HOUR, source: SRC, timeoutMs: 25_000 }, (raw: unknown) => parseStablecoins(raw).slice(0, 60));

/** Total stablecoin supply by day (dollar-pegged), the last 365. */
export const stablecoinHistory = () => cachedJson(`${STABLES}/stablecoincharts/all`, { key: "crypto:llama:stablehist:v1", ttlMs: HOUR, source: SRC }, (raw: unknown) =>
  arr<Record<string, unknown>>(raw).map((d) => ({ date: new Date((num(d.date) ?? 0) * 1000).toISOString().slice(0, 10), supply: pegged(d.totalCirculatingUSD) })).filter((d) => d.supply > 0).slice(-365));

/* ---------------- Yields ---------------- */

export type Pool = { pool: string; project: string; chain: string; symbol: string; tvl: number; apy: number | null; apyBase: number | null; apyReward: number | null; stable: boolean; ilRisk: string };

/** /pools, normalised: the largest pools by TVL, with APYs as decimals. Pure, for tests. */
export function parsePools(raw: unknown, keep = 300): Pool[] {
  return arr<Record<string, unknown>>((raw as { data?: unknown })?.data).map((p) => ({
    pool: str(p.pool), project: str(p.project), chain: str(p.chain), symbol: str(p.symbol), tvl: num(p.tvlUsd) ?? 0,
    apy: pct(p.apy), apyBase: pct(p.apyBase), apyReward: pct(p.apyReward), stable: p.stablecoin === true, ilRisk: str(p.ilRisk),
  })).filter((p) => p.tvl > 0).sort((a, b) => b.tvl - a.tvl).slice(0, keep);
}

export const pools = () => cachedJson(`${YIELDS}/pools`, { key: "crypto:llama:pools:v1", ttlMs: HOUR, source: SRC, timeoutMs: 30_000 }, (raw: unknown) => parsePools(raw));

/* ---------------- Tokenized real-world assets ---------------- */

export type RwaKind = "treasuries" | "private credit" | "commodities" | "real estate" | "other";
export type RwaRow = Protocol & { kind: RwaKind };

const RWA_RULES: [RwaKind, RegExp][] = [
  ["treasuries", /treasur|t-?bill|buidl|benji|franklin|ousg|usdy|ustb|usyc|superstate|hashnote|backed|spiko|openeden|matrixdock|wisdomtree|mountain|ondo/i],
  ["private credit", /maple|centrifuge|goldfinch|truefi|clearpool|credix|figure|huma|tradable|florence|credit|lend|loan/i],
  ["commodities", /gold|paxg|xaut|tether gold|silver|commodit/i],
  ["real estate", /real ?estate|realt|lofty|propy|homium|estate/i],
];

/** Which kind of real-world asset a protocol tokenizes, from its name and category. Pure, for tests. */
export function rwaKind(p: Pick<Protocol, "name" | "category" | "slug">): RwaKind {
  const text = `${p.name} ${p.slug}`;
  for (const [kind, re] of RWA_RULES) if (re.test(text)) return kind;
  return p.category === "RWA Lending" ? "private credit" : "other";
}

/** Tokenized treasuries, private credit and the rest, from DefiLlama's RWA categories. */
export async function rwaProtocols(): Promise<RwaRow[]> {
  return (await protocols()).filter((p) => p.category === "RWA" || p.category === "RWA Lending").map((p) => ({ ...p, kind: rwaKind(p) }));
}

export const defiCite = (path = ""): Cite => llamaPage(path);
export { llamaProtocol };
