/**
 * The whole graph's shape, read once a day and shared by everyone:
 * - influence: PageRank over the live links, so a company tied to many well-connected others ranks high;
 * - communities: label propagation over the links that bind companies (shared directors and officers,
 *   deals, supply, subsidiaries, and stakes of 10% or more; passive index holdings would glue
 *   everything into one blob);
 * - brokers: the people (directors and officers) whose companies sit in several communities, the
 *   introductions a banker would want; index funds touch everything and introduce no one.
 * Plain maths in TypeScript over the graph tables.
 */
import { sql } from "drizzle-orm";
import { requireDb } from "@/db";
import { cacheJson } from "@/lib/cache";

type E = [number, number, number];

/** PageRank of an undirected weighted graph on nodes 0..n-1 (dangling mass spread evenly). Pure. */
export function pagerank(n: number, edges: E[], damping = 0.85, iterations = 40): Float64Array {
  const out = new Float64Array(n);
  for (const [a, b, w] of edges) { out[a] += w; out[b] += w; }
  let r = new Float64Array(n).fill(1 / Math.max(1, n));
  for (let it = 0; it < iterations; it++) {
    const next = new Float64Array(n);
    let dangling = 0;
    for (let i = 0; i < n; i++) if (!out[i]) dangling += r[i];
    for (const [a, b, w] of edges) { next[b] += (r[a] * w) / out[a]; next[a] += (r[b] * w) / out[b]; }
    const base = (1 - damping) / n + (damping * dangling) / n;
    for (let i = 0; i < n; i++) next[i] = base + damping * next[i];
    r = next;
  }
  return r;
}

/** Communities by weighted label propagation, visiting nodes in a fixed order so results are stable. Pure. */
export function labelPropagation(n: number, edges: E[], iterations = 20): Int32Array {
  const adj: [number, number][][] = Array.from({ length: n }, () => []);
  for (const [a, b, w] of edges) { adj[a].push([b, w]); adj[b].push([a, w]); }
  const label = Int32Array.from({ length: n }, (_, i) => i);
  for (let it = 0; it < iterations; it++) {
    let changed = 0;
    for (let i = 0; i < n; i++) {
      if (!adj[i].length) continue;
      const score = new Map<number, number>();
      for (const [j, w] of adj[i]) score.set(label[j], (score.get(label[j]) ?? 0) + w);
      let best = label[i], bestScore = -1;
      for (const [l, s] of score) if (s > bestScore || (s === bestScore && l < best)) { best = l; bestScore = s; }
      if (best !== label[i]) { label[i] = best; changed++; }
    }
    if (!changed) break;
  }
  return label;
}

const RANK_WEIGHT: Record<string, number> = { director: 1, officer: 1, insider: 0.5, holder: 0.6, subsidiary: 0.5, acquired: 1.5, bought_assets: 1.2, supplies: 1, advised: 0.4 };
const BIND = new Set(["director", "officer", "acquired", "bought_assets", "supplies", "subsidiary"]);

export type GraphMetrics = {
  builtAt: string;
  /** Influence for every node but subsidiaries, scaled 0 to 1 by the most influential. */
  rank: Record<number, number>;
  /** Percentile of influence among companies, 0 to 100. */
  companyPct: Record<number, number>;
  community: Record<number, number>;
  communities: { id: number; size: number; label: string; top: { id: number; name: string; ticker: string }[] }[];
  brokers: { id: number; name: string; kind: string; communities: number; companies: number }[];
  /** For each broker, the companies they sit at. */
  brokerCompanies: Record<number, { id: number; name: string; ticker: string }[]>;
};

