/**
 * Finding the passages that answer a question (the "retrieval" in RAG), done in the modern way:
 * the question is rephrased into a few sub-queries; each runs as a meaning search (embeddings, cosine)
 * and a word search (Postgres full text, matching any of the words, over the passage and a header naming
 * its company, form, period and section); the lists are fused by reciprocal rank; a cross-encoder
 * reranks about a hundred candidates when one is available; and a small model reads the best and keeps
 * the ones that bear on the question. The answer then reads those passages with their neighbours in the
 * same section. Only documents the person may read are ever searched.
 */
import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { requireDb } from "@/db";
import { structured } from "@/lib/ai/agent";
import { logError } from "@/lib/errors";
import { EDGE_SMALL_MODEL, small } from "../models";
import { crossRerank } from "../premium/rerank";
import { docLabel, passageHeader } from "./chunk";
import { embedTexts, vectorLiteral } from "./embed";
import { quoteFound } from "./text";

export type Hit = {
  chunkId: number; docId: number; ord: number; page: number; section: string; speaker: string; tStart: number | null; tEnd: number | null;
  text: string; title: string; url: string; source: string; lang: string; mime: string; fileId: number | null; ticker: string; score: number;
};

/** Reciprocal rank fusion of ranked lists of ids (k = 60). Pure, for tests. */
export function fuse(lists: number[][], k = 60): { id: number; score: number }[] {
  const score = new Map<number, number>();
  for (const list of lists) list.forEach((id, rank) => score.set(id, (score.get(id) ?? 0) + 1 / (k + rank + 1)));
  return [...score.entries()].map(([id, s]) => ({ id, score: s })).sort((a, b) => b.score - a.score);
}

const Plan = z.object({ queries: z.array(z.string()).min(1).max(4).describe("search phrasings, including the plain question; spell out tickers and acronyms"), keywords: z.string().describe("the most specific terms, space separated") });

/** Sub-queries for a question (falls back to the question alone). */
export async function planQueries(question: string): Promise<{ queries: string[]; keywords: string }> {
  try {
    const r = await structured(Plan, "edge-plan", "You turn a research question into 2 to 4 search phrasings over company filings, call transcripts and documents. Keep names and numbers exact.", question, { override: small(), maxTokens: 400, timeoutMs: 30_000 });
    return { queries: [...new Set([question, ...r.data.queries])].slice(0, 4), keywords: r.data.keywords };
  } catch (e) {
    logError(e, { where: "edge-plan" });
    return { queries: [question], keywords: question };
  }
}

/* ---------------- Keyword search ---------------- */

export type Terms = { words: string[]; phrases: string[]; not: string[] };

/**
 * A search string as terms, the way a search box reads it: "quoted phrases" stay phrases, a word with a
 * leading minus is excluded, OR and AND are dropped, and each term is kept once. Pure.
 */
