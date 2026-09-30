/**
 * What moves a scenario:
 * - history replays: the factors' actual daily moves through 2008, 2020, the 2022 rate shock and the
 *   2014-16 oil collapse;
 * - shocks a person writes ("oil -30%, rates +150bp"), read by rule, with a small model for the rest
 *   ("a supplier outage cuts revenue 15%");
 * - live-event scenarios proposed from the Newsroom, Earth's findings and the graph's red flags, each
 *   citing what it came from;
 * - AI-imagined tail risks, with their reasoning, labeled as imagined.
 */
import { and, desc, gte, sql } from "drizzle-orm";
import { z } from "zod";
import { requireDb, schema } from "@/db";
import { structured } from "@/lib/ai/agent";
import { logError } from "@/lib/errors";
import { FACTOR_LABEL, FACTORS, type Factor } from "./data";

export const REPLAYS: Record<string, { label: string; from: string; to: string; note: string }> = {
  "2008": { label: "2008 financial crisis", from: "2008-09-02", to: "2009-03-09", note: "Lehman's failure to the March 2009 low" },
  "2020": { label: "2020 pandemic crash and rebound", from: "2020-02-19", to: "2020-06-30", note: "The market's peak to the end of June, oil briefly below zero" },
  "2022": { label: "2022 rate shock", from: "2022-01-03", to: "2022-10-12", note: "The 10-year yield up about 2.5 points, stocks down a quarter" },
  oil2014: { label: "Oil collapse, 2014-16", from: "2014-06-20", to: "2016-02-11", note: "WTI from about $107 to $26" },
};

/** Shocks over the horizon: factor moves (fractions for prices, percentage points for the yield) and per-ticker moves. */
export type Shock = { factors: Partial<Record<Factor, number>>; tickers: Record<string, number>; text: string; reasoning?: string; sources?: { label: string; url: string }[] };

const WORDS: [RegExp, Factor][] = [[/\b(oil|crude|wti|brent)\b/i, "oil"], [/\b(gas|henry hub|natgas|natural gas)\b/i, "gas"], [/\b(rates?|yields?|treasur(y|ies)|10-?year)\b/i, "rates"], [/\b(market|s&p|stocks|equities|spx)\b/i, "market"], [/\b(energy stocks|energy sector|energy equities|oil stocks|xle)\b/i, "energy"]];

/** Read "oil -30%, rates +150bp, KMI -10%" by rule; returns what it understood and what it did not. Pure. */
export function parseShock(text: string, tickers: string[] = []): { shock: Shock; leftover: string } {
  const shock: Shock = { factors: {}, tickers: {}, text };
  const leftover: string[] = [];
  for (const part of text.split(/[,;]|\band\b/).map((p) => p.trim()).filter(Boolean)) {
    const bp = /([+-]?\d+(?:\.\d+)?)\s*(bp|bps|basis points?)/i.exec(part);
    const pct = /([+-]?\d+(?:\.\d+)?)\s*%/.exec(part);
    const up = /\b(up|rise|rises|higher|jump|spike)\b/i.test(part), down = /\b(down|fall|falls|drop|drops|lower|crash|plunge|cut)\b/i.test(part);
    const signed = (v: number, raw: string) => (/^[+-]/.test(raw) ? v : down && !up ? -Math.abs(v) : Math.abs(v));
    const ticker = tickers.find((t) => new RegExp(`\\b${t.replace(/[.-]/g, "\\$&")}\\b`, "i").test(part));
    const factor = ticker ? null : (WORDS.find(([re]) => re.test(part))?.[1] ?? null);
    if (factor === "rates" && (bp || pct)) { shock.factors.rates = bp ? signed(Number(bp[1]), bp[1]) / 100 : signed(Number(pct![1]), pct![1]); continue; }
    if ((factor || ticker) && pct) { const v = signed(Number(pct[1]), pct[1]) / 100; if (ticker) shock.tickers[ticker] = v; else shock.factors[factor!] = v; continue; }
    leftover.push(part);
  }
  return { shock, leftover: leftover.join(", ") };
}

