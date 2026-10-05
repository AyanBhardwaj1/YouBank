/**
 * Training the deal model. The graph goes to the ML service as companies (with size, industry and home
 * state as features), the people, funds, joint ventures and firms that connect them, dated links, and
 * third-party deals; affiliate roll-ups stay in the graph as links but never count as deals, so the
 * scorecard is not flattered by a parent buying in its own MLP. The service trains a relational
 * GraphSAGE model, backtests it on the latest deals against a features-only baseline, and returns every
 * company's likely buyers and targets, which are stored with the model's scorecard. Two more baselines
 * (backtest.ts) are scored here on the same split, so the scorecard can say whether the model beats them.
 */
import { and, desc, eq, lt, sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { cacheJson } from "@/lib/cache";
import { logError } from "@/lib/errors";
import type { MlDone } from "../infra/ml";
import { mlReady, mlStart } from "../infra/ml";
import { getJson, putJson, r2Ready } from "../infra/r2";
import { baselineBacktest, bootstrapInterval, type DealGraph } from "./backtest";
import { sameGroup } from "./deals";
import { isDealVehicle } from "./parse";
import { ENERGY_SICS } from "./universe";

const SICS = Object.keys(ENERGY_SICS);
const STATES = ["TX", "OK", "CO", "PA", "LA", "NM", "WV", "ND", "WY", "CA"];
/** Link kinds that are deals, and so never passed to the model as ordinary links. */
const DEAL = "acquired";

/** A backtest's record on one side: how often the truth was in the top 5 and top 10, mean reciprocal rank, and how many rankings. */
export type Summary = { hits5: number | null; hits10?: number | null; mrr?: number | null; n: number };
/**
 * Both sides together and each apart, named as the ML service names them for what it scores: asTarget
 * ranks the targets of a buyer (the likely targets), asAcquirer the buyers of a target (the likely buyers).
 */
export type Metrics = Required<Summary> & { asTarget?: Summary; asAcquirer?: Summary };
/** The baselines scored here on the model's split (backtest.ts), from the graph its training read (its export) or, failing that, today's tables. */
export type FairBaselines = { adamicAdar: Metrics; acquisitiveness: Metrics; testDeals: number; splitDate: string; computedAt: string; from?: "export" | "tables" };
export type ModelMetrics = { gnn?: Metrics; baseline?: Metrics; fair?: FairBaselines; info?: Record<string, unknown>; splitDate?: string; exported?: Record<string, number>; error?: string };

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

const list = (xs: string[], and: string) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} ${and} ${xs[xs.length - 1]}`);

/**
 * A model's record in words, for likely buyers or likely targets: how often the real one was in its top
 * 10 on the latest deals, with a 90% bootstrap interval, the baselines on the same split, and plainly
 * whether the model beats each (a lead inside the model's own interval may be chance). Top 5 when a
 * record has no top-10 figure. Pure.
 */
export function scorecardText(m: ModelMetrics | null | undefined, direction: "acquirers" | "targets"): string {
  const side = (x: Metrics | undefined) => (direction === "acquirers" ? x?.asAcquirer : x?.asTarget);
  const model = side(m?.gnn);
  const top = typeof model?.hits10 === "number" ? 10 : 5;
  const rate = (x: Summary | undefined) => (x ? (top === 10 ? x.hits10 : x.hits5) ?? null : null);
  const r = rate(model);
  if (!model?.n || r === null) return "Not backtested yet.";
  const who = direction === "acquirers" ? "buyer" : "target";
  const hits = Math.round(r * model.n);
  const [lo, hi] = bootstrapInterval(hits, model.n);
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const out = [`In a backtest on the ${model.n} most recent deals, the actual ${who} was among the model's top ${top} likely ${who}s for ${hits} of ${model.n} (90% bootstrap interval ${pct(lo)} to ${pct(hi)}).`];
  // [name, short name, record, scored here rather than by the ML service]
  const named: [string, string, Summary | undefined, boolean][] = [["company features alone", "", side(m?.baseline), false], ["shared connections (Adamic-Adar)", "Adamic-Adar", side(m?.fair?.adamicAdar), true]];
  // How busy a buyer has been says nothing about which target it picks, so it is a baseline for buyers only.
  if (direction === "acquirers") named.push(["acquisitiveness (the buyer's deals in the prior 36 months)", "acquisitiveness", side(m?.fair?.acquisitiveness), true]);
  // Rates are compared as whole hits over rankings: the service rounds them to four places.
  const bases = named.flatMap(([name, short, x, here]) => { const b = rate(x); if (!x?.n || b === null) return []; const k = Math.round(b * x.n); return [{ name, short, here, b: k / x.n, hits: k, n: x.n }]; });
  if (!bases.length) return out[0];
  out.push(`Baselines on the same split: ${bases.map((b) => `${b.name} ${b.hits} of ${b.n}`).join("; ")}.`);
  const mine = bases.filter((b) => b.here);
  if (m?.fair?.from === "tables" && mine.length && m.fair.testDeals !== model.n) out.push(`${list(mine.map((b) => b.short), "and")} ${mine.length > 1 ? "were" : "was"} scored on today's graph, which holds ${m.fair.testDeals} deals from that split to the model's ${model.n}.`);
  const own = hits / model.n;
  const notBeaten = bases.filter((b) => b.b >= own), chance = bases.filter((b) => b.b < own && b.b >= lo);
  if (notBeaten.length) out.push(`The model does not beat ${list(notBeaten.map((b) => b.name), "or")}.`);
  if (chance.length) out.push(`Its lead over ${list(chance.map((b) => b.name), "and")} is inside its interval, so it may be chance.`);
  if (!notBeaten.length && !chance.length) out.push("It beats every baseline by more than its interval.");
  return out.join(" ");
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
/**
 * What a GPU retraining asks of the ML service (premium: edge.graph-gpu): twice the width, more passes
 * and twenty minutes, on its graph.train.gpu task. The CPU run keeps the service's defaults.
 */
