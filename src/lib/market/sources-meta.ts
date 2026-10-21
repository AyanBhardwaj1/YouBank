/**
 * What every data source is, in words people read, and under what terms YouBank may show it
 * (docs/data-layer.md, "Free sources & your own keys"). Pure and dependency-free, so the browser can
 * import it: the settings page, the terminal's "Source ▾" chip and the badges read these labels.
 *
 * The registry (registry.ts) lists which adapters serve which dataset, in which order; this module says
 * what each source id is. A source id is the stable name preferences, `@source` and provenance use.
 *
 * Licences:
 * - `public`: government or public-domain data (SEC, Treasury, BLS, BEA, EIA). Safe to show anyone.
 * - `attribution`: free to show with the stated credit (ECB, World Bank CC BY 4.0, FRED's public-domain
 *   series, which FRED's terms also bar from caching and from AI use).
 * - `owner-licensed`: YouBank's own account with the provider (FMP). Whether that account covers showing
 *   the data to paying users is the owner's contract question (docs/data-layer.md).
 * - `user-key`: the person's own key, used only for that person's own screens (never cached for others,
 *   never in background jobs, never in exports or shared views).
 * - `unverified`: terms not confirmed for a commercial product (Nasdaq.com, CoinGecko, DefiLlama, AI research).
 */

export type Licence = "public" | "attribution" | "owner-licensed" | "user-key" | "unverified";

/** Providers a person can bring a key for. Massive is not offered: its individual terms forbid sharing a key. */
export const KEY_PROVIDERS = ["tiingo", "twelvedata", "alphavantage", "finnhub", "fmp"] as const;
export type KeyProvider = (typeof KEY_PROVIDERS)[number];
export type PlanType = "individual" | "business";
export const PLAN_TYPES: readonly PlanType[] = ["individual", "business"];

export type KeyProviderInfo = {
  label: string;
  /** The adapter id its key unlocks ("fmp" keys unlock "fmp-key", not the owner's "fmp"). */
  sourceId: string;
  /** Individual plans whose terms say "not on behalf of a company": warn a team member who adds one. */
  individualIsPersonalOnly: boolean;
  /** What the key looks like, checked before it is tested (an allowlist, not a secret check). */
  shape: RegExp;
  /** Where the person gets one. A fixed link we show; never fetched. */
  signup: string;
};

export const KEY_PROVIDER_INFO: Record<KeyProvider, KeyProviderInfo> = {
  tiingo: { label: "Tiingo", sourceId: "tiingo", individualIsPersonalOnly: false, shape: /^[A-Za-z0-9]{20,64}$/, signup: "https://www.tiingo.com/account/api/token" },
  twelvedata: { label: "Twelve Data", sourceId: "twelvedata", individualIsPersonalOnly: false, shape: /^[A-Za-z0-9]{16,64}$/, signup: "https://twelvedata.com/account/api-keys" },
  alphavantage: { label: "Alpha Vantage", sourceId: "alphavantage", individualIsPersonalOnly: true, shape: /^[A-Za-z0-9]{8,32}$/, signup: "https://www.alphavantage.co/support/#api-key" },
  finnhub: { label: "Finnhub", sourceId: "finnhub", individualIsPersonalOnly: true, shape: /^[A-Za-z0-9]{12,64}$/, signup: "https://finnhub.io/dashboard" },
  fmp: { label: "Financial Modeling Prep", sourceId: "fmp-key", individualIsPersonalOnly: true, shape: /^[A-Za-z0-9]{16,64}$/, signup: "https://site.financialmodelingprep.com/developer/docs/dashboard" },
};

export const isKeyProvider = (s: unknown): s is KeyProvider => typeof s === "string" && (KEY_PROVIDERS as readonly string[]).includes(s);

