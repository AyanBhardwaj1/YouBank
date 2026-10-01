/**
 * Fair baselines for the deal model, scored on the graph and split the ML service trains on (train.ts
 * exports both), and ranked the way the service ranks: every company is a candidate, the anchor's other
 * real deals are not counted as misses, and ties share their middle rank. Two baselines:
 * - Adamic-Adar: the neighbours two companies share, each weighted by 1 / ln(its degree) so a director on
 *   two boards counts for more than an index fund that holds everyone; each kind of link is scored on its
 *   own and the scores are summed (deals before the split count as one more kind);
 * - acquisitiveness: how many deals a buyer did in the 36 months before the split (for likely buyers only,
 *   since it cannot tell one target from another).
 * Plus bootstrap intervals on hit rates. Pure.
 */
import type { Metrics, Summary } from "./train";

export type DealGraph = { nodes: { id: number; kind: string }[]; edges: { s: number; d: number; kind: string; t: string | null }[]; deals: { acquirer: number; target: number; t: string }[] };
export type Baselines = { adamicAdar: Metrics; acquisitiveness: Metrics; testDeals: number };

/** Hit rates and mean reciprocal rank from ranks, rounded as the ML service rounds them. Pure. */
export function summarize(ranks: number[]): Required<Summary> {
  if (!ranks.length) return { hits5: null, hits10: null, mrr: null, n: 0 };
  const r4 = (x: number) => Math.round(x * 10_000) / 10_000;
  const share = (k: number) => r4(ranks.filter((r) => r <= k).length / ranks.length);
  return { hits5: share(5), hits10: share(10), mrr: r4(ranks.reduce((s, r) => s + 1 / r, 0) / ranks.length), n: ranks.length };
}

/** The truth's rank among the candidates by score (1 is best; a candidate with no score scores 0), ties at their middle, skipping some. Pure. */
export function midRank(scores: Map<number, number>, candidates: number[], truth: number, skip: Set<number>): number {
  const t = scores.get(truth) ?? 0;
  let above = 0, tied = 0;
  for (const c of candidates) {
    if (c === truth || skip.has(c)) continue;
    const s = scores.get(c) ?? 0;
    if (s > t) above++; else if (s === t) tied++;
  }
  return 1 + above + 0.5 * tied;
}

/** Each kind of link as an undirected graph: kind, then node, then its distinct neighbours. Pure. */
export function adjacencyByKind(edges: { s: number; d: number; kind: string }[]): Map<string, Map<number, Set<number>>> {
  const out = new Map<string, Map<number, Set<number>>>();
  const add = (g: Map<number, Set<number>>, a: number, b: number) => { const x = g.get(a); if (x) x.add(b); else g.set(a, new Set([b])); };
  for (const e of edges) {
    if (e.s === e.d) continue;
    let g = out.get(e.kind);
    if (!g) out.set(e.kind, (g = new Map()));
    add(g, e.s, e.d); add(g, e.d, e.s);
  }
  return out;
}

/** Adamic-Adar from one node to every other: each neighbour z they share adds 1 / ln(degree of z), within each kind of link, summed over kinds. Pure. */
export function adamicAdarFrom(adj: Map<string, Map<number, Set<number>>>, anchor: number): Map<number, number> {
  const out = new Map<number, number>();
  for (const g of adj.values()) {
    for (const z of g.get(anchor) ?? []) {
      const around = g.get(z)!;
      if (around.size < 2) continue;
      const w = 1 / Math.log(around.size);
      for (const c of around) if (c !== anchor) out.set(c, (out.get(c) ?? 0) + w);
    }
  }
  return out;
}

/**
 * Both baselines on the model's split: the graph as it stood before `split` (links dated before it or
 * undated, and earlier deals), tested on the deals dated on or after it (and, for a model trained earlier,
 * no later than `until`). Pure.
 */