const Translated = z.object({
  factors: z.object({ market: z.number().nullable(), energy: z.number().nullable(), oil: z.number().nullable(), gas: z.number().nullable(), rates: z.number().nullable() }).describe("moves over the horizon: fractions for prices (-0.3 is down 30%), percentage points for the 10-year yield; null when not affected"),
  tickers: z.array(z.object({ ticker: z.string(), move: z.number().describe("the extra move for this company's shares beyond the factors, as a fraction") })),
  reasoning: z.string().describe("two or three sentences on how the event maps to these moves"),
});

/** A written shock turned into factor and company moves: by rule where possible, by a small model for the rest. */
export async function shockFromText(text: string, tickers: string[]): Promise<Shock> {
  const { shock, leftover } = parseShock(text, tickers);
  if (!leftover || leftover.replace(/[^a-z]/gi, "").length < 4) return shock;
  try {
    const r = await structured(Translated, "edge-scen-shock", `You translate a described event into market moves for a scenario over its horizon: the U.S. stock market, oil and gas stocks, WTI crude, Henry Hub gas, the 10-year Treasury yield, and extra moves for the named companies (${tickers.join(", ") || "none named"}). Be proportionate and plain; leave unaffected factors null.`,
      `Event: ${leftover}${Object.keys(shock.factors).length ? `\nAlready set: ${JSON.stringify(shock.factors)}` : ""}`, { override: { model: "gpt-5.6-luna", effort: "low" }, maxTokens: 500, timeoutMs: 40_000 });
    for (const f of FACTORS) if (shock.factors[f] === undefined && r.data.factors[f] !== null) shock.factors[f] = r.data.factors[f]!;
    for (const t of r.data.tickers) if (tickers.includes(t.ticker.toUpperCase()) && shock.tickers[t.ticker.toUpperCase()] === undefined) shock.tickers[t.ticker.toUpperCase()] = t.move;
    shock.reasoning = r.data.reasoning;
  } catch (e) { logError(e, { where: "edge-scen-shock" }); }
  return shock;
}

/** A shock in words, for labels. Pure. */
export function describeShock(s: Shock): string {
  const parts = FACTORS.filter((f) => s.factors[f] !== undefined).map((f) => (f === "rates" ? `${FACTOR_LABEL[f]} ${s.factors[f]! >= 0 ? "+" : ""}${Math.round(s.factors[f]! * 100)}bp` : `${FACTOR_LABEL[f]} ${s.factors[f]! >= 0 ? "+" : ""}${Math.round(s.factors[f]! * 100)}%`));
  for (const [t, v] of Object.entries(s.tickers)) parts.push(`${t} ${v >= 0 ? "+" : ""}${Math.round(v * 100)}%`);
  return parts.join(", ") || "no change";
}

export type Proposal = { title: string; kind: "event" | "tail"; reasoning: string; shock: Shock; horizon: number; sources: { label: string; url: string }[]; probability?: string };

const Proposed = z.object({
  scenarios: z.array(z.object({
    title: z.string(), reasoning: z.string().describe("why this could happen now and how it moves prices, citing the numbered items"),
    cites: z.array(z.number().int()), horizon: z.number().int().describe("trading days, 10 to 120"),
    factors: Translated.shape.factors, tickers: Translated.shape.tickers,
  })).max(4),
});

