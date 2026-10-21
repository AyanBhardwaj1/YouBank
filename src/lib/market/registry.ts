/**
 * Every data source, by dataset, in one place (docs/data-layer.md). Each dataset has an ordered list of
 * provider adapters: the default (shared) order, and apart from it the adapters a person's own keys
 * unlock (USER_KEY_ADAPTERS, byo/adapters.ts). The fallback, hedging, breakers, budgets, stale copies and
 * telemetry run over that list generically (chain.ts, source.ts, cache.ts), so adding a source is one
 * entry here.
 *
 * Every adapter declares what it is (sources-meta.ts): its licence (public, attribution, owner-licensed,
 * user-key, unverified), the credit it requires, its exchange delay, and the fields it can fill.
 *
 * Whose order: a request made for a person (user-context.ts: `withDataUser`) uses that person's order
 * per dataset, this view's one-off source (`AAPL GP @tiingo`, the "Source ▾" chip) first, and appends the
 * sources their keys unlock. A source they named that cannot answer here (no key, a background job,
 * shared data, switched off) is skipped with the reason, in provenance. Shared code (`publicOnly`) and
 * jobs use the default order. When the answering source leaves a field empty, the next eligible source
 * that can fill it is asked (fields.ts), and the field says where it came from, or why it is empty.
 *
 * Some datasets are "staged": their screens run several requests per source and merge them
 * (src/lib/crypto/* for crypto markets and DeFi; the news pipeline). Their adapters are listed so the list
 * is complete, and the screens still run them in the default order.
 */
import type { CompanyFacts } from "@/lib/edgar/facts";
import { getCompanyFacts } from "@/lib/edgar/facts";
import { getSubmissions } from "@/lib/edgar/submissions";
import { fmpProfile } from "@/lib/fmp/client";
import type { MoverRow } from "@/lib/terminal/markets";
import type { Deal } from "./fmp";
import { barsEntry, barsFrom, quoteEntry, type Bar } from "./fmp";
import { quoteOf } from "./fmp-schema";
import { BLS_SERIES, blsSeries, type BlsObs } from "./bls";
import { USER_KEY_ADAPTERS as KEYED } from "./byo/adapters";
import type { Profile } from "./canonical";
import { cotPositioning, type Positioning } from "./cftc";
import { runChain, isEmptyAnswer, type Attempt } from "./chain";
import { eiaSpot, eiaSpotCovers, PINK_SHEET, pinkSheetCovers, pinkSheetMonthly } from "./commodity-sources";
import { h10Covers, h10Pair, h15Curves } from "./fed";
import { FIELD_SPECS, isEmptyValue, mergeFields, missingFields, type FieldProvenance, type FieldSource, type Filler } from "./fields";
import { coinGeckoHistory, ecbPair } from "./free";
import { fredSeries, MACRO_SERIES, type Obs } from "./fred";
import { isCommodity, isCrypto, isFxPair, nyseSession, PROXIES } from "./kinds";
import { beaCovers, beaSeries, blsCovers, blsDisplay, EIA_FOR_FRED, eiaCovers, eiaSeries, treasuryCovers, treasurySeries } from "./macro-sources";
import { backupEnabled, nasdaqHistory, nasdaqQuote, nasdaqSummary } from "./nasdaq";
import { noteAdapter, noteFields, noteSkipped, noteSource, type AnsweredBy, type Provider, type Skipped, type SourceMeta } from "./provenance";
import { quoteMeta } from "./quote-meta";
import { secDeals, secDividendData, secEarnings, secProfile } from "./sec-sources";
import { DATASETS, metaOf, type DatasetName, type KeyProvider, type Licence, type SourceId } from "./sources-meta";
import type { AnalystData, DividendData, EarningsData } from "./street-types";
import { canonical } from "./symbols";
import { treasuryCurves, type CurveRow } from "./treasury";
import { dataUser, inForModel, keyedEligibility, NOT_FOR_AI } from "./user-context";

/* ---------------- Types ---------------- */

export type ChainOptions = {
  /** Adapter ids to try first, in this order (unknown ids are ignored); the rest follow in default order. */
  prefer?: string[];
  /** Adapter ids never to use for this request. */
  exclude?: string[];
  /** Adapter ids to try after the default order (the sources a person's keys unlock). */
  append?: string[];
};

/** One adapter's answer: the data, plus what provenance should say about it. `label` names a stand-in in words ("S&P 500 via SPY"). */
export type Answer<R> = {
  data: R; note?: string; via?: string; label?: string; meta?: SourceMeta;
  /** Why fields this source cannot fill are empty ("SEC filings carry no market price"). */
  reasons?: Record<string, string>;
  /** Fetched with the person's own key. */
  yourKey?: boolean;
};

