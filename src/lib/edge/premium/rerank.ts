/**
 * Cross-encoder reranking for Documents: a model that reads the question and each candidate passage
 * together and scores how well the passage answers it, run over about a hundred fused search candidates
 * before the small model makes its selection. Voyage rerank-3 when VOYAGE_API_KEY is set, else Cohere
 * Rerank 4 with COHERE_API_KEY (both paid; see premium.ts), else the free reranker on Edge's ML service.
 * Each has a few seconds: on any failure or timeout the search order stands, nothing is shown to the
 * person, and the answer's method says no reranker was used.
 */
import { guardAi } from "@/lib/ai/limits";
import { aiUser, recordUsage } from "@/lib/ai/usage";
import { logError } from "@/lib/errors";
import { mlReady, mlRun, type MlTask } from "../infra/ml";
import { addUsage } from "../infra/usage";
import { upgradeOn } from "../premium";

export type RerankDoc = { id: number; text: string };
export type RerankProvider = "voyage" | "cohere" | "ml";
export type Reranked = { order: number[]; provider: RerankProvider; model: string; label: string };

/** The ML service's reranking task (ettin-reranker-32m on CPU). Until it is deployed the call fails fast. */
const ML_TASK: MlTask = "docs.rerank";

export const VOYAGE_URL = "https://api.voyageai.com/v1/rerank";
export const COHERE_URL = "https://api.cohere.com/v2/rerank";
const voyageModel = () => process.env.VOYAGE_RERANK_MODEL?.trim() || "rerank-3";
const cohereModel = () => process.env.COHERE_RERANK_MODEL?.trim() || "rerank-v4.0-pro";
/** List prices: Voyage per token, Cohere per search of up to 100 passages. */
const VOYAGE_USD_PER_TOKEN: Record<string, number> = { "rerank-3": 0.05e-6, "rerank-3-lite": 0.02e-6 };
const COHERE_USD_PER_SEARCH: Record<string, number> = { "rerank-v4.0-pro": 0.0025, "rerank-v4.0-fast": 0.002 };

/** About 500 tokens a passage, so a hundred stay inside one Cohere search and the time limit. */
const DOC_CHARS = 2000;
/**
 * The free reranker runs on CPU: about 4.5 s for 100 passages of ~400 tokens warm, so it gets the best 40
 * candidates cut to about 1,000 characters (1 to 2 s warm) and 8 seconds.
 */
export const ML_PASSAGES = 40, ML_CHARS = 1000, ML_TIMEOUT_MS = 8_000;

/** Which reranker answers: a paid key first (Voyage, then Cohere), else the free one on the ML service, else none. */
export function rerankProvider(): RerankProvider | null {
  if (upgradeOn("rerank-voyage")) return "voyage";
  if (upgradeOn("rerank-cohere")) return "cohere";
  return mlReady() ? "ml" : null;
}

const json = (key: string, body: unknown): RequestInit => ({ method: "POST", headers: { "content-type": "application/json", accept: "application/json", authorization: `Bearer ${key}` }, body: JSON.stringify(body) });

/** The request Voyage's rerank endpoint takes. Pure. */
export function voyageRequest(query: string, docs: RerankDoc[], key: string, model = voyageModel()): { url: string; init: RequestInit } {
  return { url: VOYAGE_URL, init: json(key, { query: query.slice(0, 4000), documents: docs.map((d) => d.text.slice(0, DOC_CHARS)), model, top_k: docs.length, truncation: true }) };
}

/** The request Cohere's v2 rerank endpoint takes. Pure. */
export function cohereRequest(query: string, docs: RerankDoc[], key: string, model = cohereModel()): { url: string; init: RequestInit } {
  return { url: COHERE_URL, init: json(key, { model, query: query.slice(0, 4000), documents: docs.map((d) => d.text.slice(0, DOC_CHARS)), top_n: docs.length, max_tokens_per_doc: 512 }) };
}

/** What the ML service's task takes: the best 40 candidates, each cut to about 1,000 characters. Pure. */
export const mlInput = (query: string, docs: RerankDoc[]) => ({ query: query.slice(0, 2000), passages: docs.slice(0, ML_PASSAGES).map((d) => ({ id: d.id, text: d.text.slice(0, ML_CHARS) })) });

const isIndex = (x: unknown): x is number => typeof x === "number" && Number.isInteger(x) && x >= 0;
const isScore = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

/** Voyage's answer ({ data: [{ index, relevance_score }], usage: { total_tokens } }) as scores and tokens. Pure; throws on a malformed answer. */
export function parseVoyage(j: unknown): { scores: { index: number; score: number }[]; tokens: number } {
  const o = j as { data?: { index?: unknown; relevance_score?: unknown }[]; usage?: { total_tokens?: unknown } } | null;
  if (!o || !Array.isArray(o.data)) throw new Error("Voyage's rerank answer has no data");
  return { scores: o.data.filter((d) => isIndex(d.index) && isScore(d.relevance_score)).map((d) => ({ index: d.index as number, score: d.relevance_score as number })), tokens: isScore(o.usage?.total_tokens) ? o.usage.total_tokens : 0 };
}

/** Cohere's answer ({ results: [{ index, relevance_score }], meta: { billed_units: { search_units } } }). Pure; throws on a malformed answer. */
export function parseCohere(j: unknown): { scores: { index: number; score: number }[]; searches: number } {
  const o = j as { results?: { index?: unknown; relevance_score?: unknown }[]; meta?: { billed_units?: { search_units?: unknown } } } | null;
  if (!o || !Array.isArray(o.results)) throw new Error("Cohere's rerank answer has no results");
  const units = o.meta?.billed_units?.search_units;
  return { scores: o.results.filter((d) => isIndex(d.index) && isScore(d.relevance_score)).map((d) => ({ index: d.index as number, score: d.relevance_score as number })), searches: isScore(units) ? units : 1 };
}