/** Scenarios proposed from what is happening: recent Newsroom stories, Earth's findings and the graph's red flags about these companies. */
export async function eventProposals(tickers: string[]): Promise<Proposal[]> {
  const db = requireDb();
  const since = new Date(Date.now() - 5 * 86_400_000);
  const stories = await db.select({ id: schema.newsClusters.id, headline: schema.newsClusters.headline, summary: schema.newsClusters.summary })
    .from(schema.newsClusters).where(and(gte(schema.newsClusters.updatedAt, since), tickers.length ? sql`${schema.newsClusters.tickers} ?| array[${sql.join(tickers.map((t) => sql`${t}`), sql`, `)}]` : sql`true`)).orderBy(desc(schema.newsClusters.updatedAt)).limit(12).catch(() => []);
  const findings = tickers.length ? await db.select({ id: schema.edgeDetections.id, title: schema.edgeDetections.title, summary: schema.edgeDetections.summary, module: schema.edgeDetections.module })
    .from(schema.edgeDetections).where(and(gte(schema.edgeDetections.detectedAt, new Date(Date.now() - 30 * 86_400_000)), sql`${schema.edgeDetections.tickers} ?| array[${sql.join(tickers.map((t) => sql`${t}`), sql`, `)}]`)).orderBy(desc(schema.edgeDetections.detectedAt)).limit(10) : [];
  const items = [
    ...stories.map((s) => ({ label: s.headline, text: `${s.headline}. ${s.summary ? [...s.summary.bullets, s.summary.why].join(" ") : ""}`.slice(0, 600), url: `/app/news?story=${s.id}` })),
    ...findings.map((f) => ({ label: f.title, text: `${f.title}. ${f.summary}`.slice(0, 500), url: `/app/edge?view=feed#card-${f.id}` })),
  ];
  if (!items.length) return [];
  try {
    const r = await structured(Proposed, "edge-scen-events", `You propose market scenarios an analyst covering ${tickers.join(", ") || "energy"} should stress-test now, grounded only in the numbered items (news, satellite findings, filing red flags). For each: a short title, the reasoning citing items by number, a horizon, and the moves it implies (fractions for prices, percentage points for the 10-year yield, extra moves for named companies).`,
      items.map((x, i) => `[${i + 1}] ${x.text}`).join("\n"), { override: { model: "gpt-5.6-luna", effort: "low" }, maxTokens: 1600, timeoutMs: 60_000 });
    return r.data.scenarios.map((s) => ({
      title: s.title, kind: "event" as const, reasoning: s.reasoning, horizon: Math.max(10, Math.min(120, s.horizon)),
      shock: toShock(s.factors, s.tickers, tickers, s.title), sources: [...new Set(s.cites)].map((n) => items[n - 1]).filter(Boolean).map((x) => ({ label: x.label, url: x.url })),
    }));
  } catch (e) { logError(e, { where: "edge-scen-events" }); return []; }
}

const Tails = z.object({
  scenarios: z.array(z.object({
    title: z.string(), reasoning: z.string().describe("the chain of events, step by step, and why markets would react this way"),
    probability: z.string().describe("a rough sense of how unlikely, in words (for example 'a few percent a year')"),
    horizon: z.number().int(), factors: Translated.shape.factors, tickers: Translated.shape.tickers,
  })).max(3),
});

/** AI-imagined tail risks for these companies: unlikely, severe, and reasoned; labeled as imagined everywhere. */
export async function tailRisks(tickers: string[]): Promise<Proposal[]> {
  try {
    const r = await structured(Tails, "edge-scen-tails", "You imagine tail risks for an investment analyst: plausible but unlikely events that would hit these companies hard and are not already the consensus worry. Reason step by step from mechanism to price moves; be specific about the region and the channel (pipelines, contracts, commodity prices, rates, regulation). Moves are fractions for prices and percentage points for the 10-year yield.",
      `Companies: ${tickers.join(", ") || "U.S. energy and midstream"}`, { override: { model: "gpt-5.6-luna", effort: "medium" }, maxTokens: 1800, timeoutMs: 90_000 });
    return r.data.scenarios.map((s) => ({ title: s.title, kind: "tail" as const, reasoning: s.reasoning, probability: s.probability, horizon: Math.max(10, Math.min(252, s.horizon)), shock: toShock(s.factors, s.tickers, tickers, s.title), sources: [] }));
  } catch (e) { logError(e, { where: "edge-scen-tails" }); return []; }
}

function toShock(f: z.infer<typeof Translated>["factors"], t: z.infer<typeof Translated>["tickers"], tickers: string[], text: string): Shock {
  const shock: Shock = { factors: {}, tickers: {}, text };
  for (const k of FACTORS) if (f[k] !== null && Number.isFinite(f[k])) shock.factors[k] = Math.max(-0.95, Math.min(k === "rates" ? 5 : 3, f[k]!));
  for (const x of t) { const tk = x.ticker.toUpperCase(); if (tickers.includes(tk) && Number.isFinite(x.move)) shock.tickers[tk] = Math.max(-0.95, Math.min(3, x.move)); }
  return shock;
}