/** How an adapter is called: `fill` when it is asked only to fill another source's empty fields (no paid lookups then). */
export type FetchContext = { fill?: boolean };

export type Adapter<A, R> = {
  /** Stable id (preferences, `@source` and provenance use it): "fmp", "nasdaq", "sec". */
  id: SourceId;
  /** Its name for people: "Financial Modeling Prep". */
  label: string;
  /** The provenance provider it reports as (the screen badge). */
  provider: Provider;
  /** Breaker and stats key. */
  source: string;
  /** Free to use (no paid plan behind it). */
  free: boolean;
  /** Under what terms its data may be shown (sources-meta.ts). */
  licence: Licence;
  /** The credit shown wherever its data is shown. */
  attribution: string;
  /** Exchange delay in minutes for a price feed, null when not a price feed or it depends on the plan. */
  delayedMinutes: number | null;
  /** The fields of the dataset's answer it can fill. */
  fields: string[];
  /** Fetched only from the person's browser. */
  browserOnly?: boolean;
  /** For a user-key adapter: whose key. */
  keyProvider?: KeyProvider;
  /** The environment variable it needs, when it needs one (informational). */
  needsKey?: string;
  /** An owner setting it cannot run without: skipped, with the reason, when unset. */
  requires?: string;
  /** False when its terms bar caching (FRED): kept for one request at most. */
  persistentCache?: boolean;
  /** True when its terms bar AI use (FRED): never asked for anything a model will read (forModel). */
  noAi?: boolean;
  /** False when it may not be asked just to fill another source's fields (paid lookups). */
  fills?: boolean;
  /** A backup: off when MARKET_BACKUP=off (the unverified sources only). */
  backup?: boolean;
  /** Whether it can answer these arguments at all (the ECB: currency pairs only). */
  covers?: (args: A) => boolean;
  /** The request. Null or an empty answer means "not here": the next adapter is asked. Absent on staged datasets. */
  fetch?: (args: A, ctx?: FetchContext) => Promise<Answer<R> | null>;
  /** For a staged dataset: the module that runs it. */
  staged?: string;
};

export type { Profile };
/** A latest quote: price and the day's change as a fraction (null when the feed has none), with its as-of. */
export type LiveQuote = { price: number; changePct: number | null; asOf: string | null; source: Provider };
type BarsArgs = { symbol: string; from: string };
type Sym = { symbol: string };
type Sectors = { date: string; sectors: { sector: string; d1: number; m1: number | null; ytd: number | null }[]; via?: string };
type Movers = { actives: MoverRow[]; gainers: MoverRow[]; losers: MoverRow[] };
type None = Record<string, never>;

export type Datasets = {
  "daily-bars": { args: BarsArgs; result: Bar[] };
  fx: { args: BarsArgs; result: Bar[] };
  commodity: { args: BarsArgs; result: Bar[] };
  crypto: { args: BarsArgs; result: Bar[] };
  intraday: { args: Sym; result: Bar[] };
  quote: { args: Sym & { ttlMs?: number }; result: LiveQuote };
  profile: { args: Sym; result: Profile };
  fundamentals: { args: { cik: string }; result: CompanyFacts };
  filings: { args: { cik: string }; result: Awaited<ReturnType<typeof getSubmissions>> };
  estimates: { args: Sym; result: unknown };
  earnings: { args: Sym; result: EarningsData };
  analysts: { args: Sym; result: AnalystData };
  dividends: { args: Sym; result: DividendData };
  deals: { args: None; result: { deals: Deal[]; via?: string } };
  movers: { args: None; result: Movers };
  sectors: { args: None; result: Sectors };
  curve: { args: None; result: CurveRow[] };
  macro: { args: { series: string; start?: string }; result: (Obs | BlsObs)[] };
  cot: { args: None; result: Record<string, Positioning> };
  "crypto-market": { args: None; result: unknown };
  defi: { args: None; result: unknown };
  news: { args: None; result: unknown };
};
export type DatasetId = keyof Datasets & DatasetName;
type A<D extends DatasetId> = Datasets[D]["args"];
type R<D extends DatasetId> = Datasets[D]["result"];

/* ---------------- ETF stand-ins ---------------- */

/** What each proxied symbol is, for the stand-in label ("S&P 500 via SPY"). */
const PROXY_NAMES: Record<string, string> = {
  "^GSPC": "S&P 500", "^DJI": "Dow Jones Industrial", "^IXIC": "Nasdaq Composite", "^RUT": "Russell 2000", "^GSPTSE": "S&P/TSX Composite", "^BVSP": "Bovespa",
  "^FTSE": "FTSE 100", "^GDAXI": "DAX", "^FCHI": "CAC 40", "^STOXX50E": "Euro Stoxx 50", "^N225": "Nikkei 225", "^HSI": "Hang Seng", "000001.SS": "Shanghai Composite",
  "^AXJO": "ASX 200", GCUSD: "Gold", SIUSD: "Silver", CLUSD: "WTI crude", BZUSD: "Brent crude", NGUSD: "Natural gas", HGUSD: "Copper", ZCUSX: "Corn", ZWUSX: "Wheat",
};

