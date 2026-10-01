/**
 * The topic map of a big set of documents: every passage placed on a plane by what it is about, so
 * clusters of meaning appear (and can be named). The ML service projects with UMAP; without it Edge
 * projects here with principal components and groups with k-means. A small model names each cluster
 * from a few of its passages.
 */
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { requireDb } from "@/db";
import { structured } from "@/lib/ai/agent";
import { cacheGet, cacheSet } from "@/lib/cache";
import { logError } from "@/lib/errors";
import { mlReady, mlRun } from "../infra/ml";
import { getJson, putJson, r2Ready } from "../infra/r2";
import { small } from "../models";

export type TopicMap = { points: { id: number; x: number; y: number; cluster: number; title: string; text: string }[]; clusters: { id: number; label: string; size: number }[]; method: string };

/** The first two principal components of rows of vectors (power iteration with deflation). Pure. */
export function pca2(X: number[][], iterations = 40): [number, number][] {
  const n = X.length, d = X[0]?.length ?? 0;
  if (!n || !d) return [];
  const mean = new Array(d).fill(0);
  for (const r of X) for (let j = 0; j < d; j++) mean[j] += r[j] / n;
  const C = X.map((r) => r.map((v, j) => v - mean[j]));
  const comps: number[][] = [];
  for (let c = 0; c < 2; c++) {
    let v = Array.from({ length: d }, (_, j) => Math.sin(j * 12.9898 + c * 78.233));
    for (let it = 0; it < iterations; it++) {
      const Xv = C.map((r) => r.reduce((s, x, j) => s + x * v[j], 0));
      const next = new Array(d).fill(0);
      C.forEach((r, i) => { for (let j = 0; j < d; j++) next[j] += r[j] * Xv[i]; });
      for (const p of comps) { const dot = next.reduce((s, x, j) => s + x * p[j], 0); for (let j = 0; j < d; j++) next[j] -= dot * p[j]; }
      const norm = Math.sqrt(next.reduce((s, x) => s + x * x, 0)) || 1;
      v = next.map((x) => x / norm);
    }
    comps.push(v);
  }
  return C.map((r) => [r.reduce((s, x, j) => s + x * comps[0][j], 0), r.reduce((s, x, j) => s + x * comps[1][j], 0)]);
}

/** k-means on points (deterministic farthest-first start). Pure. */
export function kmeans(P: [number, number][], k: number, iterations = 25): number[] {
  if (!P.length) return [];
  const centers: [number, number][] = [P[0]];
  while (centers.length < Math.min(k, P.length)) {
    let far = 0, farD = -1;
    P.forEach((p, i) => { const dd = Math.min(...centers.map((c) => (c[0] - p[0]) ** 2 + (c[1] - p[1]) ** 2)); if (dd > farD) { farD = dd; far = i; } });
    centers.push(P[far]);
  }
  let assign = new Array(P.length).fill(0);
  for (let it = 0; it < iterations; it++) {
    assign = P.map((p) => { let best = 0, bd = Infinity; centers.forEach((c, i) => { const dd = (c[0] - p[0]) ** 2 + (c[1] - p[1]) ** 2; if (dd < bd) { bd = dd; best = i; } }); return best; });
    centers.forEach((_, i) => { const mine = P.filter((_, j) => assign[j] === i); if (mine.length) centers[i] = [mine.reduce((s, p) => s + p[0], 0) / mine.length, mine.reduce((s, p) => s + p[1], 0) / mine.length]; });
  }
  return assign;
}

const Names = z.object({ clusters: z.array(z.object({ id: z.number().int(), label: z.string().describe("2 to 5 words") })) });

export async function topicMap(docIds: number[]): Promise<TopicMap> {
  if (!docIds.length) return { points: [], clusters: [], method: "" };
  const key = `edge:topics:v2:${createHash("sha1").update(docIds.slice().sort((a, b) => a - b).join(",")).digest("hex").slice(0, 16)}`;
  const hit = await cacheGet(key);
  if (hit) return JSON.parse(hit) as TopicMap;
  // Up to 1,500 passages, spread evenly over the documents (every k-th passage of each), so one long filing cannot crowd out the rest.
  const perDoc = Math.max(20, Math.ceil(1500 / docIds.length));
  const rows = (await requireDb().execute(sql`
    with c as (select id, doc_id, ord, embedding, text, row_number() over (partition by doc_id order by ord) as rn, count(*) over (partition by doc_id) as n
               from edge_chunks where doc_id in (${sql.join(docIds.map((i) => sql`${i}`), sql`, `)}) and embedding is not null)
    select c.id, c.embedding::text as v, left(c.text, 240) as text, d.title from c join edge_docs d on d.id = c.doc_id
    where (c.rn - 1) % greatest(1, ceil(c.n::float / ${perDoc})::int) = 0 order by c.doc_id, c.ord limit 1500`)).rows as { id: number; v: string; text: string; title: string }[];
  if (rows.length < 8) return { points: [], clusters: [], method: "too few passages" };
  const vectors = rows.map((r) => JSON.parse(r.v) as number[]);
  let xy: [number, number][] | null = null, clusters: number[] | null = null, method = "";
  if (mlReady() && r2Ready()) {
    try {
      const vk = `${key.replace(/:/g, "/")}/vectors.json`;
      await putJson(vk, { ids: rows.map((r) => Number(r.id)), vectors });
      const res = await mlRun<{ key: string }>("topics.map", { vectorsKey: vk }, 150_000);
      const out = await getJson<{ points: { id: number; x: number; y: number; cluster: number }[] }>(res.key);
      if (out?.points?.length) { const byId = new Map(out.points.map((p) => [p.id, p])); xy = rows.map((r) => { const p = byId.get(Number(r.id)); return [p?.x ?? 0, p?.y ?? 0]; }); clusters = rows.map((r) => byId.get(Number(r.id))?.cluster ?? 0); method = "UMAP and k-means on the ML service"; }
    } catch (e) { logError(e, { where: "edge-topics-ml" }); }
  }
  if (!xy || !clusters) { xy = pca2(vectors); clusters = kmeans(xy, Math.max(3, Math.min(8, Math.round(Math.sqrt(rows.length / 20))))); method = "principal components and k-means"; }
  const ids = [...new Set(clusters)].sort((a, b) => a - b);
  let labels = new Map<number, string>(ids.map((i) => [i, `Topic ${i + 1}`]));
  try {
    const sample = ids.map((i) => `Cluster ${i}:\n${rows.filter((_, j) => clusters![j] === i).slice(0, 4).map((r) => `- ${r.text}`).join("\n")}`).join("\n\n");
    const r = await structured(Names, "edge-topics", "Name each cluster of document passages in 2 to 5 plain words.", sample, { override: small(), maxTokens: 500, timeoutMs: 30_000 });
    labels = new Map(r.data.clusters.map((c) => [c.id, c.label]));
  } catch (e) { logError(e, { where: "edge-topics-names" }); }
  const map: TopicMap = {
    points: rows.map((r, j) => ({ id: Number(r.id), x: Math.round(xy![j][0] * 1000) / 1000, y: Math.round(xy![j][1] * 1000) / 1000, cluster: clusters![j], title: r.title, text: r.text })),
    clusters: ids.map((i) => ({ id: i, label: labels.get(i) ?? `Topic ${i + 1}`, size: clusters!.filter((c) => c === i).length })),
    method,
  };
  await cacheSet(key, JSON.stringify(map), 86_400_000);
  return map;
}
