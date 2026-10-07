import type { Profile } from "./roles";

export type FunctionGroup = "company" | "market" | "workspace" | "edge" | "crypto";
type FnDef = { label: string; hint: string; group: FunctionGroup; /** Takes free text after the code, e.g. a screen in words. */ args?: boolean };

/**
 * Terminal function codes. Typed in the command bar as "<TICKER> <FN>", "<FN>", or "<TICKER> TOOL <tool-id>".
 * Company functions act on a ticker; market functions (indices, rates, the economy, the screener) do not.
 */
export const FUNCTIONS = {
  DES: { label: "Description", hint: "Company overview", group: "company" },
  FA: { label: "Financials", hint: "LTM income, cash flow, margins", group: "company" },
  GP: { label: "Price chart", hint: "Price, trend and volatility regime, GARCH price cone", group: "company" },
  HP: { label: "Price history", hint: "Daily prices and returns", group: "company" },
  BETA: { label: "Beta", hint: "Beta against the S&P 500: raw, adjusted, rolling", group: "company" },
  RISK: { label: "Risk", hint: "Volatility forecast, value at risk, drawdowns", group: "company" },
  COMPS: { label: "Trading comps", hint: "Peer valuation grid", group: "company" },
  PREC: { label: "Precedents", hint: "Precedent transactions", group: "company" },
  CAP: { label: "Capital structure", hint: "Debt, leverage, coverage, liquidity", group: "company" },
  WACC: { label: "Cost of capital", hint: "WACC from its parts, with a Monte Carlo range", group: "company" },
  IRAT: { label: "Implied rating", hint: "Credit rating and default odds from Altman, Ohlson and Merton", group: "company" },
  DDIS: { label: "Debt maturities", hint: "Maturity ladder and refinancing risk", group: "company" },
  QUAL: { label: "Earnings quality", hint: "Beneish M, Piotroski F, accruals, red flags", group: "company" },
  FCST: { label: "Revenue forecast", hint: "Model forecast with calibrated intervals, against the Street", group: "company" },
  EE: { label: "Earnings", hint: "Beats and misses, beat odds, the typical move", group: "company" },
  ANR: { label: "Analysts", hint: "Ratings, price targets, drift", group: "company" },
  DVD: { label: "Dividends", hint: "Yield, growth, dividend safety", group: "company" },
  FIL: { label: "Filings", hint: "SEC filings (EDGAR)", group: "company" },
  EVT: { label: "Events", hint: "8-K events and filing timeline", group: "company" },
  INS: { label: "Insiders", hint: "Form 4 insider transactions", group: "company" },
  CN: { label: "Company news", hint: "News, filings and deals about a company", group: "company" },
  XBRL: { label: "XBRL explorer", hint: "Any reported concept, charted", group: "company" },
  AI: { label: "AI", hint: "Chat over the current screen", group: "company", args: true },
  TOP: { label: "Top news", hint: "Your desk's top stories, ranked for you", group: "market" },
  NI: { label: "News by topic", hint: "NI ENERGY, NI MA, NI IPO, NI private credit", group: "market", args: true },
  WEI: { label: "World indices", hint: "Equity indices worldwide, moves as z-scores", group: "market" },
  MOST: { label: "Movers", hint: "Most active, top gainers and losers", group: "market" },
  SECT: { label: "Sectors", hint: "Sector performance: day, month, year to date", group: "market" },
  FXC: { label: "Currencies", hint: "Major currencies against the dollar", group: "market" },
  CMDTY: { label: "Commodities", hint: "Energy, metals, grains and crypto", group: "market" },
  GC: { label: "Treasury curve", hint: "Yield curve, Nelson-Siegel fit, recession odds", group: "market" },
  ECO: { label: "Economy", hint: "Inflation, jobs, growth, with model outlooks", group: "market" },
  MA: { label: "M&A", hint: "Recent mergers and acquisitions", group: "market" },
  EQS: { label: "Screener", hint: "Screen every US filer, in plain English", group: "market", args: true },
  PORT: { label: "Portfolio risk", hint: "Risk of a whole book: PORT AAPL 40 MSFT 30 KO 30", group: "market", args: true },
  // Crypto (src/components/terminal/screens/CryptoScreens.tsx): free public data, no ticker needed.
  CRYP: { label: "Crypto markets", hint: "Largest tokens, market cap, bitcoin dominance, DeFi TVL, stablecoins", group: "crypto" },
  TOKEN: { label: "Token", hint: "One token: price, supply, risk, fees and revenue, multiples, unlocks: TOKEN ETH", group: "crypto", args: true },
  DEFI: { label: "DeFi", hint: "Value locked by chain, category and protocol; fees and revenue", group: "crypto" },
  STBL: { label: "Stablecoins", hint: "Stablecoin supply and net flows, by coin and chain", group: "crypto" },
  YLD: { label: "DeFi yields", hint: "The largest pools with base and reward APY", group: "crypto" },
  BTCN: { label: "Bitcoin network", hint: "Fees, hashrate, difficulty, pools, mining economics", group: "crypto" },
  RAISE: { label: "Crypto rounds", hint: "Crypto venture rounds, categories and lead investors", group: "crypto" },
  UNLK: { label: "Token unlocks", hint: "Scheduled token unlocks in the next 60 days", group: "crypto" },
  TRSY: { label: "Crypto treasuries", hint: "Public companies' crypto holdings, from SEC filings", group: "crypto" },
  RWA: { label: "Tokenized assets", hint: "Tokenized treasuries, private credit and other real-world assets", group: "crypto" },
  WALLET: { label: "Wallet", hint: "Read-only balances and risk of any address: WALLET name.eth", group: "crypto", args: true },
  LEARN: { label: "Learn", hint: "Your mastery of each function and what to learn next", group: "workspace" },
  PG: { label: "Peer groups", hint: "Saved peer groups", group: "workspace" },
  TOOLS: { label: "Tools", hint: "Workflows and calculators for your role", group: "workspace" },
  TOOL: { label: "Tool", hint: "Run a workflow in a panel: TICKER TOOL <id>", group: "workspace", args: true },
  EDGE: { label: "Edge", hint: "Everything Edge knows about a company: findings, buyers and targets, red flags, assets", group: "edge" },
  GEO: { label: "Ground", hint: "Its plants and pipelines on the map, and what satellites saw change there", group: "edge" },
  NET: { label: "Network", hint: "Its relationships from SEC filings, likely buyers and targets, warm intros", group: "edge" },
  SIM: { label: "Stress", hint: "Simulate its stock: SIM, SIM 2008, SIM oil -30%", group: "edge", args: true },
  ASK: { label: "Ask filings", hint: "Ask its filings and your documents, with quotes: ASK what drove volumes?", group: "edge", args: true },
} as const satisfies Record<string, FnDef>;

