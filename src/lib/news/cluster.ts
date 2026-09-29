/**
 * One story, many sources: new items join an existing story when their headlines mean the same thing.
 * Meaning comes from a small embedding (OpenAI text-embedding-3-small at 256 dimensions, quantized to
 * int8: about 350 bytes a headline and a few cents a month), backed by word overlap when there is no
 * key. Filings join a news story only on the same ticker, a compatible category and close timing,
 * because "Acme: Material agreement" and "Acme to buy Widget for $4B" share almost no words.
 */
import OpenAI from "openai";
import { resolveAi } from "@/lib/ai/config";
import { recordUsage } from "@/lib/ai/usage";
import { noteSpend } from "./budget";
import { jaccard, tokens } from "./normalize";

export const EMBED_MODEL = "text-embedding-3-small";
export const EMBED_DIMS = 256;
const EMBED_USD_PER_TOKEN = 0.02 / 1e6;

/** Headline embeddings, or null when there is no OpenAI key (clustering then uses word overlap alone). */
export async function embed(texts: string[]): Promise<Float32Array[] | null> {
  if (!texts.length) return [];
  const cfg = resolveAi(null, { model: "gpt-5.6-luna" });
  if (cfg.provider !== "openai") return null;
  const client = new OpenAI({ apiKey: cfg.apiKey, timeout: 60_000, maxRetries: 1 });
  const out: Float32Array[] = [];
  let tokensUsed = 0;
  for (let i = 0; i < texts.length; i += 96) {
    const res = await client.embeddings.create({ model: EMBED_MODEL, input: texts.slice(i, i + 96).map((t) => t.slice(0, 500)), dimensions: EMBED_DIMS });
    for (const d of res.data.sort((a, b) => a.index - b.index)) out.push(Float32Array.from(d.embedding));
    tokensUsed += res.usage?.prompt_tokens ?? 0;
  }
  const usd = tokensUsed * EMBED_USD_PER_TOKEN;
  recordUsage({ feature: "news-embed", provider: "openai", model: EMBED_MODEL, usage: { input: tokensUsed, cached: 0, cacheWrite: 0, output: 0, reasoning: 0 }, extraCostUsd: usd });
  noteSpend(usd);
  return out;
}

/** int8-quantized, base64: direction is all that cosine needs. */
export function packVector(v: Float32Array): string {
  let max = 0;
  for (const x of v) max = Math.max(max, Math.abs(x));
  const q = new Int8Array(v.length);
  for (let i = 0; i < v.length; i++) q[i] = max ? Math.round((v[i] / max) * 127) : 0;
  return Buffer.from(q.buffer).toString("base64");
}

export function unpackVector(s: string | null | undefined): Float32Array | null {
  if (!s) return null;
  const b = Buffer.from(s, "base64");
  const q = new Int8Array(b.buffer, b.byteOffset, b.byteLength);
  return Float32Array.from(q, (x) => x / 127);
}

export function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/** The mean of a centroid of `n` members and a new member, renormalized. */
export function mergeCentroid(c: Float32Array | null, n: number, v: Float32Array): Float32Array {
  if (!c) return v;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = (c[i] * n + v[i]) / (n + 1);
  return out;
}

export type ClusterCand = { id: number; headline: string; centroid: Float32Array | null; tickers: string[]; category: string; kinds: string[]; lastAt: number; titles?: string[] };
export type ItemCand = { title: string; vec: Float32Array | null; tickers: string[]; kind: string; category: string; at: number };

const DEALISH = new Set(["deals", "funding", "legal"]);
/** Things that are distinct even when their names are alike (two models, two repositories): matched only by URL. */
const DISTINCT = new Set(["paper", "repo", "model", "launch"]);
const HOURS = 3_600_000;
/** Money and percentages in a headline, units normalized: "$27bn", "$27 billion" and "$27B" are all "$27b". */
export const figures = (t: string) => new Set((t.match(/\$\s?\d[\d,.]*\s?(?:trillion|tn|billion|bn|b|million|mn|m)?\b|\d[\d,.]*\s?%/gi) ?? [])
  .map((x) => x.toLowerCase().replace(/[\s,]/g, "").replace(/(trillion|tn)$/, "t").replace(/(billion|bn)$/, "b").replace(/(million|mn)$/, "m").replace(/\.0+(?=[a-z%]|$)/, ""))
  .filter((x) => x.length > 2));

