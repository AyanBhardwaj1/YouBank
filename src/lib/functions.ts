import type { Profile } from "./roles";

export type FunctionGroup = "company" | "market" | "workspace";
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
  XBRL: { label: "XBRL explorer", hint: "Any reported concept, charted", group: "company" },
  AI: { label: "AI", hint: "Chat over the current screen", group: "company", args: true },
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
  LEARN: { label: "Learn", hint: "Your mastery of each function and what to learn next", group: "workspace" },
  PG: { label: "Peer groups", hint: "Saved peer groups", group: "workspace" },
  TOOLS: { label: "Tools", hint: "Workflows and calculators for your role", group: "workspace" },
  TOOL: { label: "Tool", hint: "Run a workflow in a panel: TICKER TOOL <id>", group: "workspace", args: true },
} as const satisfies Record<string, FnDef>;

export type FunctionCode = keyof typeof FUNCTIONS;
export const FUNCTION_CODES = Object.keys(FUNCTIONS) as FunctionCode[];
export const TICKER_RE = /^[A-Z][A-Z0-9.\-]{0,7}$/;

export type Command = { ticker: string; fn: FunctionCode; arg?: string; /** How the command was given: typed evidence counts for more in knowledge tracing. */ via?: "typed" | "click" };

export function isFunctionCode(s: string): s is FunctionCode {
  return (FUNCTION_CODES as string[]).includes(s);
}

/** Market and workspace functions do not act on a ticker (TOOL and TOOLS do, through the active one). */
export const needsTicker = (fn: FunctionCode) => (FUNCTIONS[fn] as FnDef).group === "company" || fn === "TOOL" || fn === "TOOLS";
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
 * also a function code (PG, AI, MA) works when a function follows it: "PG DES".
 */
export function parseCommand(input: string, activeTicker: string): { ok: true; command: Command } | { ok: false; error: string } {
  const raw = input.trim().split(/\s+/).filter(Boolean);
  const tokens = raw.map((t) => t.toUpperCase());
  if (tokens.length === 0) return { ok: false, error: "Type a ticker and a function, e.g. SNOW COMPS" };
  const [first, second] = tokens;

  const tickerFirst = TICKER_RE.test(first) && !!second && isFunctionCode(second) && (!isFunctionCode(first) || !takesArgs(first) || tokens.length === 2);
  if (isFunctionCode(first) && !tickerFirst) return build(first, activeTicker, raw.slice(1));
  if (!TICKER_RE.test(first)) return { ok: false, error: `"${first}" is not a ticker or a function` };
  if (!second) return { ok: true, command: { ticker: first, fn: "DES" } };
  if (!isFunctionCode(second)) return { ok: false, error: `Unknown function "${second}". Try ${FUNCTION_CODES.slice(0, 12).join(", ")}…` };
  return build(second, first, raw.slice(2));
}

/** The function strip for a profile: the order and subset that matches how that desk works. */
export function functionsForProfile(p: Pick<Profile, "role" | "specialty">): FunctionCode[] {
  const s = p.specialty;
  switch (p.role) {
    case "banker":
      if (s === "Restructuring") return ["DES", "CAP", "DDIS", "IRAT", "FA", "QUAL", "FIL", "EVT", "COMPS", "AI", "TOOLS"];
      if (s === "Leveraged finance" || s === "DCM") return ["DES", "CAP", "IRAT", "DDIS", "WACC", "FA", "GC", "COMPS", "EVT", "AI", "TOOLS"];
      if (s === "ECM") return ["DES", "GP", "FA", "COMPS", "EE", "ANR", "WEI", "FIL", "AI", "TOOLS"];
      return ["DES", "FA", "COMPS", "PREC", "WACC", "MA", "FIL", "EVT", "AI", "TOOLS"];
    case "pe": return ["DES", "FA", "COMPS", "CAP", "IRAT", "WACC", "PREC", "MA", "AI", "TOOLS"];
    case "vc": return ["DES", "COMPS", "FA", "FCST", "EQS", "FIL", "AI", "TOOLS"];
    case "markets":
      if (s === "Distressed & credit") return ["DES", "CAP", "IRAT", "DDIS", "QUAL", "RISK", "GC", "EVT", "AI", "TOOLS"];
      return ["DES", "GP", "FA", "EE", "ANR", "RISK", "BETA", "WEI", "ECO", "EQS", "AI", "TOOLS"];
    case "corpfin": return ["DES", "FA", "COMPS", "CAP", "WACC", "DDIS", "GC", "EVT", "AI", "TOOLS"];
    case "consultant": return ["DES", "FA", "COMPS", "FCST", "SECT", "EQS", "ECO", "AI", "TOOLS"];
    case "accountant": return ["DES", "FA", "QUAL", "XBRL", "FIL", "EVT", "COMPS", "AI", "TOOLS"];
    case "student":
    default: return ["DES", "FA", "GP", "COMPS", "WACC", "IRAT", "ECO", "LEARN", "AI", "TOOLS"];
  }
}
