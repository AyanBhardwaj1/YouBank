/**
 * The Thesis Agent's (E7) tools: a fixed, typed set over Edge's own audited data, never open browsing and never
 * code. Each wraps an existing free function and returns its result as a passage the agent can quote:
 * - crosswalk: who a company is in every scheme Edge knows (F1);
 * - precedents: deals like a company and their multiple range (E1);
 * - pulse: hiring, attention, awards, layoffs and patents with recent changes (E3);
 * - deal_odds: the Deal Radar's calibrated 12-month sale odds with reasons (E4);
 * - series: one signal series from the store (F2).
 * Claims are checked against these passages by Calibrated Claims' verifier (E2). All are free and safe in
 * background work (none opens a premium scope); a tool marked premium is refused outside a scope holding it.
 */
import { and, gte, or, sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { premiumOn } from "@/lib/billing/use";
import { buildQuery } from "../deals/query";
import { similarDeals } from "../deals/store";
import { companyNode, idsOf } from "../entities/resolve";
import { oddsFor } from "../odds/score";
import { pulseOf } from "../pulse/ingest";
import { metricDef } from "../series/metrics";
import { readSeries } from "../series/store";
import type { MonitorData } from "./monitors";
import type { Monitor, ToolName } from "./types";

export type ToolOutput = { id: string; tool: string; args: Record<string, string | number>; header: string; text: string; url?: string; data: unknown; at: string };
export type ToolDef = { name: ToolName; description: string; costUsd: number; premium?: string; run: (args: Record<string, string | number>) => Promise<Omit<ToolOutput, "id" | "at">> };

const pct = (v: number | null | undefined, dp = 1) => (v === null || v === undefined || !Number.isFinite(v) ? "n/a" : `${(v * 100).toFixed(dp)}%`);
const T = (a: Record<string, string | number>) => String(a.ticker ?? "").toUpperCase();
const need = async (ticker: string) => { const n = await companyNode(ticker); if (!n) throw Object.assign(new Error(`${ticker} is not in SEC's list.`), { status: 404 }); return n; };

export const TOOL_DEFS: Record<ToolName, ToolDef> = {
  crosswalk: {
    name: "crosswalk", description: "Who a company is: its name, CIK and its ids in other schemes (domain, job boards, Wikipedia).", costUsd: 0,
    async run(args) {
      const t = T(args), n = await need(t);
      const ids = await idsOf(n.id);
      const text = `${n.name} (${t}), SEC CIK ${n.cik}. Known ids: ${Object.entries(ids).map(([k, v]) => `${k} ${(v ?? []).join(", ")}`).join("; ") || "none beyond the SEC registry"}.`;
      return { tool: "crosswalk", args, header: `${n.name} (${t}) · Edge entity crosswalk`, text, data: { ticker: t, name: n.name, cik: n.cik, ids } };
    },
  },
  precedents: {
    name: "precedents", description: "Deals like a company from EDGAR merger filings, with EV/EBITDA median, interquartile range and the tested band.", costUsd: 0,
    async run(args) {
      const t = T(args);
      const q = await buildQuery({ ticker: t, buyerType: typeof args.buyer === "string" ? args.buyer : undefined });
      if (!q) return { tool: "precedents", args, header: `${t} · Edge deal database`, text: `The deal database cannot describe ${t} yet, so no precedents.`, data: { count: 0 } };
      const years = Number(args.years) || 8;
      const r = await similarDeals(q, { from: new Date(Date.now() - years * 365 * 86_400_000).toISOString().slice(0, 10) }, 10);
      const ev = r.range.evEbitda;
      const text = `${r.results.length} deals like ${t} in the last ${years} years${ev ? `: EV/EBITDA median ${ev.median.toFixed(1)}x, interquartile ${ev.p25.toFixed(1)}x to ${ev.p75.toFixed(1)}x (${ev.n} deals)` : ""}. ${r.results.slice(0, 5).map((d) => `${d.targetName || "a target"} by ${d.acquirerName || "a buyer"} (${String(d.announcedAt ?? "").slice(0, 7)}${d.evEbitda ? `, ${d.evEbitda.toFixed(1)}x` : ""})`).join("; ")}.`;
      return { tool: "precedents", args, header: `${t} · Edge deal database (EDGAR merger filings)`, text, data: { count: r.results.length, median: ev?.median ?? null, p25: ev?.p25 ?? null, p75: ev?.p75 ?? null, deals: r.results.slice(0, 10).map((d) => ({ id: d.id, target: d.targetName, buyer: d.acquirerName, announced: d.announcedAt, evEbitda: d.evEbitda })) } };
    },
  },
  pulse: {
    name: "pulse", description: "A company's hiring, attention, federal awards, layoff notices and patents: latest values, recent changes and findings.", costUsd: 0,
    async run(args) {
      const t = T(args), n = await need(t);
      const p = await pulseOf(n.id);
      if (!p) return { tool: "pulse", args, header: `${t} · Edge Alt-Data Pulse`, text: `No Pulse series stored for ${t} yet.`, url: `/app/edge?view=pulse&ticker=${t}`, data: { findings: [] } };
      const latest = Object.entries(p.series).filter(([m]) => !m.startsWith("jobs.dept.") && !m.startsWith("jobs.tell.")).slice(0, 8).map(([m, pts]) => { const a = pts.at(-1)?.value, b = pts.at(-7)?.value; return `${metricDef(m)?.label ?? m} ${a ?? "n/a"}${a !== undefined && b ? ` (${a >= b ? "+" : ""}${Math.round((a / b - 1) * 100)}% over six weeks)` : ""}`; });
      const text = `${p.name}: ${latest.join("; ") || "no series"}. Recent findings: ${p.findings.slice(0, 4).map((f) => `${f.title} (${String(f.observedAt ?? "").slice(0, 10)})`).join("; ") || "none"}.`;
      return { tool: "pulse", args, header: `${p.name} (${t}) · Edge Alt-Data Pulse`, text, url: `/app/edge?view=pulse&ticker=${t}`, data: { findings: p.findings.slice(0, 20).map((f) => ({ kind: f.kind, title: f.title, observedAt: f.observedAt ? String(f.observedAt) : null })) } };
    },
  },
  deal_odds: {
    name: "deal_odds", description: "The Deal Radar's calibrated probability that a company announces an agreement to be acquired within 12 months, with its interval, sector base rate and reasons.", costUsd: 0,
    async run(args) {
      const t = T(args), n = await need(t);
      const o = await oddsFor(n.id);
      if (!o) return { tool: "deal_odds", args, header: `${t} · Edge Deal Radar`, text: `${t} is not scored by the Deal Radar.`, data: { p: null } };
      const text = `${o.name} (${t}): model probability ${pct(o.p)} of an announced agreement to be acquired within 12 months (interval ${pct(o.low)} to ${pct(o.high)}), against a ${pct(o.base)} sector base rate. Reasons: ${o.reasons.slice(0, 3).map((r) => `${r.direction === "up" ? "raises" : "lowers"} it: ${r.label}`).join("; ") || "none listed"}. Model ${o.version}, scored ${o.at.slice(0, 10)}.`;
      return { tool: "deal_odds", args, header: `${o.name} (${t}) · Edge Deal Radar ${o.version}`, text, url: `/app/edge?view=radar&ticker=${t}`, data: { p: o.p, low: o.low, high: o.high, base: o.base } };
    },
  },
  series: {
    name: "series", description: "One stored signal series for a company (e.g. jobs.open, wiki.views, usasp.obligated, odds.target12), its latest value and recent change.", costUsd: 0,
    async run(args) {
      const t = T(args), n = await need(t), metric = String(args.metric ?? "jobs.open");
      const s = (await readSeries(n.id, { metrics: [metric] }))[metric] ?? [];
      const last = s.at(-1), prev = s.at(-7);
      const text = s.length ? `${n.name} (${t}) ${metricDef(metric)?.label ?? metric}: ${last!.value} in the week of ${last!.period}${prev && prev.value ? `, ${last!.value >= prev.value ? "+" : ""}${Math.round((last!.value / prev.value - 1) * 100)}% against ${prev.period}` : ""}; ${s.length} points stored.` : `No ${metric} series stored for ${t}.`;
      return { tool: "series", args, header: `${n.name} (${t}) · Edge signal store: ${metric}`, text, data: { points: s.slice(-60) } };
    },
  },
};

/** Run a tool: refused when it is premium and the scope does not hold it. */
export async function callTool(defs: Record<string, ToolDef>, name: string, args: Record<string, string | number>): Promise<Omit<ToolOutput, "id" | "at">> {
  const d = defs[name];
  if (!d) throw Object.assign(new Error(`The agent has no tool called ${name}.`), { status: 400 });
  if (d.premium && !premiumOn(d.premium)) throw Object.assign(new Error(`${name} needs a plan that includes it.`), { status: 402 });
  return d.run(args);
}

/** The data a kill monitor reads. */
export async function monitorData(m: Monitor): Promise<MonitorData | null> {
  const n = await companyNode(m.ticker);
  if (!n) return null;
  if (m.tool === "deal_odds") { const o = await oddsFor(n.id); return { tool: "deal_odds", p: o?.p ?? null }; }
  if (m.tool === "series") return { tool: "series", points: (await readSeries(n.id, { metrics: [m.metric] }))[m.metric] ?? [] };
  if (m.tool === "pulse") { const p = await pulseOf(n.id); return { tool: "pulse", findings: (p?.findings ?? []).map((f) => ({ kind: f.kind, title: f.title, observedAt: f.observedAt ? String(f.observedAt) : null })) }; }
  const since = new Date(Date.now() - 400 * 86_400_000).toISOString().slice(0, 10);
  const rows = await requireDb().select({ target: schema.edgeDeals.targetNode, acquirer: schema.edgeDeals.acquirerNode, announced: schema.edgeDeals.announcedAt, targetName: schema.edgeDeals.targetName, acquirerName: schema.edgeDeals.acquirerName })
    .from(schema.edgeDeals).where(and(sql`${schema.edgeDeals.ownerId} is null`, gte(schema.edgeDeals.announcedAt, since), or(sql`${schema.edgeDeals.targetNode} = ${n.id}`, sql`${schema.edgeDeals.acquirerNode} = ${n.id}`))).limit(20);
  return { tool: "deal", events: rows.map((r) => ({ role: r.target === n.id ? "target" as const : "acquirer" as const, announced: String(r.announced ?? ""), counterparty: r.target === n.id ? r.acquirerName : r.targetName })) };
}