/** "$8b" and "$8.2b" are one figure, rounded the way headlines round: same currency and unit, within 5%. Percentages must match exactly. */
export function nearFigure(a: string, b: string): boolean {
  if (a === b) return true;
  const pa = /^(\$?)(\d+(?:\.\d+)?)([tbm]?)$/.exec(a), pb = /^(\$?)(\d+(?:\.\d+)?)([tbm]?)$/.exec(b);
  if (!pa || !pb || pa[1] !== pb[1] || pa[3] !== pb[3]) return false;
  const x = Number(pa[2]), y = Number(pb[2]);
  return x > 0 && y > 0 && Math.abs(x - y) / Math.max(x, y) <= 0.05;
}

export const sharesFigure = (a: Iterable<string>, b: Iterable<string>) => { const bs = [...b]; return [...a].some((f) => f.length > 1 && bs.some((g) => nearFigure(f, g))); };

/**
 * The story an item belongs to, if any, with why. Pure, for tests. Calibrated on live headlines
 * (2026-09-28): unrelated pairs sit below 0.6 cosine 99.9% of the time; the same event told by
 * different outlets, or from both sides of a deal, scores 0.74 to 0.91.
 * - Articles: cosine >= 0.82; or >= 0.72 with a second signal (a shared ticker, a shared figure such
 *   as "$60 billion", rounded or not, or word overlap >= 0.2); or word overlap >= 0.5 with any of the story's
 *   headlines (>= 0.34 with a shared ticker). The story must have moved in the last 48 hours.
 * - Filings: only onto a story with the same ticker, a deal-like category, within 36 hours.
 * - Papers, repositories, models and launches never merge on similarity.
 */
export function bestCluster(item: ItemCand, clusters: ClusterCand[]): { id: number; score: number; reason: string } | null {
  if (DISTINCT.has(item.kind)) return null;
  const words = tokens(item.title), nums = figures(item.title);
  let best: { id: number; score: number; reason: string } | null = null;
  for (const c of clusters) {
    if (Math.abs(item.at - c.lastAt) > 48 * HOURS || c.kinds.every((k) => DISTINCT.has(k))) continue;
    const shared = item.tickers.some((t) => c.tickers.includes(t));
    let score = 0, reason = "";
    if (item.kind === "filing" || (c.kinds.length === 1 && c.kinds[0] === "filing")) {
      if (!shared || Math.abs(item.at - c.lastAt) > 36 * HOURS) continue;
      const compatible = (DEALISH.has(item.category) && DEALISH.has(c.category)) || item.category === c.category;
      if (!compatible) continue;
      score = 0.8; reason = "same company and event type";
    } else {
      const cos = item.vec && c.centroid ? cosine(item.vec, c.centroid) : 0;
      const jac = Math.max(jaccard(words, tokens(c.headline)), ...(c.titles ?? []).map((t) => jaccard(words, tokens(t))));
      const sameFigure = sharesFigure([...figures(c.headline), ...(c.titles ?? []).flatMap((t) => [...figures(t)])], nums);
      if (cos >= 0.82) { score = cos; reason = "same meaning"; }
      else if (cos >= 0.72 && (shared || sameFigure || jac >= 0.2)) { score = cos; reason = shared ? "same meaning and company" : sameFigure ? "same meaning and figure" : "same meaning and words"; }
      else if (jac >= 0.5) { score = 0.7 + jac * 0.2; reason = "same words"; }
      else if (jac >= 0.34 && shared) { score = 0.65 + jac * 0.2; reason = "same words and company"; }
    }
    if (score && (!best || score > best.score)) best = { id: c.id, score, reason };
  }
  return best;
}