export type FunctionCode = keyof typeof FUNCTIONS;
export const FUNCTION_CODES = Object.keys(FUNCTIONS) as FunctionCode[];
export const TICKER_RE = /^[A-Z][A-Z0-9.\-]{0,7}$/;

export type Command = { ticker: string; fn: FunctionCode; arg?: string; /** How the command was given: typed evidence counts for more in knowledge tracing. */ via?: "typed" | "click" };

export function isFunctionCode(s: string): s is FunctionCode {
  return (FUNCTION_CODES as string[]).includes(s);
}

/**
 * Edge's functions exist only for people with the Edge beta on. Without it their codes stay plain
 * tickers (GEO and NET are listed companies), as PG, AI and MA do when a function follows them.
 */
export const EDGE_CODES: ReadonlySet<string> = new Set(FUNCTION_CODES.filter((f) => (FUNCTIONS[f] as FnDef).group === "edge"));
export const isCommandCode = (s: string, edge: boolean): s is FunctionCode => isFunctionCode(s) && (edge || !EDGE_CODES.has(s));

/** Market and workspace functions do not act on a ticker (TOOL and TOOLS do, through the active one). */
export const needsTicker = (fn: FunctionCode) => { const g = (FUNCTIONS[fn] as FnDef).group; return g === "company" || g === "edge" || fn === "TOOL" || fn === "TOOLS"; };
const takesArgs = (fn: FunctionCode) => (FUNCTIONS[fn] as FnDef).args === true;

