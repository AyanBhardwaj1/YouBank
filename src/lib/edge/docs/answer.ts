/**
 * Cited answers from documents. Sources are gathered for the scope (filings indexed on demand, the
 * Newsroom archive, the person's workspace and uploads, the live web), passages retrieved, reranked and
 * chosen, and the answer written only from them, read with their neighbours in the same section. Every
 * claim quotes the passage it rests on, and a checker confirms each quote really appears there; claims
 * whose quotes fail get one more look, by a small model re-reading the sections they came from. Strict
 * mode (the default for memos) drops what still fails and says "not found" when nothing survives;
 * balanced mode keeps inference, marked as analysis. Passages that disagree are flagged, and quotes from
 * documents in other languages come with a translation.
 */
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { requireDb, schema } from "@/db";
import { structured } from "@/lib/ai/agent";
import { webResearch } from "@/lib/ai/research";
import { logError } from "@/lib/errors";
import type { Answer, Citation } from "../canvas/values";
import { EDGE_SMALL_MODEL, small } from "../models";
import { citedAnswer, claimsOf } from "../premium/citations";
import { verifyClaims } from "../claims/verify";
import type { CitedPassage } from "../claims/features";
import type { ClaimSupport, VerifierInfo } from "../claims/types";
import { paidOn } from "../premium";
import { clock } from "./chunk";
import { quoteFound } from "./text";
import { CONTEXT_CHARS, expand, neighbours, planQueries, quoteChunk, retrieve, type Block, type Hit } from "./retrieve";
import { indexFilings, indexNewsroom, workspaceDocs } from "./sources";
import { readableDocs } from "./store";

export type Scope = { tickers?: string[]; sources?: string[]; forms?: string[]; months?: number; docIds?: number[] };
/** `premium` asks for paid upgrades on this question (the route checks the plan and opens the premium scope). */
export type AskInput = { question: string; mode?: "strict" | "balanced"; form?: "auto" | "direct" | "table" | "timeline" | "memo"; scope: Scope; premium?: AskPremium };
export type AskPremium = { model?: boolean; citations?: boolean; crosscheck?: boolean };

/** The premium features a question asks for, and the ones that apply on their own when the plan has them. Pure. */
export function askWants(p: AskPremium | undefined): { auto: string[]; require: string[] } {
  return { auto: ["edge.rerank"], require: [...(p?.model ? ["edge.answer-model"] : []), ...(p?.citations ? ["edge.citations"] : []), ...(p?.crosscheck ? ["edge.claims-crosscheck"] : [])] };
}
/** How an answer was made: the search, any reranker, the models, how much it read, and the second look. */
export type AnswerMethod = { search: string; reranker: string | null; selector: string; answerModel: string; contextTokens: number; secondPass: { claims: number; found: number; model: string } | null; transcription?: string[] };
export type FullAnswer = Answer & {
  form: string; table?: { columns: string[]; rows: string[][] }; timeline?: { date: string; event: string; cites: number[] }[]; contradictions: { a: number; b: number; note: string }[];
  web: { title: string; url: string }[]; checked?: { quotes: number; verified: number; dropped: number; recovered?: number }; scopeDocs?: number;
  /** One line on how the answer was made, for the reader and the audit trail. */
  method?: string; provenance?: AnswerMethod;
  /** Calibrated Claims: claims Strict held back below its line (shown on request), and the verifier's account of itself. */
  held?: (Answer["claims"][number] & { support?: ClaimSupport })[]; verifier?: VerifierInfo;
};

const Written = z.object({
  notFound: z.boolean().describe("true when the passages do not answer the question"),
  form: z.enum(["direct", "table", "timeline", "memo"]).describe("the shape that fits the question best (or the one asked for)"),
  direct: z.string().describe("the answer in one to three sentences, first"),
  claims: z.array(z.object({
    text: z.string().describe("one statement"),
    cites: z.array(z.object({ n: z.number().int(), quote: z.string().describe("the exact words from passage n that support the statement, copied verbatim, under 40 words") })),
    analysis: z.boolean().describe("true when this is inference beyond what the passages say"),
  })).max(14),
  table: z.object({ columns: z.array(z.string()), rows: z.array(z.array(z.string())) }).nullable().optional(),
  timeline: z.array(z.object({ date: z.string(), event: z.string(), cites: z.array(z.number().int()) })).nullable().optional(),
  contradictions: z.array(z.object({ a: z.number().int(), b: z.number().int(), note: z.string() })).max(6),
});