/** "S&P 500 via SPY": an ETF standing in for an index or commodity is never shown as its level without this. */
export const standInLabel = (symbol: string): string | undefined => (PROXIES[symbol] ? `${PROXY_NAMES[symbol] ?? symbol} via ${PROXIES[symbol]}` : undefined);

/* ---------------- Adapters ---------------- */

const asBars = (xs: { date: string; close: number }[]): Bar[] => xs.map((x) => ({ date: x.date, open: x.close, high: x.close, low: x.close, close: x.close, volume: 0 }));
const iso = (ms: number) => new Date(ms).toISOString();
/** Backups fetch the canonical range (one cache key per symbol) and slice. */
const canonicalFrom = (from: string) => (from < barsFrom() ? from : barsFrom());

const BAR_FIELDS = ["open", "high", "low", "close", "volume"];
const CLOSE = ["close"];
const QUOTE_FIELDS = ["price", "changePct"];
const PROFILE_FIELDS = ["name", "price", "changePct", "marketCap", "low52", "high52", "exchange", "sector", "industry", "description", "website"];
const STREET_FIELDS = { earnings: ["quarters", "next", "annual"], analysts: ["target", "counts", "firms"] };

const FMP = { ...metaOf("fmp"), provider: "FMP", source: "fmp", free: false, needsKey: "FMP_API_KEY" } as const;
const NASDAQ = { ...metaOf("nasdaq"), provider: "Nasdaq", source: "nasdaq", free: true, backup: true } as const;
const SEC = { ...metaOf("sec"), provider: "SEC EDGAR", source: "sec", free: true } as const;
const RESEARCH = { ...metaOf("ai-research"), provider: "AI research", source: "ai-research", free: false, needsKey: "OPENAI_API_KEY", backup: true, fills: false } as const;
const ECB = { ...metaOf("ecb"), provider: "ECB", source: "ecb", free: true } as const;
const COINGECKO = { ...metaOf("coingecko"), provider: "CoinGecko", source: "coingecko", free: true, backup: true } as const;
const TREASURY = { ...metaOf("treasury"), provider: "US Treasury", source: "treasury", free: true } as const;
/** FRED and the Fed's series read through it: never cached, never for a model (its terms). */
const VIA_FRED = { provider: "FRED", source: "fred", free: true, persistentCache: false, noAi: true } as const;
const FRED = { ...metaOf("fred"), ...VIA_FRED } as const;
const EIA = { ...metaOf("eia"), provider: "EIA", source: "eia", free: true, requires: "EIA_API_KEY" } as const;

const fmpBars: Adapter<BarsArgs, Bar[]> = {
  ...FMP, fields: BAR_FIELDS,
  fetch: async ({ symbol, from }) => {
    const e = await barsEntry(symbol, from);
    return { data: e.bars, meta: { fetchedAt: iso(e.fetchedAt), stale: e.stale } };
  },
};

const nasdaqBars: Adapter<BarsArgs, Bar[]> = {
  ...NASDAQ, fields: BAR_FIELDS,
  covers: ({ symbol }) => !isFxPair(canonical(symbol)) && !isCrypto(symbol),
  fetch: async ({ symbol, from }) => {
    const s = canonical(symbol), target = PROXIES[s] ?? s;
    const bars = (await nasdaqHistory(target, canonicalFrom(from))).filter((b) => b.date >= from);
    if (!bars.length) return null;
    // An ETF standing in for an index or commodity says so, in the data and in the sources note.
    const label = standInLabel(s);
    return { data: bars, via: PROXIES[s], label, note: label };
  },
};

const ecbBars: Adapter<BarsArgs, Bar[]> = {
  ...ECB, fields: CLOSE,
  covers: ({ symbol }) => isFxPair(canonical(symbol)),
  fetch: async ({ symbol, from }) => {
    const s = canonical(symbol);
    const xs = (await ecbPair(s, canonicalFrom(from))).filter((x) => x.date >= from);
    return xs.length ? { data: asBars(xs), via: "ECB fixing", note: `${s} from the ECB's daily reference rates` } : null;
  },
};

const h10Bars: Adapter<BarsArgs, Bar[]> = {
  ...metaOf("h10"), ...VIA_FRED, fields: CLOSE,
  covers: ({ symbol }) => h10Covers(symbol),
  fetch: async ({ symbol, from }) => {
    const xs = await h10Pair(symbol, from);
    return xs.length ? { data: asBars(xs), via: "Fed H.10", note: `${canonical(symbol)} from the Fed's H.10 noon buying rates (via FRED)` } : null;
  },
};