/**
 * The ML service's answer ({ scores: [{ id, score }], model, maxLength, truncated }; other fields are
 * ignored). Its scores only order this question's passages. Pure; throws on a malformed answer.
 */
export function parseMl(j: unknown): { scores: { id: number; score: number }[]; model: string } {
  const o = j as { scores?: { id?: unknown; score?: unknown }[]; model?: unknown } | null;
  if (!o || !Array.isArray(o.scores)) throw new Error("The ML service's rerank answer has no scores");
  return { scores: o.scores.filter((s) => typeof s?.id === "number" && isScore(s.score)).map((s) => ({ id: s.id as number, score: s.score as number })), model: typeof o.model === "string" && o.model.trim() ? o.model.trim() : "cross-encoder/ettin-reranker-32m-v1" };
}

/** "ettin-reranker-32m-v1" for "cross-encoder/ettin-reranker-32m-v1": the model's name without its publisher. Pure. */
export const shortModel = (model: string) => model.split("/").pop() || model;

/**
 * The passages' ids best first by score; any a reranker did not score keep their search order after the
 * scored ones. Returns null when nothing was scored (a useless answer is a failure, not a ranking). Pure.
 */
export function orderByScores(docs: RerankDoc[], scored: { id: number; score: number }[]): number[] | null {
  const known = new Set(docs.map((d) => d.id));
  const best = new Map<number, number>();
  for (const s of scored) if (known.has(s.id) && s.score > (best.get(s.id) ?? -Infinity)) best.set(s.id, s.score);
  if (!best.size) return null;
  const pos = new Map(docs.map((d, i) => [d.id, i]));
  return [...docs].sort((a, b) => {
    const sa = best.get(a.id), sb = best.get(b.id);
    if (sa !== undefined && sb !== undefined) return sb - sa || pos.get(a.id)! - pos.get(b.id)!;
    return sa !== undefined ? -1 : sb !== undefined ? 1 : pos.get(a.id)! - pos.get(b.id)!;
  }).map((d) => d.id);
}

/** The free reranker's failures are expected until its task is deployed: logged once in a while, not on every question. */
let mlLoggedAt = 0;

/** Rerank candidate passages for a question, or null (no reranker, or it failed or ran out of time). */
export async function crossRerank(query: string, docs: RerankDoc[], opts: { timeoutMs?: number } = {}): Promise<Reranked | null> {
  const provider = rerankProvider();
  if (!provider || docs.length < 2) return null;
  const timeoutMs = opts.timeoutMs ?? (provider === "ml" ? ML_TIMEOUT_MS : 3_500);
  try {
    if (provider === "ml") {
      const sent = docs.slice(0, ML_PASSAGES);
      const r = parseMl(await mlRun(ML_TASK, mlInput(query, sent), timeoutMs).catch((e: unknown) => {
        // A call we gave up on still ran on Modal: count it (mlRun counts the ones that answer).
        addUsage("modal", "calls", 1);
        throw e;
      }));
      const order = orderByScores(sent, r.scores);
      return order && { order, provider, model: r.model, label: `${shortModel(r.model)} on Edge's ML service` };
    }
    await guardAi(aiUser());
    const key = (provider === "voyage" ? process.env.VOYAGE_API_KEY : process.env.COHERE_API_KEY)?.trim() ?? "";
    const model = provider === "voyage" ? voyageModel() : cohereModel();
    const { url, init } = provider === "voyage" ? voyageRequest(query, docs, key, model) : cohereRequest(query, docs, key, model);
    const res = await fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`${provider} rerank answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const body: unknown = await res.json();
    let pairs: { index: number; score: number }[];
    if (provider === "voyage") {
      const v = parseVoyage(body);
      pairs = v.scores;
      recordUsage({ feature: "edge-rerank", provider, model, usage: { input: v.tokens, cached: 0, cacheWrite: 0, output: 0, reasoning: 0 }, extraCostUsd: v.tokens * (VOYAGE_USD_PER_TOKEN[model] ?? VOYAGE_USD_PER_TOKEN["rerank-3"]) });
    } else {
      const c = parseCohere(body);
      pairs = c.scores;
      recordUsage({ feature: "edge-rerank", provider, model, usage: { input: 0, cached: 0, cacheWrite: 0, output: 0, reasoning: 0 }, extraCostUsd: c.searches * (COHERE_USD_PER_SEARCH[model] ?? COHERE_USD_PER_SEARCH["rerank-v4.0-pro"]) });
    }
    const order = orderByScores(docs, pairs.filter((p) => p.index < docs.length).map((p) => ({ id: docs[p.index].id, score: p.score })));
    return order && { order, provider, model, label: provider === "voyage" ? `Voyage ${model}` : `Cohere ${model}` };
  } catch (e) {
    if (provider !== "ml" || Date.now() - mlLoggedAt > 10 * 60_000) {
      if (provider === "ml") mlLoggedAt = Date.now();
      logError(e, { where: `edge-rerank-${provider}` });
    }
    return null;
  }
}

let warmedAt = 0;

/**
 * Wake the free reranker when it is the one in use, so the question that follows finds it warm (it
 * scales to zero, and a cold start takes 10 to 30 seconds). At most once every few minutes per server.
 */
export async function warmReranker(): Promise<boolean> {
  if (rerankProvider() !== "ml" || Date.now() - warmedAt < 3 * 60_000) return false;
  warmedAt = Date.now();
  await mlRun(ML_TASK, mlInput("warm up", [{ id: 0, text: "Warming the reranker." }]), 60_000).catch(() => { addUsage("modal", "calls", 1); });
  return true;
}