/** The warning a team member sees for an individual-plan key from a provider whose individual terms are personal-only. */
export function planWarning(provider: KeyProvider, plan: PlanType, inTeam: boolean): string | null {
  if (!inTeam || plan !== "individual" || !KEY_PROVIDER_INFO[provider].individualIsPersonalOnly) return null;
  return `${KEY_PROVIDER_INFO[provider].label}'s individual plans are for personal, non-business use. You belong to a team: if you use YouBank for your firm, ${KEY_PROVIDER_INFO[provider].label}'s terms ask for a business plan. Your key is still only ever used for your own screens.`;
}

export type SourceInfo = {
  label: string;
  licence: Licence;
  /** The credit shown wherever its data is shown (some sources require exact wording). */
  attribution: string;
  /** Exchange delay in minutes for price feeds (0: real time), null when it depends on the plan or does not apply. */
  delayedMinutes: number | null;
  /** How current its data is, in words ("Daily fixing", "End of day", "Real-time · IEX only"). */
  freshness: string;
  /** For a `user-key` source: whose key it needs. */
  keyProvider?: KeyProvider;
  /** Fetched only from the person's browser (the key never reaches YouBank's server). None are, yet. */
  browserOnly?: boolean;
};

export const SOURCES = {
  fmp: { label: "Financial Modeling Prep", licence: "owner-licensed", attribution: "Data from Financial Modeling Prep", delayedMinutes: null, freshness: "Per YouBank's plan" },
  nasdaq: { label: "Nasdaq.com", licence: "unverified", attribution: "Nasdaq.com (backup; terms not confirmed)", delayedMinutes: null, freshness: "Real-time or delayed, as marked" },
  ecb: { label: "European Central Bank reference rates", licence: "attribution", attribution: "Source: ECB statistics. Cross rates are derived by YouBank from the euro reference rates and are for information only.", delayedMinutes: null, freshness: "Daily fixing, 14:15 CET" },
  h10: { label: "Fed H.10 (via FRED)", licence: "attribution", attribution: "Source: Board of Governors of the Federal Reserve System (H.10), via FRED, Federal Reserve Bank of St. Louis", delayedMinutes: null, freshness: "Daily, noon buying rates in New York" },
  coingecko: { label: "CoinGecko", licence: "unverified", attribution: "Data provided by CoinGecko", delayedMinutes: null, freshness: "Minutes" },
  defillama: { label: "DefiLlama", licence: "unverified", attribution: "Source: DefiLlama", delayedMinutes: null, freshness: "Minutes to hours" },
  sec: { label: "SEC EDGAR", licence: "public", attribution: "Source: U.S. Securities and Exchange Commission (EDGAR)", delayedMinutes: null, freshness: "As filed" },
  "ai-research": { label: "AI web research", licence: "unverified", attribution: "Researched on the web by AI; each figure cites its page", delayedMinutes: null, freshness: "As found" },
  treasury: { label: "US Treasury par yield curve", licence: "public", attribution: "Source: U.S. Department of the Treasury", delayedMinutes: null, freshness: "Daily, after the close" },
  h15: { label: "Fed H.15 (via FRED)", licence: "attribution", attribution: "Source: Board of Governors of the Federal Reserve System (H.15), via FRED, Federal Reserve Bank of St. Louis", delayedMinutes: null, freshness: "Daily" },
  fred: { label: "FRED (St. Louis Fed)", licence: "attribution", attribution: "Source: FRED, Federal Reserve Bank of St. Louis (original publisher named per series)", delayedMinutes: null, freshness: "Per release" },
  bls: { label: "Bureau of Labor Statistics", licence: "public", attribution: "Source: U.S. Bureau of Labor Statistics", delayedMinutes: null, freshness: "Per release" },
  bea: { label: "Bureau of Economic Analysis", licence: "public", attribution: "Source: U.S. Bureau of Economic Analysis", delayedMinutes: null, freshness: "Per release" },
  eia: { label: "U.S. Energy Information Administration", licence: "public", attribution: "Source: U.S. Energy Information Administration", delayedMinutes: null, freshness: "Daily spot, published with a lag" },
  worldbank: { label: "World Bank Pink Sheet", licence: "attribution", attribution: "Source: World Bank Commodity Price Data (The Pink Sheet), CC BY 4.0", delayedMinutes: null, freshness: "Monthly averages" },
  cftc: { label: "CFTC Commitments of Traders", licence: "public", attribution: "Source: U.S. Commodity Futures Trading Commission, Commitments of Traders", delayedMinutes: null, freshness: "Weekly (Tuesday positions, released Friday)" },
  gdelt: { label: "The GDELT Project", licence: "attribution", attribution: "Source: The GDELT Project (gdeltproject.org), with a link to each article", delayedMinutes: null, freshness: "15 minutes" },
  "federal-register": { label: "Federal Register", licence: "public", attribution: "Source: Federal Register (federalregister.gov)", delayedMinutes: null, freshness: "Daily" },
  tiingo: { label: "Tiingo (your key)", licence: "user-key", attribution: "Data from Tiingo, with your own key", delayedMinutes: 0, freshness: "End of day; quotes real-time from IEX only", keyProvider: "tiingo" },
  twelvedata: { label: "Twelve Data (your key)", licence: "user-key", attribution: "Data provided by Twelve Data", delayedMinutes: null, freshness: "Per your plan", keyProvider: "twelvedata" },
  alphavantage: { label: "Alpha Vantage (your key)", licence: "user-key", attribution: "Data from Alpha Vantage, with your own key", delayedMinutes: null, freshness: "End of day on free keys", keyProvider: "alphavantage" },
  finnhub: { label: "Finnhub (your key)", licence: "user-key", attribution: "Data from Finnhub, with your own key", delayedMinutes: 0, freshness: "Per your plan", keyProvider: "finnhub" },
  "fmp-key": { label: "FMP (your key)", licence: "user-key", attribution: "Data from Financial Modeling Prep, with your own key", delayedMinutes: null, freshness: "Per your plan", keyProvider: "fmp" },
} as const satisfies Record<string, SourceInfo>;