const coinGeckoBars: Adapter<BarsArgs, Bar[]> = {
  ...COINGECKO, fields: CLOSE,
  covers: ({ symbol }) => isCrypto(symbol),
  fetch: async ({ symbol, from }) => {
    const xs = (await coinGeckoHistory(canonical(symbol))).filter((x) => x.date >= from);
    return xs.length ? { data: asBars(xs) } : null;
  },
};

const eiaBars: Adapter<BarsArgs, Bar[]> = {
  ...EIA, fields: CLOSE,
  covers: ({ symbol }) => eiaSpotCovers(symbol),
  fetch: async ({ symbol, from }) => {
    const xs = await eiaSpot(symbol, from);
    return xs.length ? { data: asBars(xs), via: "EIA spot", label: `${PROXY_NAMES[canonical(symbol)] ?? symbol}: EIA spot price`, note: `${canonical(symbol)} from the EIA's daily spot price (not the futures price)` } : null;
  },
};

const worldBankBars: Adapter<BarsArgs, Bar[]> = {
  ...metaOf("worldbank"), provider: "World Bank", source: "worldbank", free: true, fields: CLOSE,
  covers: ({ symbol }) => pinkSheetCovers(symbol),
  fetch: async ({ symbol, from }) => {
    const xs = await pinkSheetMonthly(symbol, from);
    const name = PINK_SHEET[canonical(symbol)]?.name ?? symbol;
    return xs.length ? { data: asBars(xs), via: "World Bank monthly", label: `${name}: World Bank monthly average`, note: `${name} from the World Bank's monthly Pink Sheet (monthly averages, not daily prices)` } : null;
  },
};

/** FMP's quote in the canonical units (fraction change), its own timestamp as the as-of, judged against the NYSE session when the symbol trades on it. */
const fmpQuote: Adapter<Sym & { ttlMs?: number }, LiveQuote> = {
  ...FMP, fields: QUOTE_FIELDS,
  fetch: async ({ symbol, ttlMs }) => {
    const e = await quoteEntry(symbol, ttlMs);
    if (!e.quote) return null;
    const q = quoteOf(e.quote), m = quoteMeta(q.asOf, false, nyseSession(symbol));
    return { data: { price: q.price, changePct: q.changePct, asOf: q.asOf, source: "FMP" }, meta: { ...m, fetchedAt: iso(e.fetchedAt), stale: e.stale || !!m.stale } };
  },
};

const nasdaqQuoteAdapter: Adapter<Sym & { ttlMs?: number }, LiveQuote> = {
  ...NASDAQ, fields: QUOTE_FIELDS,
  covers: ({ symbol }) => { const s = canonical(symbol); return !isFxPair(s) && !isCrypto(s) && !PROXIES[s]; },
  fetch: async ({ symbol }) => {
    const q = await nasdaqQuote(symbol).catch(() => null);
    return q ? { data: { price: q.price, changePct: q.changePct, asOf: q.asOf, source: "Nasdaq" }, meta: quoteMeta(q.asOf, q.delayed, true) } : null;
  },
};

/** FMP's profile (canonical shape); its as-of is when FMP answered, kept through the cache. */
const fmpProfileAdapter: Adapter<Sym, Profile> = {
  ...FMP, fields: PROFILE_FIELDS,
  fetch: async ({ symbol }) => {
    const p = await fmpProfile(symbol);
    return p ? { data: p, meta: { ...(p.asOf ? { asOf: p.asOf } : {}), ...(p.fetchedAt ? { fetchedAt: p.fetchedAt } : {}), stale: !!p.stale } } : null;
  },
};

/**
 * Nasdaq's quote and summary as a profile. Nasdaq has no description or website; those stay empty, and
 * missing figures stay null (never 0). The price keeps Nasdaq's own trade time as its as-of.
 */
const nasdaqProfile: Adapter<Sym, Profile> = {
  ...NASDAQ, fields: ["name", "price", "changePct", "marketCap", "low52", "high52", "exchange", "sector", "industry"],
  fetch: async ({ symbol }) => {
    const [q, s] = await Promise.all([nasdaqQuote(symbol).catch(() => null), nasdaqSummary(symbol).catch(() => null)]);
    if (!q) return null;
    const fetchedAt = new Date().toISOString();
    return {
      data: {
        symbol: canonical(symbol), name: q.name, price: q.price, change: q.change, changePct: q.changePct, marketCap: s?.marketCap ?? null,
        low52: s?.low52 ?? null, high52: s?.high52 ?? null, exchange: s?.exchange || q.exchange, industry: s?.industry ?? "", sector: s?.sector ?? "", website: "", description: "",
        source: "Nasdaq", asOf: q.asOf ?? fetchedAt, fetchedAt, delayed: q.delayed,
      },
      meta: quoteMeta(q.asOf ?? fetchedAt, q.delayed, true),
    };
  },
};