export async function computeMetrics(): Promise<GraphMetrics> {
  const db = requireDb();
  const [nodes, links] = await Promise.all([
    // In id order: label propagation visits nodes in row order, so a fixed order keeps the communities stable day to day.
    db.execute(sql`select id, kind, name, ticker from edge_nodes order by id`),
    db.execute(sql`select src, dst, kind, weight, coalesce((attrs->>'percent')::float, 0) as pct from edge_links where ended is null`),
  ]);
  const rows = nodes.rows as { id: number; kind: string; name: string; ticker: string }[];
  const index = new Map(rows.map((r, i) => [r.id, i]));
  const rankEdges: E[] = [], bindEdges: E[] = [];
  for (const l of links.rows as { src: number; dst: number; kind: string; weight: number; pct: number }[]) {
    const a = index.get(l.src), b = index.get(l.dst);
    if (a === undefined || b === undefined || a === b) continue;
    rankEdges.push([a, b, RANK_WEIGHT[l.kind] ?? 0.5]);
    if (BIND.has(l.kind) || (l.kind === "holder" && l.pct >= 10)) bindEdges.push([a, b, RANK_WEIGHT[l.kind] ?? 1]);
  }
  const pr = pagerank(rows.length, rankEdges);
  const label = labelPropagation(rows.length, bindEdges);
  let max = 0;
  for (let i = 0; i < rows.length; i++) if (rows[i].kind !== "subsidiary") max = Math.max(max, pr[i]);
  const rank: Record<number, number> = {};
  rows.forEach((r, i) => { if (r.kind !== "subsidiary" && max) rank[r.id] = Math.round((pr[i] / max) * 1000) / 1000; });
  const companies = rows.map((r, i) => ({ r, i })).filter((x) => x.r.kind === "company");
  const sorted = [...companies].sort((a, b) => pr[a.i] - pr[b.i]);
  const companyPct: Record<number, number> = {};
  sorted.forEach((x, k) => { companyPct[x.r.id] = Math.round((100 * (k + 1)) / sorted.length); });
  // Communities that hold at least two companies, named for their most influential company.
  const members = new Map<number, typeof companies>();
  for (const x of companies) members.set(label[x.i], [...(members.get(label[x.i]) ?? []), x]);
  const community: Record<number, number> = {};
  const communities: GraphMetrics["communities"] = [];
  for (const [id, list] of members) {
    if (list.length < 2) continue;
    const top = [...list].sort((a, b) => pr[b.i] - pr[a.i]);
    for (const x of list) community[x.r.id] = id;
    communities.push({ id, size: list.length, label: top[0].r.name, top: top.slice(0, 8).map((x) => ({ id: x.r.id, name: x.r.name, ticker: x.r.ticker })) });
  }
  communities.sort((a, b) => b.size - a.size);
  // Brokers: people on the boards or in the management of companies in two or more communities.
  const reach = new Map<number, { comms: Set<number>; cos: Set<number> }>();
  for (const l of links.rows as { src: number; dst: number; kind: string }[]) {
    if (l.kind !== "director" && l.kind !== "officer") continue;
    const who = index.get(l.src), co = l.dst;
    if (who === undefined || rows[who].kind !== "person" || community[co] === undefined) continue;
    const e = reach.get(who) ?? { comms: new Set<number>(), cos: new Set<number>() };
    e.comms.add(community[co]); e.cos.add(co); reach.set(who, e);
  }
  const brokers = [...reach.entries()].filter(([, v]) => v.comms.size >= 2).map(([i, v]) => ({ id: rows[i].id, name: rows[i].name, kind: rows[i].kind, communities: v.comms.size, companies: v.cos.size }))
    .sort((a, b) => b.communities - a.communities || b.companies - a.companies).slice(0, 60);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const brokerCompanies: GraphMetrics["brokerCompanies"] = {};
  for (const b of brokers) brokerCompanies[b.id] = [...(reach.get(index.get(b.id)!)?.cos ?? [])].slice(0, 6).map((id) => ({ id, name: byId.get(id)?.name ?? "", ticker: byId.get(id)?.ticker ?? "" }));
  return { builtAt: new Date().toISOString(), rank, companyPct, community, communities: communities.slice(0, 200), brokers, brokerCompanies };
}

/** The day's metrics (computed on first use, then shared). */
export const graphMetrics = () => cacheJson(`edge:graph:metrics:v1:${new Date().toISOString().slice(0, 10)}`, 86_400_000, computeMetrics);

/** What the metrics say about one company: its influence, its community, and the brokers among its people and funds. */
export async function companyMetrics(nodeId: number, neighbours: number[]): Promise<{ pct: number | null; community: GraphMetrics["communities"][number] | null; brokers: (GraphMetrics["brokers"][number] & { at: { id: number; name: string; ticker: string }[] })[] } | null> {
  const m = await graphMetrics().catch(() => null);
  if (!m) return null;
  const cid = m.community[nodeId];
  const near = new Set(neighbours);
  return {
    pct: m.companyPct[nodeId] ?? null, community: cid === undefined ? null : m.communities.find((c) => c.id === cid) ?? null,
    brokers: m.brokers.filter((b) => near.has(b.id)).slice(0, 5).map((b) => ({ ...b, at: (m.brokerCompanies[b.id] ?? []).filter((c) => c.id !== nodeId) })),
  };
}
