import type { Profile } from "./roles";

/** Terminal function codes. Typed in the command bar as "<TICKER> <FN>", "<FN>", or "<TICKER> TOOL <tool-id>". */
export const FUNCTIONS = {
  DES: { label: "Description", hint: "Company overview" },
  FA: { label: "Financials", hint: "LTM income, cash flow, margins" },
  COMPS: { label: "Trading comps", hint: "Peer valuation grid" },
  PREC: { label: "Precedents", hint: "Precedent transactions" },
  CAP: { label: "Capital structure", hint: "Debt, leverage, coverage, liquidity" },
  FIL: { label: "Filings", hint: "SEC filings (EDGAR)" },
  EVT: { label: "Events", hint: "8-K events and filing timeline" },
  INS: { label: "Insiders", hint: "Form 4 insider transactions" },
  XBRL: { label: "XBRL explorer", hint: "Any reported concept, charted" },
  AI: { label: "AI", hint: "Chat over the current screen" },
  PG: { label: "Peer groups", hint: "Saved peer groups" },
  TOOLS: { label: "Tools", hint: "Workflows and calculators for your role" },
  TOOL: { label: "Tool", hint: "Run a workflow in a panel: TICKER TOOL <id>" },
} as const;

export type FunctionCode = keyof typeof FUNCTIONS;
export const FUNCTION_CODES = Object.keys(FUNCTIONS) as FunctionCode[];
export const TICKER_RE = /^[A-Z][A-Z0-9.\-]{0,7}$/;

export type Command = { ticker: string; fn: FunctionCode; arg?: string };

export function isFunctionCode(s: string): s is FunctionCode {
  return (FUNCTION_CODES as string[]).includes(s);
}

/** Parse a command line. "SNOW COMPS", "comps", "ddog", "SNOW TOOL dcf". A bare ticker opens DES; a bare function uses the active ticker. */
export function parseCommand(input: string, activeTicker: string): { ok: true; command: Command } | { ok: false; error: string } {
  const raw = input.trim().split(/\s+/).filter(Boolean);
  const tokens = raw.map((t) => t.toUpperCase());
  if (tokens.length === 0) return { ok: false, error: "Type a ticker and a function, e.g. SNOW COMPS" };
  const [first, second] = tokens;

  if (isFunctionCode(first)) {
    if (first === "TOOL") return raw.length > 1 ? { ok: true, command: { ticker: activeTicker, fn: "TOOL", arg: raw.slice(1).join(" ").toLowerCase() } } : { ok: false, error: "TOOL needs a tool id, e.g. TOOL dcf" };
    if (tokens.length > 1) return { ok: false, error: `Unexpected "${tokens.slice(1).join(" ")}" after ${first}` };
    return { ok: true, command: { ticker: activeTicker, fn: first } };
  }
  if (!TICKER_RE.test(first)) return { ok: false, error: `"${first}" is not a ticker or a function` };
  if (!second) return { ok: true, command: { ticker: first, fn: "DES" } };
  if (!isFunctionCode(second)) return { ok: false, error: `Unknown function "${second}". Try ${FUNCTION_CODES.join(", ")}` };
  if (second === "TOOL") return raw.length > 2 ? { ok: true, command: { ticker: first, fn: "TOOL", arg: raw.slice(2).join(" ").toLowerCase() } } : { ok: false, error: "TOOL needs a tool id, e.g. SNOW TOOL dcf" };
  if (tokens.length > 2) return { ok: false, error: `Unexpected "${tokens.slice(2).join(" ")}"` };
  return { ok: true, command: { ticker: first, fn: second } };
}

/** The function strip for a profile: the order and subset that matches how that desk works. */
export function functionsForProfile(p: Pick<Profile, "role" | "specialty">): FunctionCode[] {
  const s = p.specialty;
  switch (p.role) {
    case "banker":
      if (s === "Restructuring") return ["DES", "CAP", "FA", "FIL", "EVT", "COMPS", "AI", "TOOLS"];
      if (s === "Leveraged finance" || s === "DCM") return ["DES", "CAP", "FA", "COMPS", "EVT", "FIL", "AI", "TOOLS"];
      if (s === "ECM") return ["DES", "FA", "COMPS", "FIL", "EVT", "INS", "AI", "TOOLS"];
      return ["DES", "FA", "COMPS", "PREC", "FIL", "EVT", "AI", "TOOLS"];
    case "pe": return ["DES", "FA", "COMPS", "CAP", "PREC", "FIL", "AI", "TOOLS"];
    case "vc": return ["DES", "COMPS", "FA", "FIL", "AI", "TOOLS"];
    case "markets":
      if (s === "Distressed & credit") return ["DES", "CAP", "FA", "EVT", "FIL", "AI", "TOOLS"];
      return ["DES", "FA", "INS", "EVT", "COMPS", "FIL", "XBRL", "AI", "TOOLS"];
    case "corpfin": return ["DES", "FA", "COMPS", "CAP", "EVT", "XBRL", "AI", "TOOLS"];
    case "consultant": return ["DES", "FA", "COMPS", "FIL", "XBRL", "AI", "TOOLS"];
    case "accountant": return ["DES", "FA", "XBRL", "FIL", "EVT", "COMPS", "AI", "TOOLS"];
    case "student":
    default: return ["DES", "FA", "COMPS", "PREC", "FIL", "AI", "TOOLS"];
  }
}