export function baselineBacktest(g: DealGraph, split: string, opts: { until?: string } = {}): Baselines {
  const companies = [...new Set(g.nodes.filter((n) => n.kind === "company").map((n) => n.id))];
  const isCompany = new Set(companies);
  const deals = g.deals.map((d) => ({ ...d, t: (d.t ?? "").slice(0, 10) })).filter((d) => d.t && d.acquirer !== d.target && isCompany.has(d.acquirer) && isCompany.has(d.target));
  const test = deals.filter((d) => d.t >= split && (!opts.until || d.t <= opts.until));
  const byAcquirer = new Map<number, Set<number>>(), byTarget = new Map<number, Set<number>>();
  for (const d of deals) {
    (byAcquirer.get(d.acquirer) ?? byAcquirer.set(d.acquirer, new Set()).get(d.acquirer)!).add(d.target);
    (byTarget.get(d.target) ?? byTarget.set(d.target, new Set()).get(d.target)!).add(d.acquirer);
  }
  const known = g.edges.filter((e) => !e.t || e.t.slice(0, 10) < split).map((e) => ({ s: e.s, d: e.d, kind: e.kind }));
  for (const d of deals) if (d.t < split) known.push({ s: d.acquirer, d: d.target, kind: "deal" });
  const adj = adjacencyByKind(known);
  const aa = new Map<number, Map<number, number>>();
  const aaFrom = (x: number) => { let m = aa.get(x); if (!m) aa.set(x, (m = adamicAdarFrom(adj, x))); return m; };
  // Deals each buyer did in the 36 months before the split.
  const from = `${Number(split.slice(0, 4)) - 3}${split.slice(4)}`;
  const busy = new Map<number, number>();
  for (const d of deals) if (d.t >= from && d.t < split) busy.set(d.acquirer, (busy.get(d.acquirer) ?? 0) + 1);
  const aaTargets: number[] = [], aaBuyers: number[] = [], busyBuyers: number[] = [];
  const others = (m: Map<number, Set<number>>, key: number, truth: number) => new Set([key, ...[...(m.get(key) ?? [])].filter((x) => x !== truth)]);
  for (const d of test) {
    // The real target among likely targets for the buyer (the service's asTarget)...
    aaTargets.push(midRank(aaFrom(d.acquirer), companies, d.target, others(byAcquirer, d.acquirer, d.target)));
    // ...and the real buyer among likely buyers of the target (asAcquirer).
    const skip = others(byTarget, d.target, d.acquirer);
    aaBuyers.push(midRank(aaFrom(d.target), companies, d.acquirer, skip));
    busyBuyers.push(midRank(busy, companies, d.acquirer, skip));
  }
  return {
    adamicAdar: { ...summarize([...aaTargets, ...aaBuyers]), asTarget: summarize(aaTargets), asAcquirer: summarize(aaBuyers) },
    acquisitiveness: { ...summarize(busyBuyers), asAcquirer: summarize(busyBuyers) },
    testDeals: test.length,
  };
}

/**
 * The percentile bootstrap's interval for a hit rate of `hits` in `n`. Resampling the n outcomes with
 * replacement draws Binomial(n, hits / n) hits, so the interval is that distribution's 5th and 95th
 * percentiles (for 90%), computed exactly rather than by simulation. Pure.
 */
export function bootstrapInterval(hits: number, n: number, level = 0.9): [number, number] {
  if (!(n > 0)) return [0, 0];
  const p = Math.min(1, Math.max(0, hits / n)), tail = (1 - level) / 2;
  if (p === 0 || p === 1) return [p, p];
  // The binomial distribution, from logs so a large n cannot underflow.
  const logFact = [0];
  for (let k = 1; k <= n; k++) logFact.push(logFact[k - 1] + Math.log(k));
  let cdf = 0, lo = -1;
  for (let k = 0; k <= n; k++) {
    cdf += Math.exp(logFact[n] - logFact[k] - logFact[n - k] + k * Math.log(p) + (n - k) * Math.log(1 - p));
    if (lo < 0 && cdf >= tail - 1e-12) lo = k;
    if (cdf >= 1 - tail - 1e-12) return [lo / n, k / n];
  }
  return [Math.max(0, lo) / n, 1];
}