const secProfileAdapter: Adapter<Sym, Profile> = { ...SEC, fields: ["name", "exchange", "sector", "industry"], fetch: async ({ symbol }) => secProfile(symbol) };

/** The market-wide and Street screens' per-source requests live with the screens (lazy, so this module stays a leaf). */
const markets = () => import("@/lib/terminal/markets");
const street = () => import("@/lib/terminal/street");

const earnings: Adapter<Sym, EarningsData>[] = [
  { ...FMP, fields: STREET_FIELDS.earnings, fetch: async ({ symbol }) => (await street()).fmpEarningsData(symbol) },
  { ...NASDAQ, fields: STREET_FIELDS.earnings, fetch: async ({ symbol }, ctx) => (await street()).nasdaqEarningsData(symbol, ctx) },
  { ...SEC, fields: ["quarters"], fetch: async ({ symbol }) => secEarnings(symbol) },
  { ...RESEARCH, fields: ["quarters", "next"], fetch: async ({ symbol }) => (await street()).researchEarningsData(symbol) },
];
const analysts: Adapter<Sym, AnalystData>[] = [
  { ...FMP, fields: STREET_FIELDS.analysts, fetch: async ({ symbol }) => (await street()).fmpAnalystData(symbol) },
  { ...NASDAQ, fields: STREET_FIELDS.analysts, fetch: async ({ symbol }) => (await street()).nasdaqAnalystData(symbol) },
  { ...RESEARCH, fields: ["target", "counts"], fetch: async ({ symbol }) => (await street()).researchAnalystData(symbol) },
];
const dividends: Adapter<Sym, DividendData>[] = [
  { ...FMP, fields: ["payments"], fetch: async ({ symbol }) => (await street()).fmpDividendData(symbol) },
  { ...NASDAQ, fields: ["payments"], fetch: async ({ symbol }) => (await street()).nasdaqDividendData(symbol) },
  { ...SEC, fields: ["payments"], fetch: async ({ symbol }) => secDividendData(symbol) },
  { ...RESEARCH, fields: ["ttm", "yield", "payout"], fetch: async ({ symbol }) => (await street()).researchDividendData(symbol) },
];

const macroStart = (start?: string) => start ?? new Date(Date.now() - 12 * 365.25 * 86_400_000).toISOString().slice(0, 10);
const since = (rows: Obs[], start?: string) => (start ? rows.filter((r) => r.date >= start) : rows);

const macro: Adapter<{ series: string; start?: string }, (Obs | BlsObs)[]>[] = [
  { ...metaOf("bls"), provider: "BLS", source: "bls", free: true, fields: ["observations"], covers: ({ series }) => blsCovers(series) || series in BLS_SERIES, fetch: async ({ series, start }) => ({ data: since(blsCovers(series) ? await blsDisplay(series) : (await blsSeries())[series] ?? [], start) }) },
  { ...metaOf("bea"), provider: "BEA", source: "bea", free: true, requires: "BEA_API_KEY", fields: ["observations"], covers: ({ series }) => beaCovers(series), fetch: async ({ series, start }) => ({ data: since(await beaSeries(series), start) }) },
  { ...EIA, fields: ["observations"], covers: ({ series }) => eiaCovers(series), fetch: async ({ series, start }) => ({ data: await eiaSeries(EIA_FOR_FRED[series], macroStart(start)) }) },
  { ...TREASURY, fields: ["observations"], covers: ({ series }) => treasuryCovers(series), fetch: async ({ series, start }) => ({ data: since(await treasurySeries(series), start) }) },
  { ...FRED, fields: ["observations"], covers: ({ series }) => MACRO_SERIES.some((m) => m.id === series), fetch: async ({ series, start }) => ({ data: await fredSeries(series, start) }) },
];

