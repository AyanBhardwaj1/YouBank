/**
 * Training the deal model. The graph goes to the ML service as companies (with size, industry and home
 * state as features), the people, funds, joint ventures and firms that connect them, dated links, and
 * third-party deals; affiliate roll-ups stay in the graph as links but never count as deals, so the
 * scorecard is not flattered by a parent buying in its own MLP. The service trains a relational
 * GraphSAGE model, backtests it on the latest deals against a simple baseline, and returns every
 * company's likely buyers and targets, which are stored with the model's scorecard.
 */
import { and, desc, eq, lt, sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { logError } from "@/lib/errors";
import type { MlDone } from "../infra/ml";
import { mlReady, mlStart } from "../infra/ml";
import { getJson, putJson, r2Ready } from "../infra/r2";
import { sameGroup } from "./deals";
import { isDealVehicle } from "./parse";
import { ENERGY_SICS } from "./universe";

const SICS = Object.keys(ENERGY_SICS);
const STATES = ["TX", "OK", "CO", "PA", "LA", "NM", "WV", "ND", "WY", "CA"];
/** Link kinds that are deals, and so never passed to the model as ordinary links. */
const DEAL = "acquired";

export type Metrics = { hits5: number | null; hits10: number | null; mrr: number | null; n: number; asTarget?: { hits5: number | null; n: number }; asAcquirer?: { hits5: number | null; n: number } };
export type ModelMetrics = { gnn?: Metrics; baseline?: Metrics; info?: Record<string, unknown>; splitDate?: string; exported?: Record<string, number>; error?: string };

/** A company's features for the model: size, industry, home state, how connected it is. Pure. */
export function companyFeatures(a: { sic?: string; state?: string; assets?: number | null; revenue?: number | null; private?: boolean; ticker?: string }, degree: { subsidiaries: number; directors: number; holders: number; deals: number }): number[] {
  const log = (x: number | null | undefined) => (x && x > 0 ? Math.log10(x / 1e6 + 1) : 0);
  return [
    log(a.assets), log(a.revenue), a.assets || a.revenue ? 1 : 0, a.ticker ? 1 : 0, a.private ? 1 : 0,
    ...SICS.map((s) => (a.sic === s ? 1 : 0)), a.sic && !SICS.includes(a.sic) ? 1 : 0,
    ...STATES.map((s) => (a.state === s ? 1 : 0)), a.state && !STATES.includes(a.state) ? 1 : 0,
    Math.log1p(degree.subsidiaries), Math.log1p(degree.directors), Math.log1p(degree.holders), Math.log1p(degree.deals),
  ];
}

/** Where to cut the backtest: before the last twenty deals when there are forty or more, else at 80%. Pure. */
export function splitDateFor(dates: string[]): string {
  const d = [...dates].sort();
  if (!d.length) return new Date().toISOString().slice(0, 10);
  return d.length >= 40 ? d[d.length - 20] : d[Math.floor(d.length * 0.8)];
}

/** "The actual buyer was in its top 5 for 11 of the last 20 deals": a model's record in words. Pure. */
export function scorecardText(m: ModelMetrics | null | undefined, direction: "acquirers" | "targets"): string {
  const x = direction === "acquirers" ? m?.gnn?.asTarget : m?.gnn?.asAcquirer;
  const base = direction === "acquirers" ? m?.baseline?.asTarget : m?.baseline?.asAcquirer;
  if (!x?.n || x.hits5 === null) return "Not backtested yet.";
  const hits = Math.round(x.hits5 * x.n);
  const what = direction === "acquirers" ? "the actual buyer was among its top 5 likely buyers" : "the actual target was among its top 5 likely targets";
  const vs = base?.hits5 !== null && base?.hits5 !== undefined ? ` (a simple baseline: ${Math.round(base.hits5 * base.n)} of ${base.n})` : "";
  return `In a backtest on the ${x.n} most recent deals, ${what} for ${hits} of ${x.n}${vs}.`;
}

type LinkRowLite = { src: number; dst: number; kind: string; as_of: string | null; relation: string | null };

/** The graph as the ML service reads it, plus what went in. */
export async function exportGraph() {
  const db = requireDb();
  const links = (await db.execute(sql`select src, dst, kind, as_of::text, attrs->>'relation' as relation from edge_links`)).rows as LinkRowLite[];
  const companies = (await db.execute(sql`select id, ticker, attrs->>'sic' as sic, attrs->>'state' as state, (attrs->>'assets')::float8 as assets, (attrs->>'revenue')::float8 as revenue, coalesce((attrs->>'private')::boolean, false) as private from edge_nodes where kind = 'company'`)).rows as { id: number; ticker: string; sic: string | null; state: string | null; assets: number | null; revenue: number | null; private: boolean }[];
  const others = (await db.execute(sql`select id, kind from edge_nodes where kind <> 'company'`)).rows as { id: number; kind: string }[];
  const isCompany = new Set(companies.map((c) => Number(c.id)));
  const degree = new Map<number, number>();
  const bump = (n: number) => degree.set(n, (degree.get(n) ?? 0) + 1);
  for (const l of links) { bump(Number(l.src)); bump(Number(l.dst)); }
  // People, funds, subsidiaries and firms matter to the model only when they connect two or more nodes.
  const keep = new Set<number>([...isCompany, ...others.filter((o) => (degree.get(Number(o.id)) ?? 0) >= 2).map((o) => Number(o.id))]);
  const deals: { acquirer: number; target: number; t: string }[] = [];
  const edges: { s: number; d: number; kind: string; t: string | null }[] = [];
  const counts = new Map<number, { subsidiaries: number; directors: number; holders: number; deals: number }>();
  const c = (id: number) => { let x = counts.get(id); if (!x) counts.set(id, (x = { subsidiaries: 0, directors: 0, holders: 0, deals: 0 })); return x; };
  for (const l of links) {
    const s = Number(l.src), d = Number(l.dst);
    if (l.kind === "subsidiary") c(s).subsidiaries++;
    if (l.kind === "director") c(d).directors++;
    if (l.kind === "holder") c(d).holders++;
    if (l.kind === DEAL && isCompany.has(s) && isCompany.has(d) && l.as_of && l.relation !== "affiliate_rollup" && l.relation !== "internal") {
      deals.push({ acquirer: s, target: d, t: l.as_of.slice(0, 10) }); c(s).deals++; c(d).deals++;
      continue;
    }
    if (!keep.has(s) || !keep.has(d)) continue;
    edges.push({ s, d, kind: l.kind === DEAL ? "rollup" : l.kind, t: l.as_of ? l.as_of.slice(0, 10) : null });
  }
  const nodes = [
    ...companies.map((co) => ({ id: Number(co.id), kind: "company", features: companyFeatures({ sic: co.sic ?? "", state: co.state ?? "", assets: co.assets, revenue: co.revenue, private: co.private, ticker: co.ticker }, c(Number(co.id))) })),
    ...others.filter((o) => keep.has(Number(o.id))).map((o) => ({ id: Number(o.id), kind: o.kind, features: [] as number[] })),
  ];
  return { graph: { nodes, edges, deals }, splitDate: splitDateFor(deals.map((d) => d.t)), stats: { nodes: nodes.length, companies: companies.length, edges: edges.length, deals: deals.length } };
}

/** Export the graph and start training on the ML service; the returned call finishes with `edge/ml.done`. */
export async function startTraining(reason: string): Promise<{ modelId: number; version: string; callId: string } | { skipped: string }> {
  if (!mlReady() || !r2Ready()) return { skipped: "The ML service or file storage is not set up." };
  const g = await exportGraph();
  if (g.stats.deals < 8) return { skipped: `Only ${g.stats.deals} dated deals between companies so far; the model needs at least 8.` };
  const version = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const key = `graph/export-${version}.json`;
  await putJson(key, g.graph);
  const [row] = await requireDb().insert(schema.edgeModels).values({ kind: "gnn-deals", version, status: "training", metrics: { exported: g.stats, splitDate: g.splitDate, reason } }).returning({ id: schema.edgeModels.id });
  try {
    // Ask for more than are kept: candidates that are gone (acquired, delisted) or related are dropped after.
    const callId = await mlStart("graph.train", { graphKey: key, splitDate: g.splitDate, topK: 80, seed: 0 }, `graph:${row.id}`);
    return { modelId: row.id, version, callId };
  } catch (e) {
    await requireDb().update(schema.edgeModels).set({ status: "failed", metrics: { exported: g.stats, splitDate: g.splitDate, error: String((e as Error).message).slice(0, 300) } }).where(eq(schema.edgeModels.id, row.id));
    throw e;
  }
}

type Predictions = { acquirers: Record<string, [number, number][]>; targets: Record<string, [number, number][]> };

/** Store a finished training run: the scorecard, and each company's likely buyers and targets. Keeps two versions. */
export async function finishTraining(modelId: number, done: MlDone | null): Promise<{ ok: boolean; predictions: number }> {
  const db = requireDb();
  const [model] = await db.select().from(schema.edgeModels).where(eq(schema.edgeModels.id, modelId));
  if (!model) return { ok: false, predictions: 0 };
  const prior = (model.metrics ?? {}) as ModelMetrics;
  if (!done?.ok || !done.result) {
    await db.update(schema.edgeModels).set({ status: "failed", metrics: { ...prior, error: (done?.error ?? "The ML service did not answer in time.").slice(0, 300) } }).where(eq(schema.edgeModels.id, modelId));
    return { ok: false, predictions: 0 };
  }
  const res = done.result as { modelKey?: string; predictionsKey?: string; metrics?: { gnn?: Metrics; baseline?: Metrics }; info?: Record<string, unknown> };
  const preds = res.predictionsKey ? await getJson<Predictions>(res.predictionsKey) : null;
  // Only companies that can still do a deal: listed today (so not acquired or delisted), not a deal vehicle, never the
  // subject's own affiliate...
  // ...and whose own filings Edge has read (companies only mentioned in someone else's filing are thinly described).
  const all = (await db.execute(sql`select id, name, ticker, coalesce((attrs->>'private')::boolean, false) as private, attrs ? 'seen' as read from edge_nodes where kind = 'company'`)).rows as { id: number; name: string; ticker: string; private: boolean; read: boolean }[];
  const active = new Map(all.filter((c) => c.ticker && c.read && !c.private && !isDealVehicle(c.name)).map((c) => [Number(c.id), c.name]));
  const rows: (typeof schema.edgePredictions.$inferInsert)[] = [];
  for (const [kind, table] of [["acquirer", preds?.acquirers ?? {}], ["target", preds?.targets ?? {}]] as const) {
    for (const [subject, list] of Object.entries(table)) {
      const s = Number(subject), name = active.get(s);
      if (!name) continue;
      list.filter(([cand]) => Number(cand) !== s && active.has(Number(cand)) && !sameGroup(name, active.get(Number(cand))!)).slice(0, 20)
        .forEach(([cand, score], i) => rows.push({ modelId, kind, subject: s, candidate: Number(cand), score: Number(score), rank: i + 1, reasons: [] }));
    }
  }
  for (let i = 0; i < rows.length; i += 1000) await db.insert(schema.edgePredictions).values(rows.slice(i, i + 1000));
  await db.update(schema.edgeModels).set({ status: "ready", artifactKey: res.modelKey ?? "", trainedAt: new Date(), metrics: { ...prior, gnn: res.metrics?.gnn, baseline: res.metrics?.baseline, info: res.info } }).where(eq(schema.edgeModels.id, modelId));
  // Keep this version and the one before (for "what changed"); older predictions go.
  const ready = await db.select({ id: schema.edgeModels.id }).from(schema.edgeModels).where(and(eq(schema.edgeModels.kind, "gnn-deals"), eq(schema.edgeModels.status, "ready"))).orderBy(desc(schema.edgeModels.id)).limit(3);
  if (ready.length === 3) await db.delete(schema.edgePredictions).where(lt(schema.edgePredictions.modelId, ready[1].id)).catch((e) => logError(e, { where: "edge-graph-prune" }));
  return { ok: true, predictions: rows.length };
}

/** The latest ready model, and the one before it. */
export async function latestModels(): Promise<(typeof schema.edgeModels.$inferSelect)[]> {
  return requireDb().select().from(schema.edgeModels).where(and(eq(schema.edgeModels.kind, "gnn-deals"), eq(schema.edgeModels.status, "ready"))).orderBy(desc(schema.edgeModels.id)).limit(2);
}

/** A company's likely buyers or targets from a model, best first. */
export async function predictionsFor(modelId: number, subject: number, kind: "acquirer" | "target", limit = 10) {
  return requireDb().select().from(schema.edgePredictions).where(and(eq(schema.edgePredictions.modelId, modelId), eq(schema.edgePredictions.subject, subject), eq(schema.edgePredictions.kind, kind))).orderBy(schema.edgePredictions.rank).limit(limit);
}

