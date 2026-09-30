/**
 * Finding the passages that answer a question (the "retrieval" in RAG), done in the modern way:
 * the question is rephrased into a few sub-queries; each runs as a meaning search (embeddings, cosine)
 * and a word search (Postgres full text) over the documents in scope; the lists are fused by
 * reciprocal rank; and a small model reads the best candidates and keeps the ones that bear on the
 * question. Only documents the person may read are ever searched.
 */
import { sql } from "drizzle-orm";
import { z } from "zod";
import { requireDb } from "@/db";
import { structured } from "@/lib/ai/agent";
import { logError } from "@/lib/errors";
import { embedTexts, vectorLiteral } from "./embed";

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
    const r = await structured(Plan, "edge-plan", "You turn a research question into 2 to 4 search phrasings over company filings, call transcripts and documents. Keep names and numbers exact.", question, { override: { model: "gpt-5.6-luna", effort: "low" }, maxTokens: 400, timeoutMs: 30_000 });
    return { queries: [...new Set([question, ...r.data.queries])].slice(0, 4), keywords: r.data.keywords };
  } catch (e) {
    logError(e, { where: "edge-plan" });
    return { queries: [question], keywords: question };
  }
}

const COLUMNS = sql`c.id, c.doc_id, c.ord, c.page, c.section, c.speaker, c.t_start, c.t_end, c.text, d.title, d.url, d.source, d.lang, d.mime, d.file_id, coalesce(d.meta->>'ticker', '') as ticker`;
type Row = { id: number; doc_id: number; ord: number; page: number; section: string; speaker: string; t_start: number | null; t_end: number | null; text: string; title: string; url: string; source: string; lang: string; mime: string; file_id: number | null; ticker: string };
const toHit = (r: Row, score: number): Hit => ({ chunkId: Number(r.id), docId: r.doc_id, ord: r.ord, page: r.page, section: r.section, speaker: r.speaker, tStart: r.t_start, tEnd: r.t_end, text: r.text, title: r.title, url: r.url, source: r.source, lang: r.lang, mime: r.mime, fileId: r.file_id, ticker: r.ticker, score });

/** Candidate passages from the given documents for some queries, fused. */
export async function search(docIds: number[], queries: string[], keywords: string, limit = 40): Promise<Hit[]> {
  if (!docIds.length) return [];
  const db = requireDb();
  const ids = sql.join(docIds.map((i) => sql`${i}`), sql`, `);
  const vectors = await embedTexts(queries, "edge-query");
  const lists: number[][] = [];
  const rows = new Map<number, Row>();
  // Exact cosine over the documents in scope (the "+ 0" keeps the planner off the index, which would filter after ranking).
  await Promise.all(vectors.map(async (v) => {
    const r = await db.execute(sql`select ${COLUMNS} from edge_chunks c join edge_docs d on d.id = c.doc_id where c.doc_id in (${ids}) and c.embedding is not null order by (c.embedding <=> ${vectorLiteral(v)}::halfvec(512)) + 0 limit ${limit}`);
    const list = r.rows as Row[];
    for (const x of list) rows.set(Number(x.id), x);
    lists.push(list.map((x) => Number(x.id)));
  }));
  for (const q of [...new Set([keywords, ...queries.slice(0, 2)])].filter((q) => q.trim())) {
    const r = await db.execute(sql`select ${COLUMNS} from edge_chunks c join edge_docs d on d.id = c.doc_id, websearch_to_tsquery('english', ${q.slice(0, 300)}) q where c.doc_id in (${ids}) and c.tsv @@ q order by ts_rank_cd(c.tsv, q) desc limit ${limit}`);
    const list = r.rows as Row[];
    for (const x of list) rows.set(Number(x.id), x);
    lists.push(list.map((x) => Number(x.id)));
  }
  return fuse(lists).slice(0, limit * 2).map((f) => toHit(rows.get(f.id)!, f.score));
}

const Ranked = z.object({ scores: z.array(z.object({ n: z.number().int(), score: z.number().describe("0 irrelevant to 10 directly answers") })) });

/** Keep the passages that bear on the question, best first (a small model reads each candidate). */
export async function rerank(question: string, hits: Hit[], keep = 12): Promise<Hit[]> {
  const pool = hits.slice(0, 30);
  if (pool.length <= keep) return pool;
  try {
    const list = pool.map((h, i) => `[${i + 1}] ${h.title}${h.section ? ` / ${h.section}` : ""}: ${h.text.slice(0, 700)}`).join("\n\n");
    const r = await structured(Ranked, "edge-rerank", "Score how directly each numbered passage helps answer the question. Be strict: background that does not bear on the question scores low.", `Question: ${question}\n\nPassages:\n${list}`, { override: { model: "gpt-5.6-luna", effort: "low" }, maxTokens: 1200, timeoutMs: 45_000 });
    const score = new Map(r.data.scores.map((s) => [s.n, s.score]));
    return pool.map((h, i) => ({ h, s: score.get(i + 1) ?? 0 })).filter((x) => x.s >= 3).sort((a, b) => b.s - a.s).slice(0, keep).map((x) => x.h);
  } catch (e) {
    logError(e, { where: "edge-rerank" });
    return pool.slice(0, keep);
  }
}