export const GPU_TRAINING = { hidden: 128, epochs: 120, budgetSeconds: 1200 };

export async function startTraining(reason: string, opts: { gpu?: boolean } = {}): Promise<{ modelId: number; version: string; callId: string } | { skipped: string }> {
  if (!mlReady() || !r2Ready()) return { skipped: "The ML service or file storage is not set up." };
  const g = await exportGraph();
  if (g.stats.deals < 8) return { skipped: `Only ${g.stats.deals} dated deals between companies so far; the model needs at least 8.` };
  const version = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const key = `graph/export-${version}.json`;
  await putJson(key, g.graph);
  const [row] = await requireDb().insert(schema.edgeModels).values({ kind: "gnn-deals", version, status: "training", metrics: { exported: g.stats, splitDate: g.splitDate, reason, ...(opts.gpu ? { device: "gpu" } : {}) } }).returning({ id: schema.edgeModels.id });
  try {
    // Ask for more than are kept: candidates that are gone (acquired, delisted) or related are dropped after.
    const callId = opts.gpu
      ? await mlStart("graph.train.gpu", { graphKey: key, splitDate: g.splitDate, topK: 80, seed: 0, ...GPU_TRAINING }, `graph:${row.id}`)
      : await mlStart("graph.train", { graphKey: key, splitDate: g.splitDate, topK: 80, seed: 0 }, `graph:${row.id}`);
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
  // The baselines on the same split and graph; the scorecard does without them if this fails.
  const fair = prior.splitDate ? await fairBaselines(model, prior.splitDate).catch((e) => { logError(e, { where: "edge-graph-baselines" }); return undefined; }) : undefined;
  await db.update(schema.edgeModels).set({ status: "ready", artifactKey: res.modelKey ?? "", trainedAt: new Date(), metrics: { ...prior, gnn: res.metrics?.gnn, baseline: res.metrics?.baseline, info: res.info, ...(fair ? { fair } : {}) } }).where(eq(schema.edgeModels.id, modelId));
  // Keep this version and the one before (for "what changed"); older predictions go.
  const ready = await db.select({ id: schema.edgeModels.id }).from(schema.edgeModels).where(and(eq(schema.edgeModels.kind, "gnn-deals"), eq(schema.edgeModels.status, "ready"))).orderBy(desc(schema.edgeModels.id)).limit(3);
  if (ready.length === 3) await db.delete(schema.edgePredictions).where(lt(schema.edgePredictions.modelId, ready[1].id)).catch((e) => logError(e, { where: "edge-graph-prune" }));
  return { ok: true, predictions: rows.length };
}

/**
 * The baselines (backtest.ts) on a model's split, scored on the very graph its training read (the export
 * it left in file storage), or where that is gone, on the graph tables as they stand, leaving out deals
 * dated after the model was trained.
 */
export async function fairBaselines(model: { version: string; trainedAt: Date }, splitDate: string): Promise<FairBaselines> {
  const saved = r2Ready() ? await getJson<DealGraph>(`graph/export-${model.version}.json`).catch(() => null) : null;
  const b = saved ? baselineBacktest(saved, splitDate) : baselineBacktest((await exportGraph()).graph, splitDate, { until: model.trainedAt.toISOString().slice(0, 10) });
  return { adamicAdar: b.adamicAdar, acquisitiveness: b.acquisitiveness, testDeals: b.testDeals, splitDate, computedAt: new Date().toISOString(), from: saved ? "export" : "tables" };
}

/**
 * A model's metrics with the baselines merged in: stored with the model when its training finished, or,
 * for a model trained before they were, scored once on its split (fairBaselines) and cached.
 */
export async function withBaselines(model: { id: number; version: string; metrics: unknown; trainedAt: Date }): Promise<ModelMetrics> {
  const m = (model.metrics ?? {}) as ModelMetrics;
  if (m.fair || !m.splitDate || !m.gnn) return m;
  const split = m.splitDate;
  const fair = await cacheJson(`edge:graph:fair:v1:${model.id}`, 30 * 86_400_000, () => fairBaselines(model, split)).catch(() => null);
  return fair ? { ...m, fair } : m;
}

/** The latest ready model, and the one before it. */
export async function latestModels(): Promise<(typeof schema.edgeModels.$inferSelect)[]> {
  return requireDb().select().from(schema.edgeModels).where(and(eq(schema.edgeModels.kind, "gnn-deals"), eq(schema.edgeModels.status, "ready"))).orderBy(desc(schema.edgeModels.id)).limit(2);
}

/** A company's likely buyers or targets from a model, best first. */
export async function predictionsFor(modelId: number, subject: number, kind: "acquirer" | "target", limit = 10) {
  return requireDb().select().from(schema.edgePredictions).where(and(eq(schema.edgePredictions.modelId, modelId), eq(schema.edgePredictions.subject, subject), eq(schema.edgePredictions.kind, kind))).orderBy(schema.edgePredictions.rank).limit(limit);
}

