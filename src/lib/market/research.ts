/**
 * The last backup: a small model with web search looks up the facts the data feeds could not supply.
 *
 * Cheap and checked. The default is GPT-5.6 Luna, the cheapest model with web search (a lookup costs a
 * few cents, mostly the search fee). A figure is kept only if it passes every check:
 * - its page is one the search actually retrieved, on a site that is not a forum or social network;
 * - the quote copied from that page contains the number (so the value was read, not remembered);
 * - it is recent enough for what it is (a price within a week, analyst targets within four months);
 * - it is plausible (a price inside its 52-week range, a market cap near price times shares).
 * When fewer than half the figures survive, one retry goes to a stronger small model (GPT-5.4 mini).
 * Answers are cached for hours, and every call is in the usage ledger with its search fees.
 */
import OpenAI from "openai";
import { z } from "zod";
import { cacheJson } from "@/lib/cache";
import { resolveAi } from "@/lib/ai/config";
import { guardAi } from "@/lib/ai/limits";
import { aiUser, recordUsage } from "@/lib/ai/usage";
import { backupEnabled } from "./nasdaq";

const RESEARCH_MODEL = () => process.env.MARKET_RESEARCH_MODEL?.trim() || "gpt-5.6-luna";
const ESCALATION_MODEL = () => process.env.MARKET_RESEARCH_ESCALATION_MODEL?.trim() || "gpt-5.4-mini";
/** OpenAI's published fee per web search call for its reasoning models; update if it changes. */
export const WEB_SEARCH_FEE_USD = 0.01;

type Kind = "number" | "date" | "text";
type Spec = { label: string; kind: Kind; maxAgeDays?: number; percent?: boolean };

/** Everything the research layer knows how to look up, with how fresh it must be. */
export const FIELDS = {
  price: { label: "latest share price in US dollars (last trade or last close)", kind: "number", maxAgeDays: 7 },
  changePct: { label: "percent change on the latest trading day", kind: "number", maxAgeDays: 7, percent: true },
  marketCap: { label: "market capitalization in US dollars", kind: "number", maxAgeDays: 14 },
  high52: { label: "52-week high price", kind: "number", maxAgeDays: 14 },
  low52: { label: "52-week low price", kind: "number", maxAgeDays: 14 },
  beta: { label: "beta (5-year monthly, as published)", kind: "number", maxAgeDays: 180 },
  rating: { label: "consensus analyst rating (for example Buy, Hold, Sell)", kind: "text", maxAgeDays: 120 },
  analysts: { label: "number of analysts in the consensus", kind: "number", maxAgeDays: 120 },
  buy: { label: "number of analysts rating it buy or strong buy", kind: "number", maxAgeDays: 120 },
  hold: { label: "number of analysts rating it hold", kind: "number", maxAgeDays: 120 },
  sell: { label: "number of analysts rating it sell or strong sell", kind: "number", maxAgeDays: 120 },
  targetMean: { label: "consensus (average) 12-month analyst price target in US dollars", kind: "number", maxAgeDays: 120 },
  targetHigh: { label: "highest analyst price target in US dollars", kind: "number", maxAgeDays: 120 },
  targetLow: { label: "lowest analyst price target in US dollars", kind: "number", maxAgeDays: 120 },
  nextEarningsDate: { label: "date of the next quarterly earnings report", kind: "date" },
  epsEstimate: { label: "consensus EPS estimate for the next quarter to be reported", kind: "number", maxAgeDays: 120 },
  revenueEstimate: { label: "consensus revenue estimate in US dollars for the next quarter to be reported", kind: "number", maxAgeDays: 120 },
  lastEps: { label: "EPS actually reported for the most recent quarter", kind: "number", maxAgeDays: 150 },
  lastEpsEstimate: { label: "consensus EPS estimate for that most recent reported quarter", kind: "number", maxAgeDays: 150 },
  lastReportDate: { label: "date the most recent quarterly results were reported", kind: "date" },
  annualDividend: { label: "annual dividend per share in US dollars (indicated or forward)", kind: "number", maxAgeDays: 400 },
  dividendYield: { label: "dividend yield", kind: "number", maxAgeDays: 30, percent: true },
  exDividendDate: { label: "most recent or next ex-dividend date", kind: "date" },
  payoutRatio: { label: "dividend payout ratio", kind: "number", maxAgeDays: 400, percent: true },
  description: { label: "one-paragraph description of what the company does", kind: "text" },
  sector: { label: "sector", kind: "text" },
  industry: { label: "industry", kind: "text" },
} as const satisfies Record<string, Spec>;
export type Field = keyof typeof FIELDS;