const DEFAULTS = {
  "daily-bars": [fmpBars, nasdaqBars],
  fx: [fmpBars, ecbBars, h10Bars],
  commodity: [fmpBars, eiaBars, nasdaqBars, worldBankBars],
  crypto: [fmpBars, coinGeckoBars],
  intraday: [],
  quote: [fmpQuote, nasdaqQuoteAdapter],
  profile: [fmpProfileAdapter, nasdaqProfile, secProfileAdapter],
  fundamentals: [{ ...SEC, fields: ["income", "balance", "cashflow", "shares"], fetch: async ({ cik }) => ({ data: await getCompanyFacts(cik) }) }],
  filings: [{ ...SEC, fields: ["filings"], fetch: async ({ cik }) => ({ data: await getSubmissions(cik) }) }],
  estimates: [{ ...FMP, fields: ["estimates"], staged: "src/lib/terminal/street.ts" }, { ...NASDAQ, fields: ["estimates"], staged: "src/lib/terminal/street.ts" }, { ...RESEARCH, fields: ["estimates"], staged: "src/lib/terminal/street.ts" }],
  earnings, analysts, dividends,
  deals: [
    { ...FMP, fields: ["deals"], fetch: async () => { const d = await (await markets()).fmpDeals(); return d ? { data: { deals: d } } : null; } },
    { ...SEC, fields: ["deals"], fetch: async () => { const d = await secDeals(); return d.length ? { data: { deals: d, via: "SEC EDGAR merger filings" }, note: "Deals from merger filings on EDGAR" } : null; } },
  ],
  movers: [
    { ...FMP, fields: ["actives", "gainers", "losers"], fetch: async () => { const m = await (await markets()).fmpMovers(); return m ? { data: m } : null; } },
    { ...NASDAQ, fields: ["actives", "gainers", "losers"], fetch: async () => { const m = await (await markets()).nasdaqMoversView(); return m ? { data: m } : null; } },
  ],
  sectors: [
    { ...FMP, fields: ["sectors"], fetch: async () => { const s = await (await markets()).fmpSectors(); return s ? { data: s } : null; } },
    { ...NASDAQ, label: "SPDR sector ETFs on Nasdaq.com", fields: ["sectors"], fetch: async () => { const s = await (await markets()).etfSectors(); return s ? { data: s, note: "Sectors via the SPDR sector ETFs" } : null; } },
  ],
  curve: [
    { ...TREASURY, fields: ["yields"], fetch: async () => ({ data: await treasuryCurves() }) },
    { ...metaOf("h15"), ...VIA_FRED, fields: ["yields"], fetch: async () => { const rows = await h15Curves(); return rows.length ? { data: rows, note: "Treasury yields from the Fed's H.15 (via FRED): the Treasury's feed did not answer" } : null; } },
  ],
  macro,
  cot: [{ ...metaOf("cftc"), provider: "CFTC", source: "cftc", free: true, fields: ["positioning"], fetch: async () => { const p = await cotPositioning(); return Object.keys(p).length ? { data: p } : null; } }],
  "crypto-market": [{ ...COINGECKO, backup: false, fields: ["prices", "marketCaps", "volumes"], staged: "src/lib/crypto/market.ts" }],
  defi: [{ ...metaOf("defillama"), provider: "DefiLlama", source: "defillama", free: true, fields: ["tvl", "stablecoins", "yields", "fees"], staged: "src/lib/crypto/defi.ts" }],
  news: [
    { ...SEC, fields: ["filings"], staged: "src/lib/news/sources/edgar.ts" },
    { ...metaOf("federal-register"), provider: "Federal Register", source: "federal-register", free: true, fields: ["documents"], staged: "src/lib/news/sources/gov.ts" },
    { ...metaOf("gdelt"), provider: "GDELT", source: "gdelt", free: true, fields: ["headlines"], staged: "src/lib/news/sources/gdelt.ts" },
  ],
} satisfies { [D in DatasetId]: Adapter<A<D>, R<D>>[] };

/** Every dataset's adapters in default order (read-only: preferences go through resolveChain). */
export const REGISTRY: { readonly [D in DatasetId]: readonly Adapter<A<D>, R<D>>[] } = DEFAULTS;

/** The adapters a person's own keys unlock, by dataset (never in a default chain). */
export const USER_KEY_ADAPTERS: { readonly [D in DatasetId]?: readonly Adapter<A<D>, R<D>>[] } = KEYED;

/** Every adapter of a dataset: the default chain, then the keyed ones. */
export const adaptersOf = <D extends DatasetId>(dataset: D): readonly Adapter<A<D>, R<D>>[] => [...REGISTRY[dataset], ...(USER_KEY_ADAPTERS[dataset] ?? [])] as Adapter<A<D>, R<D>>[];

/**
 * A dataset's adapters for this request: preferred ids first (in the order given), then the default
 * order, then the appended ones (a person's keyed sources), minus exclusions.
 */
export function resolveChain<D extends DatasetId>(dataset: D, opts: ChainOptions = {}): Adapter<A<D>, R<D>>[] {
  const all = adaptersOf(dataset);
  const exclude = new Set(opts.exclude ?? []);
  const pick = (ids: string[] = []) => ids.map((id) => all.find((a) => a.id === id)).filter((a): a is Adapter<A<D>, R<D>> => !!a);
  return [...new Set([...pick(opts.prefer), ...REGISTRY[dataset], ...pick(opts.append)])].filter((a) => !exclude.has(a.id)) as Adapter<A<D>, R<D>>[];
}