export { quoteFound };

/**
 * The model that writes answers: EDGE_ANSWER_MODEL when that upgrade is set up and the person asked for
 * it on this question with a plan that includes it (see premium.ts), else the default.
 */
export const answerModel = (): string | undefined => (paidOn("answer-model") ? process.env.EDGE_ANSWER_MODEL?.trim() || undefined : undefined);

/** The passages a question can use, gathering (indexing) sources in scope first. */
async function gather(userId: string, s: Scope, deadline: number, progress?: (m: string) => Promise<void>): Promise<{ docIds: number[]; web: boolean }> {
  const sources = s.sources?.length ? s.sources : ["sec", "uploads", "audio"];
  const tickers = (s.tickers ?? []).slice(0, 6);
  const ids = new Set<number>(s.docIds ?? []);
  if (sources.includes("sec")) for (const t of tickers) {
    if (Date.now() > deadline - 90_000) break;
    await progress?.(`Reading ${t}'s filings`);
    try { (await indexFilings(t, s.forms ?? [], s.months ?? 12, deadline - 90_000)).docIds.forEach((i) => ids.add(i)); } catch (e) { logError(e, { where: "edge-gather-sec" }); }
  }
  if (sources.includes("newsroom") && tickers.length) (await indexNewsroom(tickers, (s.months ?? 12) * 30, deadline - 60_000)).forEach((i) => ids.add(i));
  if (sources.includes("workspace")) { await progress?.("Reading your workspace"); (await workspaceDocs(userId, deadline - 60_000)).forEach((i) => ids.add(i)); }
  const mine = [...(sources.includes("uploads") ? ["upload"] : []), ...(sources.includes("audio") ? ["audio"] : [])];
  if (mine.length && !s.docIds?.length) (await readableDocs(userId, { sources: mine, limit: 300 })).filter((d) => d.status === "ready").forEach((d) => ids.add(d.id));
  // Only documents this person may read, and only ones that are ready.
  const readable = new Set((await readableDocs(userId, { ids: [...ids], limit: 2000 })).filter((d) => d.status === "ready").map((d) => d.id));
  return { docIds: [...ids].filter((i) => readable.has(i)), web: sources.includes("web") };
}

const Translated = z.object({ items: z.array(z.object({ n: z.number().int(), english: z.string() })) });

