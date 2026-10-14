/**
 * The Thesis Agent's (E7) model calls, each a structured call recorded in the AI usage ledger (so it counts
 * against the owner's AI allowance) and each given only the agent's own tool outputs, never the open web:
 * - plan: the thesis as 3 to 8 falsifiable claims with rules, priors, evidence plans and kill criteria;
 * - extract: evidence items from the tick's tool outputs, each with a verbatim quote and its source id;
 * - redteam: the strongest counter-case, also quoting the tool outputs (only verified points count);
 * - premortem and synthesis: the weekly "if this fails, why" and the memo's synthesis (the deep pass on the
 *   flagship model when the owner's plan includes edge.thesis-deep).
 * The small model does the routine work; a different provider argues the red team when both keys exist.
 */
import { z } from "zod";
import { structured } from "@/lib/ai/agent";
import { availableProviders } from "@/lib/ai/config";
import { DEEP_EFFORT, deepModel } from "@/lib/ai/deep";
import { small } from "../models";
import type { ToolOutput } from "./tools";
import type { AgentState, Plan } from "./types";

const ClaimRuleZ = z.object({
  type: z.enum(["deal", "xbrl", "manual"]),
  role: z.enum(["target", "acquirer"]).optional(), ticker: z.string().optional(),
  concept: z.string().optional(), period: z.string().optional(), op: z.enum([">=", "<=", "between"]).optional(), value: z.number().optional(), high: z.number().optional(), unit: z.string().optional(),
});
const PlanZ = z.object({
  title: z.string().describe("a short title, under 80 characters"),
  companies: z.array(z.string()).describe("tickers the thesis is about"),
  claims: z.array(z.object({
    n: z.number().int(), text: z.string().describe("a falsifiable claim, never phrased with 'will'"), parent: z.number().int().nullable(),
    logic: z.enum(["all", "any", "weighted"]).optional().describe("for a parent: how its children combine"), weight: z.number().optional(),
    rule: ClaimRuleZ.describe("deal: the company is announced as target or acquirer; xbrl: a reported US-GAAP figure for a period end (YYYY-MM-DD) meets a comparison; manual: the owner settles it"),
    closes: z.string().describe("YYYY-MM-DD, inside the horizon"), prior: z.number().describe("probability between 0 and 1 before any evidence"), priorNote: z.string().describe("the reference class or reasoning for the prior"),
    evidence: z.array(z.object({ tool: z.enum(["crosswalk", "precedents", "pulse", "deal_odds", "series"]), args: z.record(z.string(), z.union([z.string(), z.number()])), why: z.string() })).min(1),
  })).min(3).max(8),
  kills: z.array(z.object({
    n: z.number().int(), text: z.string(),
    monitor: z.object({ tool: z.enum(["deal_odds", "series", "pulse", "deal"]), ticker: z.string(), op: z.string().optional(), value: z.number().optional(), metric: z.string().optional(), weeks: z.number().optional(), kind: z.string().optional(), role: z.enum(["target", "acquirer"]).optional() }),
  })).min(2).max(4),
});

const PLAN_SYSTEM = `You turn an investment or M&A thesis into a plan an agent can track for days with a fixed set of tools:
- crosswalk {ticker}: who a company is;
- precedents {ticker, years?, buyer?}: deals like it from EDGAR merger filings and their multiples;
- pulse {ticker}: hiring, attention, federal awards, layoff notices, patents and recent changes;
- deal_odds {ticker}: a calibrated 12-month probability that it announces an agreement to be acquired;
- series {ticker, metric}: one weekly signal (jobs.open, jobs.new, wiki.views, usasp.obligated, warn.employees, patents.grants, odds.target12).
Write 3 to 8 claims that together make the thesis, each falsifiable: prefer a deal rule (the company is announced as target or acquirer by the close date) or an xbrl rule (a reported figure for a fiscal period); otherwise manual. Give each a prior from a reference class where you can (state it), and one to three evidence plans using the tools above. Claims may have a parent (the claim they support) with logic all, any or weighted. Write 2 to 4 kill criteria, each a monitor: deal_odds {ticker, op ">=" or "<=", value 0-1}; series {ticker, metric, op "drop" or "rise", value as a fraction, weeks}; pulse {ticker, kind: hiring_shift | hiring_tell | attention_spike | contract_award | layoff_notice | patent_shift}; deal {ticker, role target|acquirer}. Never phrase a claim as a prediction with "will"; never give advice. Use only tickers of US-listed companies.`;