/* ---------------- Eligibility ---------------- */

export const BACKUP_OFF = "Switched off on this server (unverified backups are off).";
export const NOT_SET_UP = "Not set up on this server yet.";

/** Whether an adapter may answer here, and if not, why (in words people read). */
export function eligibility(a: Pick<Adapter<unknown, unknown>, "licence" | "keyProvider" | "backup" | "requires" | "noAi">): { ok: true } | { ok: false; reason: string } {
  if (a.licence === "user-key") return keyedEligibility(a.keyProvider!);
  if (a.noAi && inForModel()) return { ok: false, reason: NOT_FOR_AI };
  if (a.backup && !backupEnabled()) return { ok: false, reason: BACKUP_OFF };
  if (a.requires && !process.env[a.requires]?.trim()) return { ok: false, reason: NOT_SET_UP };
  return { ok: true };
}

/** This request's order for a dataset: the view's own source, the caller's, the person's, then their keyed sources. */
function orderFor(dataset: DatasetId, opts: ChainOptions): ChainOptions & { named: Set<string> } {
  const u = dataUser();
  const view = u?.override?.dataset === dataset ? [u.override.id] : [];
  const prefer = [...view, ...(opts.prefer ?? []), ...(u?.order[dataset] ?? [])];
  const append = (USER_KEY_ADAPTERS[dataset] ?? []).filter((a) => a.keyProvider && u?.keyed.has(a.keyProvider)).map((a) => a.id);
  return { prefer, append, exclude: opts.exclude, named: new Set([...view, ...(u?.order[dataset] ?? [])]) };
}

/** `rank`: the skipped source's place in the chain, so only the ones ranked ahead of the answer are reported. */
export type Plan<D extends DatasetId> = { run: Adapter<A<D>, R<D>>[]; skipped: (Skipped & { rank: number })[]; rankOf: (a: Adapter<A<D>, R<D>>) => number };

/**
 * The adapters that will be asked, in order, and the ones the person named that cannot answer here
 * (with the reason). Sources that do not cover the request (the ECB for a stock) are left out silently.
 */
export function planChain<D extends DatasetId>(dataset: D, args: A<D>, opts: ChainOptions = {}): Plan<D> {
  const order = orderFor(dataset, opts);
  const chain = resolveChain(dataset, order);
  const run: Adapter<A<D>, R<D>>[] = [], skipped: Plan<D>["skipped"] = [];
  chain.forEach((a, rank) => {
    if (!a.fetch || (a.covers && !a.covers(args))) return;
    const e = eligibility(a);
    if (e.ok) run.push(a);
    else if (order.named.has(a.id) || a.licence === "user-key") skipped.push({ dataset, id: a.id, label: a.label, reason: e.reason, rank });
  });
  const view = dataUser()?.override;
  if (view?.dataset === dataset && !adaptersOf(dataset).some((a) => a.id === view.id)) skipped.push({ dataset, id: view.id, label: metaOf(view.id).label, reason: `Does not provide ${DATASETS[dataset].label.toLowerCase()}.`, rank: -1 });
  return { run, skipped, rankOf: (a) => chain.indexOf(a) };
}

/* ---------------- The chain ---------------- */

/** Nothing in the chain covers the request (every source excluded, switched off or not covering it). */
export class NoSourceError extends Error { constructor(dataset: string) { super(`No source covers ${dataset} for this`); this.name = "NoSourceError"; } }

export type Answered<R> = Answer<R> & { by: AnsweredBy; provider: Provider; fields?: Record<string, FieldProvenance> };

/** Datasets whose backups cost money or many calls (AI research, several Nasdaq requests): no hedge, the next source starts only when one fails. */
const NO_HEDGE = new Set<DatasetId>(["earnings", "analysts", "dividends"]);
/** At most this many more sources are asked to fill one answer's empty fields. */
const MAX_FILL_SOURCES = 2;

/** An adapter as provenance names it: id, label, provider, licence, credit, and "your key". */
type Named = Pick<Adapter<unknown, unknown>, "id" | "label" | "provider" | "licence" | "attribution">;
const byOf = (a: Named, yourKey?: boolean): AnsweredBy => ({ id: a.id, label: a.label, provider: a.provider, licence: a.licence, attribution: a.attribution, ...(yourKey ? { yourKey: true } : {}) });
const fieldSourceOf = (a: Named, yourKey?: boolean): FieldSource => ({ id: a.id, label: a.label, licence: a.licence, ...(yourKey ? { yourKey: true } : {}) });