async function translate(quotes: { n: number; text: string; lang: string }[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  if (!quotes.length) return out;
  try {
    const r = await structured(Translated, "edge-translate", "Translate each numbered quote into plain English, faithfully.", quotes.map((q) => `[${q.n}] (${q.lang}) ${q.text}`).join("\n"), { override: small(), maxTokens: 1500, timeoutMs: 45_000 });
    for (const t of r.data.items) out.set(t.n, t.english);
  } catch (e) { logError(e, { where: "edge-translate" }); }
  return out;
}

type WebPassage = { web: true; text: string; title: string; url: string };

/** A block's place in its document, for the numbered list the model reads: pages, or the time and speaker. Pure. */
export function blockLabel(b: Pick<Block, "title" | "section" | "chunks">): string {
  const first = b.chunks[0], last = b.chunks[b.chunks.length - 1];
  const pages = first.page ? (last.page && last.page !== first.page ? `, pages ${first.page}-${last.page}` : `, page ${first.page}`) : "";
  const at = first.tStart !== null ? ` at ${clock(first.tStart)}${first.speaker ? `, ${first.speaker}` : ""}` : "";
  return `${b.title}${b.section ? ` / ${b.section}` : ""}${pages}${at}`;
}

/* ---------------- The second look ---------------- */

/** About 25,000 tokens of the scoped filing or the top sections for the small model's second reading. */
const REREAD_CHARS = 100_000;

/**
 * What the second reading covers: the whole document when the question is about one that fits, else the
 * sections the chosen passages came from, widening around them (best first) until the budget.
 */
async function rereadSource(hits: Hit[], docIds: number[]): Promise<Hit[]> {
  const db = requireDb();
  const cols = sql`c.id, c.doc_id, c.ord, c.page, c.section, c.speaker, c.t_start, c.t_end, c.text, d.title, d.url, d.source, d.lang, d.mime, d.file_id, coalesce(d.meta->>'ticker', '') as ticker`;
  type R = { id: number; doc_id: number; ord: number; page: number; section: string; speaker: string; t_start: number | null; t_end: number | null; text: string; title: string; url: string; source: string; lang: string; mime: string; file_id: number | null; ticker: string };
  const toHit = (r: R): Hit => ({ chunkId: Number(r.id), docId: r.doc_id, ord: r.ord, page: r.page, section: r.section, speaker: r.speaker, tStart: r.t_start, tEnd: r.t_end, text: r.text, title: r.title, url: r.url, source: r.source, lang: r.lang, mime: r.mime, fileId: r.file_id, ticker: r.ticker, score: 0 });
  const docs = [...new Set(hits.map((h) => h.docId))];
  const only = docIds.length === 1 ? docIds[0] : docs.length === 1 ? docs[0] : null;
  if (only !== null) {
    const [size] = (await db.execute(sql`select coalesce(sum(length(text)), 0)::int as n from edge_chunks where doc_id = ${only}`)).rows as { n: number }[];
    if (Number(size?.n ?? 0) <= REREAD_CHARS) return ((await db.execute(sql`select ${cols} from edge_chunks c join edge_docs d on d.id = c.doc_id where c.doc_id = ${only} order by c.ord`)).rows as R[]).map(toHit);
  }
  // Windows around the chosen passages within their sections, the best-ranked first.
  const windows = hits.slice(0, 8).map((h) => sql`(c.doc_id = ${h.docId} and c.section = ${h.section} and c.ord between ${h.ord - 12} and ${h.ord + 12})`);
  const rows = ((await db.execute(sql`select ${cols} from edge_chunks c join edge_docs d on d.id = c.doc_id where ${sql.join(windows, sql` or `)} limit 600`)).rows as R[]).map(toHit);
  const rank = (r: Hit) => { let best = Infinity; hits.slice(0, 8).forEach((h, i) => { if (h.docId === r.docId && h.section === r.section) best = Math.min(best, i * 100 + Math.abs(h.ord - r.ord)); }); return best; };
  const out: Hit[] = [];
  let used = 0;
  for (const r of rows.sort((a, b) => rank(a) - rank(b))) { if (used + r.text.length > REREAD_CHARS) continue; out.push(r); used += r.text.length; }
  return out.sort((a, b) => a.docId - b.docId || a.ord - b.ord);
}

const Found = z.object({ quotes: z.array(z.object({ claim: z.number().int(), n: z.number().int(), quote: z.string().describe("the exact words from passage n, copied verbatim, under 40 words") })).max(40) });

/** The small model's second reading: verbatim quotes for claims whose first quotes were not found. */
export async function findQuotes(claims: string[], source: Hit[], timeoutMs = 60_000): Promise<{ claim: number; n: number; quote: string }[]> {
  const passages = source.map((h, i) => `[${i + 1}] ${h.title}${h.section ? ` / ${h.section}` : ""}${h.page ? `, page ${h.page}` : ""}${h.tStart !== null ? ` at ${clock(h.tStart)}` : ""}\n${h.text}`).join("\n\n");
  const r = await structured(Found, "edge-requote",
    "For each numbered claim, find the passage that supports it and copy the exact words from that passage, word for word, under 40 words. Give up to two quotes per claim. Leave out any claim the passages do not support; never paraphrase, never combine words from different places.",
    `Claims:\n${claims.map((c, i) => `(${i + 1}) ${c}`).join("\n")}\n\nPassages:\n${passages}`, { override: small(), maxTokens: 2000, timeoutMs });
  return r.data.quotes;
}

/**
 * The second reading's quotes that check out, each credited to the passage that holds it: the one named,
 * or the next one of the same document when the words are there (or run on into it). Only claims that
 * were asked about count. Pure.
 */
export function checkFound<H extends { docId: number; ord: number; text: string }>(found: { claim: number; n: number; quote: string }[], source: H[], claims: number): { claim: number; at: H; quote: string }[] {
  const out: { claim: number; at: H; quote: string }[] = [];
  for (const q of found) {
    const h = source[q.n - 1], next = source[q.n];
    if (q.claim < 1 || q.claim > claims || !h) continue;
    const pair = next && next.docId === h.docId && next.ord === h.ord + 1 ? [h, next] : [h];
    const i = quoteChunk(q.quote, pair);
    if (i >= 0) out.push({ claim: q.claim, at: pair[i], quote: q.quote });
  }
  return out;
}

/**
 * How long the second reading may take: what is left before the deadline less 20 seconds for the rest of
 * the answer, halved because the SDK tries a timed-out call once more; null (skip it) under 15 seconds. Pure.
 */
export function rereadBudget(deadline: number, now = Date.now()): number | null {
  const ms = Math.floor((deadline - now - 20_000) / 2);
  return ms >= 15_000 ? ms : null;
}

/* ---------------- Asking ---------------- */

export async function askDocuments(userId: string, input: AskInput, opts: { deadline?: number; progress?: (m: string) => Promise<void> } = {}): Promise<FullAnswer & { answerId: number }> {
  const deadline = opts.deadline ?? Date.now() + 230_000;
  const mode = input.mode === "balanced" ? "balanced" : "strict";
  const question = input.question.trim().slice(0, 2000);
  if (!question) throw Object.assign(new Error("Ask a question."), { status: 400 });
  const { docIds, web } = await gather(userId, input.scope, deadline, opts.progress);
  await opts.progress?.("Finding the passages that answer it");
  const plan = await planQueries(question);
  const found = docIds.length ? await retrieve(question, docIds, plan) : null;
  const hits = found?.hits ?? [];
  // The chosen passages with their neighbours in the same section, about 13,000 tokens in all.
  const blocks = hits.length ? expand(hits, await neighbours(hits).catch((e) => { logError(e, { where: "edge-neighbours" }); return []; })) : [];
  let webResult: { text: string; citations: { url: string; title: string }[] } | null = null;
  if (web && Date.now() < deadline - 60_000) { await opts.progress?.("Searching the web"); webResult = await webResearch(question).catch((e) => { logError(e, { where: "edge-web" }); return null; }); }
  const passages: (Block | WebPassage)[] = [...blocks];
  if (webResult?.text) passages.push({ web: true, text: webResult.text.slice(0, 3000), title: `Web: ${webResult.citations[0]?.title ?? "search"}`, url: webResult.citations[0]?.url ?? "" });

  const empty: FullAnswer = { question, mode, text: "", claims: [], citations: [], notFound: true, form: "direct", contradictions: [], web: webResult?.citations ?? [], scopeDocs: docIds.length, ...(found ? { method: found.method } : {}) };
  if (!passages.length) return save(userId, input, { ...empty, text: "Nothing in the documents in scope addresses this." });

  // With exact-span citations (premium, asked for on this question), the quotes are cut from the
  // passages by the API; any failure there falls back to the standard writer below.
  let r: { data: z.infer<typeof Written>; model: string } | null = null;
  let cited = false;
  if (paidOn("citations-anthropic")) {
    await opts.progress?.("Writing the answer with exact citations");
    try {
      const c = await citedAnswer(question, passages.map((p) => ({ title: "web" in p ? p.title : blockLabel(p), text: p.text })), mode, Math.max(30_000, Math.min(150_000, deadline - Date.now() - 40_000)));
      const { direct, claims } = claimsOf(c.pieces, mode);
      r = { model: c.model, data: { notFound: c.notFound || (!claims.length && mode === "strict"), form: "direct", direct, claims: claims.map((x) => ({ text: x.text, analysis: x.analysis, cites: x.spans.map((sp) => ({ n: sp.passage + 1, quote: sp.quote })) })), table: null, timeline: null, contradictions: [] } };
      cited = true;
    } catch (e) { logError(e, { where: "edge-citations" }); }
  }
  if (!r) {
    await opts.progress?.("Writing the answer");
    const numbered = passages.map((p, i) => `[${i + 1}] ${"web" in p ? p.title : blockLabel(p)}\n${p.text}`).join("\n\n");
    const form = input.form && input.form !== "auto" ? `Answer as a ${input.form}.` : "Choose the answer's shape: a direct answer, a table (for comparisons and numbers across items), a timeline (for sequences of events) or a memo (for broad questions).";
    const model = answerModel();
    r = await structured(Written, "edge-answer",
      `You answer research questions for investment professionals using only the numbered passages. ${mode === "strict" ? "STRICT: every claim must quote the passage it rests on, word for word; if the passages do not answer the question, set notFound and say so plainly. Do not add knowledge from outside the passages." : "BALANCED: prefer quoted claims; you may add inference, but mark it as analysis."} Flag passages that contradict each other. Never invent numbers, names or dates.`,
      `${form}\n\nQuestion: ${question}\n\nPassages:\n${numbered}`,
      { maxTokens: 4000, timeoutMs: 150_000, ...(model ? { override: { model } } : {}) });
  }
  await opts.progress?.("Checking every citation");

  // The check: each quote must be found in the passage it cites. A block's quote is credited to the
  // passage inside it that holds the words (so the citation opens the right page or moment).
  const citations: Citation[] = [];
  const byChunk = new Map<string, number>();
  const firstOfBlock = new Map<number, number>();
  let tried = 0, verified = 0;
  // What Calibrated Claims needs about each citation: its passage, the header it was embedded with, the
  // rank of the passage it came from, and whether its quote was found only on the second reading.
  const citeInfo = new Map<number, { text: string; header: string; rank: number }>();
  const secondReading = new Set<number>();
  const headerOf = (h: Hit) => `${h.title.replace(/\s+(10-K|10-Q|8-K|20-F|6-K|DEF 14A|DEFM14A|S-4|S-1)\b.*$/i, "").trim()}${h.ticker ? ` (${h.ticker})` : ""} · ${h.title}${h.section ? ` · ${h.section}` : ""}`;
  const citeChunk = (h: Hit, quote: string, rank = 8): number => {
    const k = `c${h.chunkId}`;
    if (!byChunk.has(k)) {
      const c: Citation = { n: citations.length + 1, docId: h.docId, title: h.title, quote: quote.slice(0, 400), url: h.url, ...(h.page ? { page: h.page } : {}), ...(h.tStart !== null ? { tStart: h.tStart } : {}) };
      Object.assign(c, { chunkId: h.chunkId, lang: h.lang, fileId: h.fileId, source: h.source, section: h.section });
      citations.push(c);
      byChunk.set(k, c.n);
      citeInfo.set(c.n, { text: h.text, header: headerOf(h), rank });
    }
    return byChunk.get(k)!;
  };
  const cite = (n: number, quote: string): number | null => {
    tried++;
    const p = passages[n - 1];
    if (!p) return null;
    let at: number;
    if ("web" in p) {
      if (!quoteFound(quote, p.text)) return null;
      const k = `w${n}`;
      if (!byChunk.has(k)) { const c: Citation = { n: citations.length + 1, docId: 0, title: p.title, quote: quote.slice(0, 400), url: p.url }; Object.assign(c, { chunkId: 0, lang: "en", fileId: null, source: "web", section: "" }); citations.push(c); byChunk.set(k, c.n); citeInfo.set(c.n, { text: p.text, header: p.title, rank: n }); }
      at = byChunk.get(k)!;
    } else {
      const i = quoteChunk(quote, p.chunks);
      if (i < 0) return null;
      at = citeChunk(p.chunks[i], quote, n);
    }
    verified++;
    if (!firstOfBlock.has(n)) firstOfBlock.set(n, at);
    return at;
  };
  const drafted = r.data.claims.map((c) => ({ text: c.text, analysis: c.analysis, cites: [...new Set(c.cites.map((x) => cite(x.n, x.quote)).filter((x): x is number => x !== null))] }));

  // One more look for claims whose quotes were not found: the small model re-reads the filing (or the
  // sections the passages came from) for words that support them. At most one round.
  let secondPass: AnswerMethod["secondPass"] = null;
  const missing = drafted.map((c, i) => ({ c, i })).filter(({ c }) => !c.cites.length && (mode === "strict" || !c.analysis));
  if (missing.length && hits.length && !r.data.notFound && rereadBudget(deadline) !== null) {
    await opts.progress?.("Looking again for quotes");
    let recovered = 0;
    try {
      const source = await rereadSource(hits, docIds);
      // The budget again once the sections are loaded: the route has 300 seconds, and a paid answer must not be lost.
      const budget = rereadBudget(deadline);
      const quotes = source.length && budget !== null ? await findQuotes(missing.map(({ c }) => c.text), source, budget) : [];
      const good = checkFound(quotes, source, missing.length);
      tried += quotes.length;
      verified += good.length;
      for (const g of good) {
        const target = missing[g.claim - 1];
        if (!target.c.cites.length) recovered++;
        const known = byChunk.has(`c${g.at.chunkId}`);
        const at = citeChunk(g.at, g.quote);
        if (!known) secondReading.add(at);
        if (!target.c.cites.includes(at)) target.c.cites.push(at);
      }
    } catch (e) { logError(e, { where: "edge-requote" }); }
    secondPass = { claims: missing.length, found: recovered, model: EDGE_SMALL_MODEL() };
  }

  const checkedClaims: (Answer["claims"][number] & { support?: ClaimSupport })[] = drafted.flatMap((c) => {
    if (!c.cites.length && (mode === "strict" || !c.analysis)) return mode === "strict" ? [] : [{ text: c.text, cites: [], analysis: true }];
    return [{ text: c.text, cites: c.cites, analysis: c.analysis || !c.cites.length }];
  });
  const dropped = r.data.claims.length - checkedClaims.length;
  // Calibrated Claims: each claim's support probability; Strict holds back those below its line.
  let claims = checkedClaims, held: typeof checkedClaims = [], verifier: VerifierInfo | undefined;
  if (checkedClaims.length && !r.data.notFound) {
    await opts.progress?.("Scoring each claim's support");
    try {
      const passagesOf = (c: { cites: number[] }): CitedPassage[] => c.cites.flatMap((n): CitedPassage[] => { const i = citeInfo.get(n); return i ? [{ text: i.text, header: i.header, rank: i.rank, quote: secondReading.has(n) ? "near" : "exact" }] : []; });
      const scope = [...new Map([...citeInfo.values()].map((i) => { const first = i.header.split(" · ")[0]; return [first, { name: first.replace(/\([^)]*\)/g, "").trim(), ticker: /\(([A-Z][A-Z0-9.\-]{0,9})\)/.exec(first)?.[1] ?? "" }]; })).values()];
      const v = await verifyClaims(checkedClaims.map((c) => ({ text: c.text, analysis: c.analysis, cites: passagesOf(c) })), { mode, scope, answerModel: r.model });
      const scored = checkedClaims.map((c, i) => ({ ...c, support: v.supports[i] }));
      claims = scored.filter((_, i) => !v.hold[i]);
      held = scored.filter((_, i) => v.hold[i]);
      verifier = v.info;
    } catch (e) { logError(e, { where: "edge-claims-verify" }); }
  }
  const notFound = r.data.notFound || (mode === "strict" && !claims.length);
  // Quotes from documents not in English get a translation alongside.
  const foreign = citations.filter((c) => { const lang = (c as Citation & { lang?: string }).lang; return lang && !/^en/i.test(lang); });
  const tr = await translate(foreign.map((c) => ({ n: c.n, text: c.quote, lang: (c as Citation & { lang?: string }).lang ?? "" })));
  for (const c of citations) if (tr.has(c.n)) Object.assign(c, { translation: tr.get(c.n) });

  const remap = (ns: number[]) => [...new Set(ns.map((n) => firstOfBlock.get(n)).filter((x): x is number => !!x))];
  const contradictions = r.data.contradictions.map((x) => ({ a: firstOfBlock.get(x.a) ?? 0, b: firstOfBlock.get(x.b) ?? 0, note: x.note })).filter((x) => x.a && x.b && x.a !== x.b);
  const timeline = r.data.timeline?.map((t) => ({ date: t.date, event: t.event, cites: remap(t.cites) })).filter((t) => t.cites.length || mode === "balanced");
  const text = notFound ? `Not found: the documents in scope do not answer this.${r.data.direct && mode === "balanced" ? ` ${r.data.direct}` : ""}`
    : [r.data.direct, ...claims.map((c) => `- ${c.text}${c.cites.length ? ` ${c.cites.map((n) => `[${n}]`).join("")}` : " *(analysis)*"}`)].join("\n");
  const contextTokens = Math.round(passages.reduce((s, p) => s + p.text.length, 0) / 4);
  // Recordings quoted: which speech model transcribed them (Parakeet's licence asks for its credit).
  const heard = [...new Set(citations.filter((c) => (c as Citation & { source?: string }).source === "audio").map((c) => c.docId))];
  const transcription = heard.length ? [...new Set(((await requireDb().execute(sql`select meta->'transcription'->>'credit' as credit from edge_docs where id in (${sql.join(heard.map((i) => sql`${i}`), sql`, `)})`).catch(() => ({ rows: [] }))).rows as { credit: string | null }[]).map((x) => x.credit).filter((x): x is string => !!x))] : [];
  const provenance: AnswerMethod = { search: found?.method ?? "", reranker: found?.reranker ?? null, selector: found?.selector ?? "", answerModel: r.model, contextTokens, secondPass, ...(transcription.length ? { transcription } : {}) };
  const method = [
    found?.method,
    blocks.length ? `read with their neighbouring passages (about ${Math.max(1, Math.round(contextTokens / 1000))}k tokens, up to ${Math.round(CONTEXT_CHARS / 4000)}k)` : "",
    cited ? `answer by ${r.model} with exact-span citations (Anthropic Citations)` : `answer by ${r.model}`,
    secondPass ? `a second reading by ${secondPass.model} found quotes for ${secondPass.found} of ${secondPass.claims} claim${secondPass.claims === 1 ? "" : "s"}` : "",
    ...transcription,
    verifier ? `claims scored by the calibrated verifier ${verifier.version} (calibration set ${verifier.set}${verifier.nli ? ", with the NLI checker" : ""}${verifier.crosscheck ? `, cross-checked by ${verifier.crosscheck}` : ""})` : "",
  ].filter(Boolean).join("; ");
  return save(userId, input, {
    question, mode, text, claims, citations, notFound, form: r.data.form, contradictions, web: webResult?.citations ?? [],
    checked: { quotes: tried, verified, dropped: Math.max(0, dropped), ...(secondPass ? { recovered: secondPass.found } : {}) }, scopeDocs: docIds.length, method, provenance,
    ...(verifier ? { verifier, held } : {}),
    ...(r.data.table && !notFound ? { table: r.data.table } : {}), ...(timeline?.length && !notFound ? { timeline } : {}),
  });
}

async function save(userId: string, input: AskInput, a: FullAnswer): Promise<FullAnswer & { answerId: number }> {
  const [row] = await requireDb().insert(schema.edgeAnswers).values({ ownerId: userId, question: a.question, mode: a.mode, scope: input.scope as Record<string, unknown>, answer: a as unknown as Record<string, unknown> }).returning({ id: schema.edgeAnswers.id });
  return { ...a, answerId: row.id };
}

export async function answerOf(userId: string, id: number) {
  const [row] = await requireDb().select().from(schema.edgeAnswers).where(eq(schema.edgeAnswers.id, id));
  return row && row.ownerId === userId ? row : null;
}