export type Fact = { value: number | string; asOf: string | null; source: string; quote: string };
export type Researched = {
  subject: string; facts: Partial<Record<Field, Fact>>;
  model: string; researchedAt: string; searches: number;
  rejected: { field: string; reason: string }[];
};

/** Places a figure may not come from: forums, social networks and user-generated pages. */
const DENY = /(^|\.)(reddit|stocktwits|twitter|x|facebook|instagram|tiktok|youtube|quora|medium|substack|wikipedia|threads|discord|telegram)\./i;

const Entries = z.object({
  entries: z.array(z.object({
    field: z.string(), value: z.string().nullable(), asOf: z.string().nullable().describe("YYYY-MM-DD the value applies to"),
    url: z.string().nullable(), quote: z.string().nullable().describe("a short verbatim passage from that page containing the value"),
  })),
});

const SCHEMA = {
  type: "object", additionalProperties: false, required: ["entries"],
  properties: {
    entries: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["field", "value", "asOf", "url", "quote"],
        properties: { field: { type: "string" }, value: { type: ["string", "null"] }, asOf: { type: ["string", "null"] }, url: { type: ["string", "null"] }, quote: { type: ["string", "null"] } },
      },
    },
  },
};

/** "$4.98T", "4,977.6 billion", "1.53%", "(0.42)" -> a number; percent fields come back as decimals. */
export function parseNumber(raw: string, percent = false): number | null {
  const t = raw.trim().replace(/[,\s]/g, "").replace(/^\((.*)\)$/, "-$1");
  const m = /^([-+]?)\$?([-+]?\d*\.?\d+)(%|t|trillion|b|bn|billion|m|mn|million|k|thousand)?$/i.exec(t);
  if (!m) return null;
  let v = Number(m[2]) * (m[1] === "-" ? -1 : 1);
  const unit = (m[3] ?? "").toLowerCase();
  if (unit === "t" || unit === "trillion") v *= 1e12;
  else if (unit === "b" || unit === "bn" || unit === "billion") v *= 1e9;
  else if (unit === "m" || unit === "mn" || unit === "million") v *= 1e6;
  else if (unit === "k" || unit === "thousand") v *= 1e3;
  if (percent || unit === "%") return unit === "%" || Math.abs(v) > 1 ? v / 100 : v;
  return Number.isFinite(v) ? v : null;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
/** "2026-10-29", "10/29/2026", "Oct 29, 2026", "October 29 2026" -> ISO date. */
export function parseDate(raw: string): string | null {
  const t = raw.trim();
  let m = /(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(t);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  m = /([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/.exec(t);
  if (m && MONTHS.includes(m[1].toLowerCase())) return `${m[3]}-${String(MONTHS.indexOf(m[1].toLowerCase()) + 1).padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return null;
}

/** Does the quoted passage contain this number (within 1%, allowing for units like "$4.98T")? */
export function quoteHasNumber(quote: string, value: number, percent = false): boolean {
  const tokens = quote.replace(/,/g, "").match(/\(?[-+]?\$?\d*\.?\d+\)?\s*(%|trillion|billion|million|thousand|t|bn|b|mn|m|k)?(?![a-z])/gi) ?? [];
  return tokens.some((tok) => {
    const n = parseNumber(tok.replace(/\s+/g, ""), percent);
    if (n === null) return false;
    const target = Math.abs(value), got = Math.abs(n);
    return target === 0 ? got === 0 : Math.abs(got - target) / target <= 0.01 || (percent && Math.abs(got * 100 - target) / target <= 0.01);
  });
}

/** Does the quote print this number with a percent sign ("0.50%" for 0.5)? */
const printedAsPercent = (quote: string, v: number) =>
  (quote.replace(/,/g, "").match(/\d*\.?\d+\s*%/g) ?? []).some((t) => Math.abs(Number(t.replace(/[\s%]/g, "")) - Math.abs(v)) <= Math.abs(v) * 0.01);

const DAY = 86_400_000;
const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; } };

export type Context = { today?: string; shares?: number | null };

/** Check one entry; returns the fact or the reason it was rejected. */
export function validate(field: Field, e: z.infer<typeof Entries>["entries"][number], retrieved: Set<string>, ctx: Context): { fact?: Fact; reason?: string } {
  const spec: Spec = FIELDS[field];
  if (e.value === null || !String(e.value).trim()) return { reason: "not found" };
  const url = (e.url ?? "").trim(), host = hostOf(url);
  if (!/^https?:\/\//.test(url) || !host) return { reason: "no source" };
  if (DENY.test(`.${host}`)) return { reason: `unreliable source (${host})` };
  const seen = [...retrieved].some((h) => h === host || h.endsWith(`.${host}`) || host.endsWith(`.${h}`));
  if (!seen) return { reason: `source ${host} was not among the pages the search retrieved` };
  const today = ctx.today ?? new Date().toISOString().slice(0, 10);
  const asOf = e.asOf ? parseDate(e.asOf) : null;
  let value: number | string;
  if (spec.kind === "number") {
    // A percent given without its sign ("0.5" for a 0.5% move) is a percent when the page prints it as one.
    const raw = String(e.value).trim(), bare = spec.percent && !raw.includes("%") ? parseNumber(raw) : null;
    const n = bare !== null && e.quote && printedAsPercent(e.quote, bare) ? bare / 100 : parseNumber(raw, spec.percent);
    if (n === null) return { reason: "not a number" };
    if (!e.quote || !quoteHasNumber(e.quote, n, spec.percent)) return { reason: "the quote does not contain the value" };
    value = n;
  } else if (spec.kind === "date") {
    const d = parseDate(String(e.value));
    if (!d) return { reason: "not a date" };
    if (field === "nextEarningsDate" && Date.parse(d) < Date.parse(today) - 7 * DAY) return { reason: "the date is in the past" };
    value = d;
  } else {
    value = String(e.value).trim().slice(0, 700);
  }
  if (spec.maxAgeDays !== undefined) {
    if (!asOf) return { reason: "no date for the value" };
    const age = (Date.parse(today) - Date.parse(asOf)) / DAY;
    if (age > spec.maxAgeDays) return { reason: `stale (${asOf})` };
    if (age < -2) return { reason: `dated in the future (${asOf})` };
  }
  return { fact: { value, asOf, source: url, quote: (e.quote ?? "").slice(0, 300) } };
}

/** Cross-checks between figures: a price inside its range, a market cap near price times shares, targets near the price. */
export function crossCheck(facts: Partial<Record<Field, Fact>>, ctx: Context): { field: Field; reason: string }[] {
  const out: { field: Field; reason: string }[] = [];
  const n = (f: Field) => (typeof facts[f]?.value === "number" ? (facts[f]!.value as number) : null);
  const price = n("price");
  if (price !== null && price <= 0) out.push({ field: "price", reason: "not positive" });
  const hi = n("high52"), lo = n("low52");
  if (hi !== null && lo !== null && hi < lo) out.push({ field: "high52", reason: "below the 52-week low" });
  if (price !== null && hi !== null && price > hi * 1.05) out.push({ field: "price", reason: "above the 52-week high" });
  if (price !== null && lo !== null && price < lo * 0.95) out.push({ field: "price", reason: "below the 52-week low" });
  const cap = n("marketCap");
  if (cap !== null && price !== null && ctx.shares && ctx.shares > 0 && Math.abs(cap / (price * ctx.shares) - 1) > 0.3) out.push({ field: "marketCap", reason: "far from price times shares outstanding" });
  for (const f of ["targetMean", "targetHigh", "targetLow"] as Field[]) { const t = n(f); if (t !== null && price !== null && (t < price * 0.1 || t > price * 10)) out.push({ field: f, reason: "implausibly far from the price" }); }
  const chg = n("changePct");
  if (chg !== null && Math.abs(chg) > 0.6) out.push({ field: "changePct", reason: "implausible daily move" });
  const y = n("dividendYield");
  if (y !== null && (y < 0 || y > 0.25)) out.push({ field: "dividendYield", reason: "implausible yield" });
  const b = n("beta");
  if (b !== null && (b < -3 || b > 6)) out.push({ field: "beta", reason: "implausible beta" });
  for (const f of ["analysts", "buy", "hold", "sell"] as Field[]) { const c = n(f); if (c !== null && (c < 0 || c > 150 || !Number.isInteger(c))) out.push({ field: f, reason: "not a count" }); }
  return out;
}

async function ask(model: string, subject: string, fields: Field[], ctx: Context): Promise<{ facts: Partial<Record<Field, Fact>>; rejected: { field: string; reason: string }[]; searches: number }> {
  const cfg = resolveAi(null, { model });
  if (cfg.provider !== "openai") throw new Error("AI research needs an OpenAI key");
  await guardAi(aiUser());
  const client = new OpenAI({ apiKey: cfg.apiKey, timeout: 90_000, maxRetries: 1 });
  const today = ctx.today ?? new Date().toISOString().slice(0, 10);
  const res = await client.responses.create({
    model, reasoning: { effort: "low" }, tools: [{ type: "web_search" }], include: ["web_search_call.action.sources"],
    instructions: `You look up current, verifiable market facts with web search. Today is ${today}. For each field, read it from a reputable page (the company's investor relations site, the SEC, Nasdaq, NYSE, Reuters, the Wall Street Journal, Barron's, CNBC, MarketWatch, Yahoo Finance, Google Finance, Morningstar, Zacks, MarketBeat, TipRanks, Investing.com or the Financial Times) and report the value exactly as that page prints it, the date it applies to, the page's URL, and a short verbatim quote from the page that contains the value. If you cannot find a field on such a page, return null for it. Never estimate, convert, compute or recall a value from memory. Return one entry per field, using the field keys given.`,
    input: `Subject: ${subject}\nFields:\n${fields.map((f) => `- ${f}: ${FIELDS[f].label}`).join("\n")}`,
    text: { format: { type: "json_schema", name: "market_facts", schema: SCHEMA, strict: true } },
  });
  // Every page the search retrieved or opened, and every page the answer cites.
  const retrieved = new Set<string>();
  let searches = 0;
  for (const item of res.output) {
    if (item.type === "web_search_call") {
      searches++;
      const a = item.action as { type: string; sources?: { url: string }[]; url?: string | null };
      for (const s of a.sources ?? []) retrieved.add(hostOf(s.url));
      if (a.url) retrieved.add(hostOf(a.url));
    }
    if (item.type === "message") for (const c of item.content) if (c.type === "output_text") for (const an of c.annotations ?? []) if (an.type === "url_citation") retrieved.add(hostOf(an.url));
  }
  retrieved.delete("");
  const u = res.usage;
  recordUsage({ feature: "market-research", provider: "openai", model, effort: "low", usage: { input: u?.input_tokens ?? 0, cached: u?.input_tokens_details?.cached_tokens ?? 0, cacheWrite: 0, output: u?.output_tokens ?? 0, reasoning: u?.output_tokens_details?.reasoning_tokens ?? 0 }, extraCostUsd: searches * WEB_SEARCH_FEE_USD });
  let parsed: z.infer<typeof Entries>;
  try { parsed = Entries.parse(JSON.parse(res.output_text)); } catch { return { facts: {}, rejected: fields.map((f) => ({ field: f, reason: "unreadable answer" })), searches }; }
  const facts: Partial<Record<Field, Fact>> = {};
  const rejected: { field: string; reason: string }[] = [];
  for (const f of fields) {
    const e = parsed.entries.find((x) => x.field === f);
    if (!e) { rejected.push({ field: f, reason: "not answered" }); continue; }
    const r = validate(f, e, retrieved, ctx);
    if (r.fact) facts[f] = r.fact; else rejected.push({ field: f, reason: r.reason ?? "rejected" });
  }
  for (const x of crossCheck(facts, ctx)) { delete facts[x.field]; rejected.push({ field: x.field, reason: x.reason }); }
  return { facts, rejected, searches };
}

/**
 * Research `fields` about `subject` ("Snowflake Inc. (NYSE: SNOW)"). Cached for four hours when prices
 * are asked for, twelve otherwise. Returns null when research is off or no OpenAI key is set.
 */
export async function research(subject: string, fields: Field[], ctx: Context = {}): Promise<Researched | null> {
  if (!backupEnabled() || !fields.length) return null;
  if (resolveAi(null, { model: RESEARCH_MODEL() }).provider !== "openai") return null;
  const priceLike = fields.some((f) => ["price", "changePct", "marketCap", "high52", "low52", "dividendYield"].includes(f));
  const day = new Date().toISOString().slice(0, 10);
  const key = `research:v2:${subject}:${[...fields].sort().join(",")}:${day}`;
  return cacheJson<Researched | null>(key, (priceLike ? 4 : 12) * 3_600_000, async () => {
    const first = await ask(RESEARCH_MODEL(), subject, fields, ctx).catch(() => null);
    let result = first ? { ...first, model: RESEARCH_MODEL() } : null;
    const coverage = (r: typeof first) => (r ? Object.keys(r.facts).length / fields.length : 0);
    if (coverage(first) < 0.5 && ESCALATION_MODEL() !== RESEARCH_MODEL()) {
      const second = await ask(ESCALATION_MODEL(), subject, fields, ctx).catch(() => null);
      if (second && coverage(second) > coverage(first)) {
        const facts = { ...(first?.facts ?? {}), ...second.facts };
        result = { facts, rejected: second.rejected.filter((x) => !(x.field in facts)), searches: (first?.searches ?? 0) + second.searches, model: `${RESEARCH_MODEL()} → ${ESCALATION_MODEL()}` };
      }
    }
    if (!result || !Object.keys(result.facts).length) return null;
    return { subject, facts: result.facts, model: result.model, researchedAt: new Date().toISOString(), searches: result.searches, rejected: result.rejected };
  });
}

/** A researched number, or null. */
export const factNum = (r: Researched | null | undefined, f: Field): number | null => (typeof r?.facts[f]?.value === "number" ? (r.facts[f]!.value as number) : null);
export const factStr = (r: Researched | null | undefined, f: Field): string | null => (r?.facts[f] ? String(r.facts[f]!.value) : null);