/** The first valid answer from `run`, with fallback on any failure and hedging on interactive requests (not for NO_HEDGE datasets). */
async function firstAnswer<D extends DatasetId>(dataset: D, run: Adapter<A<D>, R<D>>[], args: A<D>) {
  const attempts: Attempt<{ a: Adapter<A<D>, R<D>>; ans: Answer<R<D>> | null }>[] = run.map((a) => ({
    id: a.id, source: a.source, op: dataset, label: a.label, wrap: false,
    run: async () => ({ a, ans: await a.fetch!(args) }),
    valid: ({ ans }) => !!ans && (!Array.isArray(ans.data) || ans.data.length > 0),
  }));
  const { value, index } = await runChain(attempts, NO_HEDGE.has(dataset) ? { hedgeDelayMs: null } : {});
  return { a: value.a, ans: value.ans!, index };
}

/**
 * Fill the answer's empty fields from the next eligible sources that can (fields.ts), noting each
 * field's provenance. Only sources after the one that answered are asked (`later`): the ones before it
 * failed or were hedged past in this request.
 */
async function fillFields<D extends DatasetId>(dataset: D, args: A<D>, a: Adapter<A<D>, R<D>>, ans: Answer<R<D>>, run: Adapter<A<D>, R<D>>[]) {
  const spec = FIELD_SPECS[dataset];
  if (!spec) {
    const reasons = Object.fromEntries(Object.entries(ans.reasons ?? {}).map(([f, reason]) => [f, { reason }]));
    if (Object.keys(reasons).length) noteFields(dataset, reasons);
    return { data: ans.data, fields: reasons as Record<string, FieldProvenance> };
  }
  const missing = missingFields(ans.data, spec);
  const later: (Filler<R<D>> & { a: Adapter<A<D>, R<D>> })[] = [];
  const candidates = missing.length ? run.filter((b) => b.fills !== false && b.fields.some((f) => missing.includes(f))).slice(0, MAX_FILL_SOURCES) : [];
  for (const b of candidates) {
    const got = await b.fetch!(args, { fill: true }).catch(() => null);
    if (got) later.push({ data: got.data, source: fieldSourceOf(b, got.yourKey), a: b });
    if (missing.every((f) => later.some((l) => !isEmptyValue((l.data as Record<string, unknown>)[f])))) break;
  }
  const merged = mergeFields({ data: ans.data, source: fieldSourceOf(a, ans.yourKey), reasons: ans.reasons }, later, spec);
  for (const l of later) if (Object.values(merged.fields).some((p) => "id" in p && p.id === l.a.id)) { noteSource(l.a.provider); noteAdapter(byOf(l.a, l.source.yourKey)); }
  noteFields(dataset, merged.fields);
  return merged;
}

/**
 * The first valid answer for `dataset` from this request's chain (planChain: the person's order, the
 * view's source, their keyed sources), with fallback on any failure, hedging on interactive requests,
 * empty fields filled from the next eligible sources, and the answer's sources noted in provenance.
 * Rejects with the first source's own error when every source fails; with an empty-answer error when
 * none had data; with NoSourceError when none may answer.
 */
export async function fromChain<D extends DatasetId>(dataset: D, args: A<D>, opts: ChainOptions = {}): Promise<Answered<R<D>>> {
  const { run, skipped, rankOf } = planChain(dataset, args, opts);
  // Sources ranked after the one that answers do not matter to this answer: only those ahead are reported.
  const note = (before: number) => skipped.filter((k) => k.rank < before).forEach((k) => noteSkipped({ dataset: k.dataset, id: k.id, label: k.label, reason: k.reason }));
  if (!run.length) { note(Infinity); throw new NoSourceError(dataset); }
  let won: Awaited<ReturnType<typeof firstAnswer<D>>>;
  try { won = await firstAnswer(dataset, run, args); } catch (e) { note(Infinity); throw e; }
  const { a, ans, index } = won;
  note(rankOf(a));
  const merged = await fillFields(dataset, args, a, ans, run.slice(index + 1));
  noteSource(a.provider, ans.note, ans.meta);
  noteAdapter(byOf(a, ans.yourKey));
  return { ...ans, data: merged.data, by: byOf(a, ans.yourKey), provider: a.provider, ...(Object.keys(merged.fields).length ? { fields: merged.fields } : {}) };
}

/** Every adapter of a dataset for this request with whether it may answer and why not (the settings page and its Test). */
export function explainChain<D extends DatasetId>(dataset: D, opts: ChainOptions = {}) {
  const order = orderFor(dataset, opts);
  const all = resolveChain(dataset, { ...order, append: (USER_KEY_ADAPTERS[dataset] ?? []).map((a) => a.id) });
  return all.map((a) => ({ id: a.id, label: a.label, licence: a.licence, staged: !!a.staged, ...eligibility(a) }));
}

export { isEmptyAnswer, isCommodity };