export type SourceId = keyof typeof SOURCES;
export const SOURCE_IDS = Object.keys(SOURCES) as SourceId[];
export const isSourceId = (s: unknown): s is SourceId => typeof s === "string" && Object.hasOwn(SOURCES, s);
export const sourceInfo = (id: string): SourceInfo | null => (isSourceId(id) ? SOURCES[id] : null);

/** Licence badges as people read them. */
export const LICENCE_LABEL: Record<Licence, string> = {
  public: "Public", attribution: "Free · attribution", "owner-licensed": "YouBank's licence", "user-key": "Your key", unverified: "Terms unverified",
};

/* ---------------- Datasets ---------------- */

export const DATASET_IDS = [
  "daily-bars", "quote", "profile", "fundamentals", "filings", "earnings", "estimates", "analysts", "dividends", "deals", "movers", "sectors",
  "curve", "macro", "fx", "commodity", "cot", "crypto", "intraday", "crypto-market", "defi", "news",
] as const;
export type DatasetName = (typeof DATASET_IDS)[number];
export const isDatasetName = (s: unknown): s is DatasetName => typeof s === "string" && (DATASET_IDS as readonly string[]).includes(s);

export type DatasetInfo = {
  label: string;
  /** Which terminal commands read it. */
  commands: string[];
  /** Said when no public, attribution or owner-licensed source serves it. */
  noFreeSource?: string;
  /** A person may reorder its sources (staged datasets run in a fixed order). */
  configurable: boolean;
};