/** The plan for a thesis (the small model). */
export async function planThesis(thesis: string, tickers: string[], horizonEnd: string, today: string): Promise<Plan> {
  const r = await structured(PlanZ, "edge-thesis-plan", PLAN_SYSTEM, `Thesis: ${thesis}\nCompanies named: ${tickers.join(", ") || "(none given; name them)"}\nToday: ${today}\nHorizon ends: ${horizonEnd} (every claim closes by then)`, { override: small("medium"), maxTokens: 4000, timeoutMs: 90_000 });
  const d = r.data;
  return {
    title: d.title.slice(0, 120), companies: [...new Set(d.companies.map((t) => t.toUpperCase()).filter((t) => /^[A-Z][A-Z0-9.\-]{0,9}$/.test(t)))].slice(0, 8), model: r.model, madeAt: new Date().toISOString(),
    claims: d.claims.map((c) => ({
      n: c.n, text: c.text.slice(0, 300), parent: c.parent, logic: c.logic, weight: c.weight, closes: c.closes, prior: c.prior, priorBasis: "subjective" as const, priorNote: c.priorNote.slice(0, 200),
      rule: c.rule.type === "deal" ? { type: "deal" as const, role: c.rule.role ?? "target", ticker: (c.rule.ticker ?? "").toUpperCase() } : c.rule.type === "xbrl" && c.rule.concept && c.rule.period && c.rule.op && typeof c.rule.value === "number" ? { type: "xbrl" as const, ticker: (c.rule.ticker ?? "").toUpperCase(), concept: c.rule.concept, period: c.rule.period, op: c.rule.op, value: c.rule.value, ...(c.rule.high !== undefined ? { high: c.rule.high } : {}), ...(c.rule.unit ? { unit: c.rule.unit } : {}) } : { type: "manual" as const },
      evidence: c.evidence.slice(0, 3).map((e) => ({ tool: e.tool, args: Object.fromEntries(Object.entries(e.args).map(([k, v]) => [k, typeof v === "string" && k === "ticker" ? v.toUpperCase() : v])), why: e.why.slice(0, 200) })),
    })),
    kills: d.kills.map((k) => ({ n: k.n, text: k.text.slice(0, 240), monitor: toMonitor(k.monitor) })),
  };
}

function toMonitor(m: z.infer<typeof PlanZ>["kills"][number]["monitor"]): Plan["kills"][number]["monitor"] {
  const ticker = m.ticker.toUpperCase();
  if (m.tool === "deal_odds") return { tool: "deal_odds", ticker, op: m.op === "<=" ? "<=" : ">=", value: m.value ?? 0.1 };
  if (m.tool === "series") return { tool: "series", ticker, metric: m.metric ?? "jobs.open", op: m.op === "rise" ? "rise" : "drop", value: m.value ?? 0.3, weeks: m.weeks ?? 8 };
  if (m.tool === "pulse") return { tool: "pulse", ticker, kind: m.kind ?? "layoff_notice" };
  return { tool: "deal", ticker, role: m.role ?? "target" };
}

const Items = z.object({ items: z.array(z.object({ claim: z.number().int(), direction: z.enum(["for", "against"]), strength: z.enum(["weak", "moderate", "strong"]), statement: z.string().describe("what the source shows, in one sentence"), quote: z.string().describe("verbatim words from the source"), source: z.string().describe("the source id, e.g. T2") })).max(12) });

const passages = (outs: ToolOutput[]) => outs.map((o) => `[${o.id}] ${o.header}\n${o.text}`).join("\n\n");
const claimList = (s: Pick<AgentState, "claims">) => s.claims.map((c) => `${c.n}. ${c.text} (now ${Math.round(c.p * 100)}%)`).join("\n");