export function parseTerms(input: string, maxWords = 24): Terms {
  const phrases: string[] = [];
  const rest = input.slice(0, 1000).replace(/["“”]([^"“”]{2,200})["“”]/g, (_, p: string) => { phrases.push(p.trim()); return " "; });
  const words: string[] = [], not: string[] = [];
  for (const raw of rest.split(/\s+/)) {
    const negated = /^-[\p{L}\p{N}]/u.test(raw);
    const w = raw.replace(/^[^\p{L}\p{N}$]+/u, "").replace(/[^\p{L}\p{N}%]+$/u, "");
    if (!w || /^(or|and)$/i.test(w)) continue;
    (negated ? not : words).push(w);
  }
  const once = (xs: string[]) => { const seen = new Set<string>(); return xs.filter((x) => !seen.has(x.toLowerCase()) && !!seen.add(x.toLowerCase())); };
  return { words: once(words).slice(0, maxWords), phrases: once(phrases).slice(0, 6), not: once(not).slice(0, 6) };
}

/** Each word (stemmed on its own) and each phrase (kept in order) as its own tsquery. */
const termQueries = (t: Terms): SQL[] => [...t.words.map((w) => sql`plainto_tsquery('english', ${w})`), ...t.phrases.map((p) => sql`phraseto_tsquery('english', ${p})`)];

/**
 * The terms as one tsquery that matches a passage holding ANY of them, less the excluded words; null when
 * nothing is left to search for. Matching every word, as websearch_to_tsquery does, finds nothing for
 * most real questions.
 */
export function anyTermsQuery(t: Terms): SQL | null {
  const parts = termQueries(t);
  if (!parts.length) return null;
  let q = sql`(${sql.join(parts, sql` || `)})`;
  for (const n of t.not) q = sql`(${q} && !!plainto_tsquery('english', ${n}))`;
  return q;
}

/**
 * How a word search ranks what it finds: first by how many of the terms a passage (with its header)
 * holds, then by cover density (ts_rank_cd). On its own, cover density over "any of the words" only
 * counts occurrences, so a passage repeating one common word would beat one holding all the rare ones.
 */
function wordRank(t: Terms, kv: SQL, q: SQL): SQL {
  const parts = termQueries(t);
  return sql`(${sql.join(parts.map((p) => sql`(${kv} @@ ${p})::int`), sql` + `)}) desc, ts_rank_cd(${kv}, ${q}) desc`;
}

const COLUMNS = sql`c.id, c.doc_id, c.ord, c.page, c.section, c.speaker, c.t_start, c.t_end, c.text, d.title, d.url, d.source, d.lang, d.mime, d.file_id, coalesce(d.meta->>'ticker', '') as ticker`;
type Row = { id: number; doc_id: number; ord: number; page: number; section: string; speaker: string; t_start: number | null; t_end: number | null; text: string; title: string; url: string; source: string; lang: string; mime: string; file_id: number | null; ticker: string };
const toHit = (r: Row, score: number): Hit => ({ chunkId: Number(r.id), docId: r.doc_id, ord: r.ord, page: r.page, section: r.section, speaker: r.speaker, tStart: r.t_start, tEnd: r.t_end, text: r.text, title: r.title, url: r.url, source: r.source, lang: r.lang, mime: r.mime, fileId: r.file_id, ticker: r.ticker, score });

/** Each document's header ("Company (TICKER) · form · period"), which the word search matches along with the passage. */
async function docHeaders(docIds: number[]): Promise<{ id: number; h: string }[]> {
  const ids = sql.join(docIds.map((i) => sql`${i}`), sql`, `);
  const rows = (await requireDb().execute(sql`select id, title, source, meta->>'ticker' as ticker, meta->>'form' as form, meta->>'period' as period, meta->>'filed' as filed, meta->>'company' as company from edge_docs where id in (${ids})`)).rows as { id: number; title: string; source: string; ticker: string | null; form: string | null; period: string | null; filed: string | null; company: string | null }[];
  return rows.map((r) => ({ id: r.id, h: docLabel({ title: r.title, source: r.source, meta: r }) }));
}

/**
 * Candidate passages from the given documents for some queries, fused: a meaning search per query and a
 * word search for the keywords and the first two queries. `onList` sees each list before fusion (for evals).
 */
export async function search(docIds: number[], queries: string[], keywords: string, limit = 50, opts: { onList?: (kind: "meaning" | "words", ids: number[]) => void } = {}): Promise<Hit[]> {
  if (!docIds.length) return [];
  const db = requireDb();
  const ids = sql.join(docIds.map((i) => sql`${i}`), sql`, `);
  const rows = new Map<number, Row>();
  const keep = (kind: "meaning" | "words", list: Row[]) => { for (const x of list) rows.set(Number(x.id), x); const out = list.map((x) => Number(x.id)); opts.onList?.(kind, out); return out; };
  const [vectors, headers] = await Promise.all([embedTexts(queries, "edge-query"), docHeaders(docIds)]);
  const heads = JSON.stringify(headers);
  const wordQueries = [...new Set([keywords, ...queries.slice(0, 2)])].map((q) => parseTerms(q)).map((t) => ({ t, q: anyTermsQuery(t) })).filter((x): x is { t: Terms; q: SQL } => !!x.q);
  const lists = await Promise.all([
    // Exact cosine over the documents in scope (the "+ 0" keeps the planner off the index, which would filter after ranking).
    ...vectors.map(async (v) => keep("meaning", (await db.execute(sql`select ${COLUMNS} from edge_chunks c join edge_docs d on d.id = c.doc_id where c.doc_id in (${ids}) and c.embedding is not null order by (c.embedding <=> ${vectorLiteral(v)}::halfvec(512)) + 0 limit ${limit}`)).rows as Row[])),
    // Any of the words, in the passage or its header (the document's company, form and period, and the passage's section and speaker).
    ...wordQueries.map(async ({ t, q }) => keep("words", (await db.execute(sql`with h as (select (x->>'id')::int as id, to_tsvector('english', x->>'h') as v from jsonb_array_elements(${heads}::jsonb) x)
      select ${COLUMNS} from edge_chunks c join edge_docs d on d.id = c.doc_id join h on h.id = c.doc_id,
        lateral (select h.v || to_tsvector('english', c.section || ' ' || c.speaker) || coalesce(c.tsv, ''::tsvector) as kv) k, (select ${q} as q) t
      where c.doc_id in (${ids}) and k.kv @@ t.q order by ${wordRank(t, sql`k.kv`, sql`t.q`)}, c.id limit ${limit}`)).rows as Row[])),
  ]);
  return fuse(lists).slice(0, limit * 2).map((f) => toHit(rows.get(f.id)!, f.score));
}

/* ---------------- Choosing the passages ---------------- */

const Ranked = z.object({ scores: z.array(z.object({ n: z.number().int(), score: z.number().describe("0 irrelevant to 10 directly answers") })) });

/** Keep the passages that bear on the question, best first (a small model reads each candidate). */
export async function rerank(question: string, hits: Hit[], keep = 12): Promise<Hit[]> {
  const pool = hits.slice(0, 30);
  if (pool.length <= keep) return pool;
  try {
    const list = pool.map((h, i) => `[${i + 1}] ${h.title}${h.section ? ` / ${h.section}` : ""}: ${h.text.slice(0, 1400)}`).join("\n\n");
    const r = await structured(Ranked, "edge-rerank", "Score how directly each numbered passage helps answer the question. Be strict: background that does not bear on the question scores low.", `Question: ${question}\n\nPassages:\n${list}`, { override: small(), maxTokens: 1200, timeoutMs: 45_000 });
    const score = new Map(r.data.scores.map((s) => [s.n, s.score]));
    return pool.map((h, i) => ({ h, s: score.get(i + 1) ?? 0 })).filter((x) => x.s >= 3).sort((a, b) => b.s - a.s).slice(0, keep).map((x) => x.h);
  } catch (e) {
    logError(e, { where: "edge-rerank" });
    return pool.slice(0, keep);
  }
}

/**
 * The candidates the small model reads after a cross-encoder: the reranker's best, then the search's own
 * best that the reranker left out, so neither alone decides what is never looked at. Pure.
 */
export function mergeForSelection(reranked: number[], searched: number[], n = 30, fromSearch = 8): number[] {
  const out: number[] = [];
  const add = (id: number) => { if (out.length < n && !out.includes(id)) out.push(id); };
  reranked.slice(0, n - fromSearch).forEach(add);
  searched.slice(0, fromSearch).forEach(add);
  reranked.forEach(add);
  searched.forEach(add);
  return out;
}

export type Retrieval = { hits: Hit[]; fused: Hit[]; reranker: string | null; selector: string; method: string };

/**
 * The passages for a question: the fused search, a cross-encoder over about a hundred candidates when
 * one is available (see premium/rerank.ts), then the small model's selection of at most `keep`.
 */
export async function retrieve(question: string, docIds: number[], plan: { queries: string[]; keywords: string }, opts: { keep?: number; cross?: boolean } = {}): Promise<Retrieval> {
  const fused = await search(docIds, plan.queries, plan.keywords, 50);
  let pool = fused, reranker: string | null = null;
  if (opts.cross !== false && fused.length > (opts.keep ?? 12)) {
    const candidates = fused.slice(0, 100);
    const r = await crossRerank(question, candidates.map((h) => ({ id: h.chunkId, text: `${passageHeader({ title: h.title, source: h.source, meta: { ticker: h.ticker } }, h)}\n${h.text}` })));
    if (r) {
      const byId = new Map(candidates.map((h) => [h.chunkId, h]));
      pool = mergeForSelection(r.order, candidates.map((h) => h.chunkId)).map((id) => byId.get(id)!);
      reranker = r.label;
    }
  }
  const hits = await rerank(question, pool, opts.keep ?? 12);
  const selector = EDGE_SMALL_MODEL();
  const method = `Meaning and keyword search over ${docIds.length} document${docIds.length === 1 ? "" : "s"}${reranker ? `, reranked by ${reranker}` : ""}, passages chosen by ${selector}`;
  return { hits, fused, reranker, selector, method };
}

/* ---------------- Reading around the chosen passages ---------------- */

/**
 * About 8,000 tokens of passages for the answer model (it used to read about 3,000). Wider context finds
 * more of the answer but each answer costs more with a large answer model; EDGE_CONTEXT_CHARS raises it
 * (52,000 characters, about 13,000 tokens, was tested and verified every quote).
 */
export const CONTEXT_CHARS = Math.max(8_000, Number(process.env.EDGE_CONTEXT_CHARS) || 32_000);
/** How far through its section a chosen passage may be widened, each way (the budget usually stops it first). */
export const REACH = 16;

export type Block = { n: number; docId: number; title: string; section: string; chunks: Hit[]; text: string; rank: number };

/** Two consecutive passages as one text, without the words the second repeats from the end of the first. Pure. */
export function joinOverlap(a: string, b: string): string {
  const max = Math.min(a.length, b.length, 600);
  for (let k = max; k >= 12; k--) if (a.endsWith(b.slice(0, k))) return `${a}${b.slice(k)}`;
  return `${a}\n${b}`;
}

/**
 * The chosen passages widened with their neighbours in the same document and section, nearest first and
 * the best-ranked passages first, until `budget` characters; consecutive passages become one block.
 * Blocks come best first. Pure.
 */
export function expand(hits: Hit[], around: Hit[], budget = CONTEXT_CHARS, reach = REACH): Block[] {
  const key = (d: number, o: number) => `${d}:${o}`;
  const all = new Map<string, Hit>();
  for (const h of [...around, ...hits]) all.set(key(h.docId, h.ord), h);
  const chosen = new Map<string, number>();
  let used = 0;
  hits.forEach((h, rank) => { const k = key(h.docId, h.ord); if (!chosen.has(k)) { chosen.set(k, rank); used += h.text.length; } });
  for (let r = 1; r <= reach; r++) {
    for (const [rank, h] of hits.entries()) {
      for (const side of [-1, 1]) {
        const k = key(h.docId, h.ord + side * r), inner = key(h.docId, h.ord + side * (r - 1));
        const n = all.get(k);
        if (!n || chosen.has(k) || !chosen.has(inner) || n.section !== h.section || (h.page && n.page && Math.abs(n.page - h.page) > 1)) continue;
        if (used + n.text.length > budget) continue;
        chosen.set(k, rank);
        used += n.text.length;
      }
    }
  }
  const picked = [...chosen.entries()].map(([k, rank]) => ({ h: all.get(k)!, rank })).sort((a, b) => a.h.docId - b.h.docId || a.h.ord - b.h.ord);
  const blocks: Omit<Block, "n">[] = [];
  for (const { h, rank } of picked) {
    const last = blocks[blocks.length - 1];
    const prev = last?.chunks[last.chunks.length - 1];
    if (last && prev && prev.docId === h.docId && prev.ord + 1 === h.ord && prev.section === h.section) {
      last.chunks.push(h); last.text = joinOverlap(last.text, h.text); last.rank = Math.min(last.rank, rank);
    } else blocks.push({ docId: h.docId, title: h.title, section: h.section, chunks: [h], text: h.text, rank });
  }
  return blocks.sort((a, b) => a.rank - b.rank).map((b, i) => ({ ...b, n: i + 1 }));
}

/** The chosen passages' neighbours in their sections (within `reach` places), to widen what the answer reads. */
export async function neighbours(hits: Hit[], reach = REACH): Promise<Hit[]> {
  if (!hits.length) return [];
  const want = sql.join(hits.map((h) => sql`(c.doc_id = ${h.docId} and c.section = ${h.section} and c.ord between ${h.ord - reach} and ${h.ord + reach})`), sql` or `);
  const rows = (await requireDb().execute(sql`select ${COLUMNS} from edge_chunks c join edge_docs d on d.id = c.doc_id where ${want} limit 800`)).rows as Row[];
  return rows.map((r) => toHit(r, 0));
}

/**
 * Which of a block's passages a quote that was found in the block comes from: the first whose text
 * holds it, else the first of two neighbours it runs across; -1 when neither. Pure.
 */
export function quoteChunk(quote: string, chunks: { text: string }[]): number {
  const one = chunks.findIndex((c) => quoteFound(quote, c.text));
  if (one >= 0) return one;
  for (let i = 0; i + 1 < chunks.length; i++) if (quoteFound(quote, joinOverlap(chunks[i].text, chunks[i + 1].text))) return i;
  return -1;
}