export const DATASETS: Record<DatasetName, DatasetInfo> = {
  "daily-bars": { label: "Daily prices", commands: ["GP", "HP", "BETA", "RISK", "WEI", "SECT", "PORT"], configurable: true },
  quote: { label: "Latest quotes", commands: ["WEI", "FXC", "CMDTY", "DES"], configurable: true },
  profile: { label: "Company profile", commands: ["DES", "COMPS"], configurable: true },
  fundamentals: { label: "Fundamentals (XBRL)", commands: ["FA", "CAP", "DDIS", "QUAL", "XBRL", "EQS", "IRAT", "WACC"], configurable: false },
  filings: { label: "Filings", commands: ["FIL", "EVT", "INS"], configurable: false },
  earnings: { label: "Earnings", commands: ["EE"], configurable: true },
  estimates: { label: "Estimates", commands: ["FCST"], configurable: false, noFreeSource: "No free source is licensed for consensus estimates. Reported actuals come from SEC filings; estimates need a data key." },
  analysts: { label: "Analyst ratings", commands: ["ANR"], configurable: true, noFreeSource: "No free source is licensed for analyst ratings or price targets. They need YouBank's FMP plan or your own key." },
  dividends: { label: "Dividends", commands: ["DVD"], configurable: true },
  deals: { label: "M&A", commands: ["MA"], configurable: true },
  movers: { label: "Movers", commands: ["MOST"], configurable: true, noFreeSource: "No free source publishes a licensed movers list." },
  sectors: { label: "Sectors", commands: ["SECT"], configurable: true },
  curve: { label: "Treasury curve", commands: ["GC", "WACC"], configurable: true },
  macro: { label: "Economy", commands: ["ECO"], configurable: true },
  fx: { label: "Currencies", commands: ["FXC"], configurable: true },
  commodity: { label: "Commodities", commands: ["CMDTY"], configurable: true },
  cot: { label: "Futures positioning (COT)", commands: ["CMDTY"], configurable: false },
  crypto: { label: "Crypto prices", commands: ["CMDTY"], configurable: true },
  intraday: { label: "Intraday prices", commands: [], configurable: false, noFreeSource: "No free intraday source is licensed for display (IEX's free files are next-day only). Not offered yet." },
  "crypto-market": { label: "Crypto markets", commands: ["CRYP", "TOKEN"], configurable: false, noFreeSource: "No crypto source with confirmed commercial terms: CoinGecko's free API is used, its licence unverified (CoinMarketCap Basic is the candidate to confirm)." },
  defi: { label: "DeFi", commands: ["DEFI", "STBL", "YLD", "RWA"], configurable: false, noFreeSource: "DefiLlama's terms conflict (open API vs personal, non-commercial use): used with its licence unverified until DefiLlama confirms in writing." },
  news: { label: "News", commands: ["TOP", "NI", "CN"], configurable: false },
};

/** The dataset a terminal screen's "Source ▾" chip switches (the screen's main data). */
export const FN_DATASET: Record<string, DatasetName> = {
  price: "daily-bars", earnings: "earnings", analysts: "analysts", dividends: "dividends", indices: "daily-bars", fx: "fx", commodities: "commodity",
  movers: "movers", sectors: "sectors", deals: "deals", curve: "curve", macro: "macro", snapshot: "profile",
};

/**
 * `@tiingo` in the command bar: the source id after "@", if it is one. Pure. Returns the input without
 * the token, so "AAPL GP @tiingo" parses as "AAPL GP" with source "tiingo".
 */
export function splitSourceToken(input: string): { rest: string; source?: SourceId; unknown?: string } {
  const parts = input.trim().split(/\s+/).filter(Boolean);
  const at = parts.findIndex((p) => p.startsWith("@"));
  if (at < 0) return { rest: input };
  const id = parts[at].slice(1).toLowerCase();
  const rest = [...parts.slice(0, at), ...parts.slice(at + 1)].join(" ");
  return isSourceId(id) ? { rest, source: id } : { rest, unknown: id };
}

/** An adapter's catalogue fields (id, label, licence, credit, delay, whose key) from its source id. Pure. */
export function metaOf<I extends SourceId>(id: I): { id: I; label: string; licence: Licence; attribution: string; delayedMinutes: number | null; keyProvider?: KeyProvider } {
  const s: SourceInfo = SOURCES[id];
  return { id, label: s.label, licence: s.licence, attribution: s.attribution, delayedMinutes: s.delayedMinutes, ...(s.keyProvider ? { keyProvider: s.keyProvider } : {}) };
}