function build(fn: FunctionCode, ticker: string, rest: string[]): { ok: true; command: Command } | { ok: false; error: string } {
  const arg = rest.join(" ");
  if (fn === "TOOL") return arg ? { ok: true, command: { ticker, fn, arg: arg.toLowerCase() } } : { ok: false, error: `TOOL needs a tool id, e.g. ${ticker ? `${ticker} ` : ""}TOOL dcf` };
  if (rest.length && !takesArgs(fn)) return { ok: false, error: `Unexpected "${arg.toUpperCase()}" after ${fn}` };
  return { ok: true, command: { ticker: needsTicker(fn) ? ticker : "", fn, ...(arg ? { arg } : {}) } };
}

/**
 * Parse a command line. "SNOW COMPS", "comps", "ddog", "SNOW TOOL dcf", "WEI", "EQS revenue growth
 * above 20%". A bare ticker opens DES; a bare company function uses the active ticker. A ticker that is
 * also a function code (PG, AI, MA) works when a function follows it: "PG DES". Edge's codes count only
 * with the beta on.
 */
export function parseCommand(input: string, activeTicker: string, edge = false): { ok: true; command: Command } | { ok: false; error: string } {
  const raw = input.trim().split(/\s+/).filter(Boolean);
  const tokens = raw.map((t) => t.toUpperCase());
  if (tokens.length === 0) return { ok: false, error: "Type a ticker and a function, e.g. SNOW COMPS" };
  const [first, second] = tokens;
  const code = (s: string): s is FunctionCode => isCommandCode(s, edge);

  const tickerFirst = TICKER_RE.test(first) && !!second && code(second) && (!code(first) || !takesArgs(first) || tokens.length === 2);
  if (code(first) && !tickerFirst) return build(first, activeTicker, raw.slice(1));
  if (!TICKER_RE.test(first)) return { ok: false, error: `"${first}" is not a ticker or a function` };
  if (!second) return { ok: true, command: { ticker: first, fn: "DES" } };
  if (!code(second)) return { ok: false, error: `Unknown function "${second}". Try ${FUNCTION_CODES.slice(0, 12).join(", ")}…` };
  return build(second, first, raw.slice(2));
}

/** The function strip for a profile: the order and subset that matches how that desk works. */
export function functionsForProfile(p: Pick<Profile, "role" | "specialty">): FunctionCode[] {
  const s = p.specialty;
  switch (p.role) {
    case "banker":
      if (s === "Restructuring") return ["DES", "CAP", "DDIS", "IRAT", "FA", "QUAL", "FIL", "EVT", "COMPS", "TOP", "AI", "TOOLS"];
      if (s === "Leveraged finance" || s === "DCM") return ["DES", "CAP", "IRAT", "DDIS", "WACC", "FA", "GC", "COMPS", "EVT", "TOP", "AI", "TOOLS"];
      if (s === "ECM") return ["DES", "GP", "FA", "COMPS", "EE", "ANR", "WEI", "FIL", "TOP", "AI", "TOOLS"];
      return ["DES", "FA", "COMPS", "PREC", "WACC", "MA", "FIL", "EVT", "TOP", "AI", "TOOLS"];
    case "pe": return ["DES", "FA", "COMPS", "CAP", "IRAT", "WACC", "PREC", "MA", "TOP", "AI", "TOOLS"];
    case "vc": return ["DES", "COMPS", "FA", "FCST", "EQS", "FIL", "TOP", "AI", "TOOLS"];
    case "markets":
      if (s === "Distressed & credit") return ["DES", "CAP", "IRAT", "DDIS", "QUAL", "RISK", "GC", "EVT", "TOP", "AI", "TOOLS"];
      return ["DES", "GP", "FA", "EE", "ANR", "RISK", "BETA", "WEI", "ECO", "EQS", "TOP", "AI", "TOOLS"];
    case "corpfin": return ["DES", "FA", "COMPS", "CAP", "WACC", "DDIS", "GC", "EVT", "TOP", "AI", "TOOLS"];
    case "consultant": return ["DES", "FA", "COMPS", "FCST", "SECT", "EQS", "ECO", "TOP", "AI", "TOOLS"];
    case "accountant": return ["DES", "FA", "QUAL", "XBRL", "FIL", "EVT", "COMPS", "TOP", "AI", "TOOLS"];
    case "student":
    default: return ["DES", "FA", "GP", "COMPS", "WACC", "IRAT", "ECO", "LEARN", "TOP", "AI", "TOOLS"];
  }
}