/** Evidence items from the tick's tool outputs: only what the sources show, each quoted. */
export async function extractEvidence(s: Pick<AgentState, "claims">, outs: ToolOutput[]): Promise<z.infer<typeof Items>["items"]> {
  if (!outs.length) return [];
  const r = await structured(Items, "edge-thesis-extract",
    "You read source excerpts for a tracked thesis and list evidence that bears on its claims. Only what a source states counts; quote its exact words and name its id. Strength: weak (consistent with the claim, but common), moderate (a specific, dated fact that shifts the odds), strong (close to settling it). Say nothing the sources do not say; if nothing bears on a claim, list nothing for it.",
    `Claims:\n${claimList(s)}\n\nSources:\n${passages(outs)}`, { override: small(), maxTokens: 2500, timeoutMs: 60_000 });
  return r.data.items;
}

/** The red team's model: the other provider when both keys exist, else the small model. Pure but for the environment. */
export function redteamModel(): { model: string; effort?: "low" | "medium" } {
  const have = availableProviders();
  if (have.includes("anthropic") && have.includes("openai")) return { model: process.env.EDGE_REDTEAM_MODEL?.trim() || "claude-sonnet-5-5" };
  return small("medium");
}

const Points = z.object({ points: z.array(z.object({ claim: z.number().int(), text: z.string(), quote: z.string(), source: z.string() })).max(6) });

/** The strongest counter-case to the claims that moved, quoting the sources. */
export async function redTeam(s: Pick<AgentState, "claims">, moved: number[], outs: ToolOutput[]): Promise<z.infer<typeof Points>["points"]> {
  const r = await structured(Points, "edge-thesis-redteam",
    "You are the red team for a tracked thesis. For the claims that just moved, write the strongest case against each, citing the source excerpts (exact quote and id). If the sources give no counter-evidence, say so by listing nothing. No speculation beyond the sources.",
    `Claims that moved: ${moved.join(", ")}\n${claimList(s)}\n\nSources:\n${passages(outs)}`, { override: redteamModel(), maxTokens: 1500, timeoutMs: 60_000 });
  return r.data.points;
}

/** The weekly pre-mortem: if the thesis fails, the likeliest reason, from the state. */
export async function preMortem(thesis: string, s: AgentState): Promise<string> {
  const r = await structured(z.object({ text: z.string().describe("three to five sentences") }), "edge-thesis-premortem",
    "Write a short pre-mortem for a tracked thesis: assume it failed; what is the likeliest reason, given the claims, their probabilities and the evidence log? Be specific; name the claim that would break first. No advice.",
    `Thesis: ${thesis}\n${claimList(s)}\nEvidence kept: ${s.evidence.filter((e) => e.kept).slice(-12).map((e) => `claim ${e.claim} ${e.direction}: ${e.statement}`).join("; ")}`, { override: small(), maxTokens: 600, timeoutMs: 60_000 });
  return r.data.text;
}

/** The weekly synthesis for the memo: the small model, or the deep pass on the flagship model. */
export async function synthesis(thesis: string, s: AgentState, outs: ToolOutput[], deep: boolean): Promise<{ text: string; model: string }> {
  const model = deep ? deepModel(null) : undefined;
  const r = await structured(z.object({ text: z.string().describe(deep ? "a careful synthesis of five to eight paragraphs" : "one to two paragraphs") }), deep ? "edge-thesis-deep" : "edge-thesis-synthesis",
    "Write the week's synthesis for a tracked thesis from its claims, probabilities (agent estimates), evidence log, red team and kill criteria, and the source excerpts. Say what changed, what matters most, and what would change the picture. Cite source ids for facts. Never say anything 'will' happen; never give advice.",
    `Thesis: ${thesis}\n${claimList(s)}\nKill criteria: ${s.kills.map((k) => `${k.text} (${k.status})`).join("; ")}\nEvidence: ${s.evidence.filter((e) => e.kept).slice(-20).map((e) => `claim ${e.claim} ${e.direction} (${e.strength}): ${e.statement} [${e.source}]`).join("; ")}\n\nSources:\n${passages(outs)}`,
    { override: deep && model ? { model, effort: DEEP_EFFORT } : small("medium"), maxTokens: deep ? 12_000 : 1500, timeoutMs: deep ? 240_000 : 60_000 });
  return { text: r.data.text, model: r.model };
}
