/**
 * Cited answers from documents. Sources are gathered for the scope (filings indexed on demand, the
 * Newsroom archive, the person's workspace and uploads, the live web), passages retrieved and reranked,
 * and the answer written only from them. Every claim quotes the passage it rests on, and a checker
 * confirms each quote really appears there. Strict mode (the default for memos) drops what fails and
 * says "not found" when nothing survives; balanced mode keeps inference, marked as analysis. Passages
 * that disagree are flagged, and quotes from documents in other languages come with a translation.
 */
import { eq } from "drizzle-orm";
import { z } from "zod";
import { requireDb, schema } from "@/db";
import { structured } from "@/lib/ai/agent";
import { webResearch } from "@/lib/ai/research";
import { logError } from "@/lib/errors";
import type { Answer, Citation } from "../canvas/values";
import { clock } from "./chunk";
import { quoteFound } from "./text";
import { planQueries, rerank, search, type Hit } from "./retrieve";
import { indexFilings, indexNewsroom, workspaceDocs } from "./sources";
import { readableDocs } from "./store";

export type Scope = { tickers?: string[]; sources?: string[]; forms?: string[]; months?: number; docIds?: number[] };
export type AskInput = { question: string; mode?: "strict" | "balanced"; form?: "auto" | "direct" | "table" | "timeline" | "memo"; scope: Scope };
export type FullAnswer = Answer & { form: string; table?: { columns: string[]; rows: string[][] }; timeline?: { date: string; event: string; cites: number[] }[]; contradictions: { a: number; b: number; note: string }[]; web: { title: string; url: string }[]; checked?: { quotes: number; verified: number; dropped: number }; scopeDocs?: number };

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
    const r = await structured(Translated, "edge-translate", "Translate each numbered quote into plain English, faithfully.", quotes.map((q) => `[${q.n}] (${q.lang}) ${q.text}`).join("\n"), { override: { model: "gpt-5.6-luna", effort: "low" }, maxTokens: 1500, timeoutMs: 45_000 });
    for (const t of r.data.items) out.set(t.n, t.english);
  } catch (e) { logError(e, { where: "edge-translate" }); }
  return out;
}

export async function askDocuments(userId: string, input: AskInput, opts: { deadline?: number; progress?: (m: string) => Promise<void> } = {}): Promise<FullAnswer & { answerId: number }> {
  const deadline = opts.deadline ?? Date.now() + 230_000;
  const mode = input.mode === "balanced" ? "balanced" : "strict";
  const question = input.question.trim().slice(0, 2000);
  if (!question) throw Object.assign(new Error("Ask a question."), { status: 400 });
  const { docIds, web } = await gather(userId, input.scope, deadline, opts.progress);
  await opts.progress?.("Finding the passages that answer it");
  const plan = await planQueries(question);
  const hits = docIds.length ? await rerank(question, await search(docIds, plan.queries, plan.keywords), 12) : [];
  let webResult: { text: string; citations: { url: string; title: string }[] } | null = null;
  if (web && Date.now() < deadline - 60_000) { await opts.progress?.("Searching the web"); webResult = await webResearch(question).catch((e) => { logError(e, { where: "edge-web" }); return null; }); }
  const passages: (Hit | { web: true; text: string; title: string; url: string })[] = [...hits];
  if (webResult?.text) passages.push({ web: true, text: webResult.text.slice(0, 3000), title: `Web: ${webResult.citations[0]?.title ?? "search"}`, url: webResult.citations[0]?.url ?? "" });

  const empty: FullAnswer = { question, mode, text: "", claims: [], citations: [], notFound: true, form: "direct", contradictions: [], web: webResult?.citations ?? [], scopeDocs: docIds.length };
  if (!passages.length) return save(userId, input, { ...empty, text: "Nothing in the documents in scope addresses this." });

  await opts.progress?.("Writing the answer");
  const numbered = passages.map((p, i) => `[${i + 1}] ${"web" in p ? p.title : `${p.title}${p.section ? ` / ${p.section}` : ""}${p.page ? `, page ${p.page}` : ""}${p.tStart !== null ? ` at ${clock(p.tStart)}${p.speaker ? `, ${p.speaker}` : ""}` : ""}`}\n${p.text}`).join("\n\n");
  const form = input.form && input.form !== "auto" ? `Answer as a ${input.form}.` : "Choose the answer's shape: a direct answer, a table (for comparisons and numbers across items), a timeline (for sequences of events) or a memo (for broad questions).";
  const r = await structured(Written, "edge-answer",
    `You answer research questions for investment professionals using only the numbered passages. ${mode === "strict" ? "STRICT: every claim must quote the passage it rests on, word for word; if the passages do not answer the question, set notFound and say so plainly. Do not add knowledge from outside the passages." : "BALANCED: prefer quoted claims; you may add inference, but mark it as analysis."} Flag passages that contradict each other. Never invent numbers, names or dates.`,
    `${form}\n\nQuestion: ${question}\n\nPassages:\n${numbered}`,
    { maxTokens: 4000, timeoutMs: 150_000 });
  await opts.progress?.("Checking every citation");

  // The check: each quote must be found in the passage it cites.
  const citations: Citation[] = [];
  const citeOf = new Map<number, number>();
  let tried = 0, verified = 0;
  const cite = (n: number, quote: string): number | null => {
    tried++;
    const p = passages[n - 1];
    if (!p || !quoteFound(quote, p.text)) return null;
    verified++;
    if (!citeOf.has(n)) {
      const c: Citation = "web" in p ? { n: citations.length + 1, docId: 0, title: p.title, quote: quote.slice(0, 400), url: p.url }
        : { n: citations.length + 1, docId: p.docId, title: p.title, quote: quote.slice(0, 400), url: p.url, ...(p.page ? { page: p.page } : {}), ...(p.tStart !== null ? { tStart: p.tStart } : {}) };
      Object.assign(c, { chunkId: "web" in p ? 0 : p.chunkId, lang: "web" in p ? "en" : p.lang, fileId: "web" in p ? null : p.fileId, source: "web" in p ? "web" : p.source, section: "web" in p ? "" : p.section });
      citations.push(c);
      citeOf.set(n, c.n);
    }
    return citeOf.get(n)!;
  };
  const claims = r.data.claims.flatMap((c) => {
    const cites = [...new Set(c.cites.map((x) => cite(x.n, x.quote)).filter((x): x is number => x !== null))];
    if (!cites.length && (mode === "strict" || !c.analysis)) return mode === "strict" ? [] : [{ text: c.text, cites: [], analysis: true }];
    return [{ text: c.text, cites, analysis: c.analysis || !cites.length }];
  });
  const dropped = r.data.claims.length - claims.length;
  const notFound = r.data.notFound || (mode === "strict" && !claims.length);
  // Quotes from documents not in English get a translation alongside.
  const foreign = citations.filter((c) => { const lang = (c as Citation & { lang?: string }).lang; return lang && !/^en/i.test(lang); });
  const tr = await translate(foreign.map((c) => ({ n: c.n, text: c.quote, lang: (c as Citation & { lang?: string }).lang ?? "" })));
  for (const c of citations) if (tr.has(c.n)) Object.assign(c, { translation: tr.get(c.n) });

  const remap = (ns: number[]) => [...new Set(ns.map((n) => citeOf.get(n)).filter((x): x is number => !!x))];
  const contradictions = r.data.contradictions.map((x) => ({ a: citeOf.get(x.a) ?? 0, b: citeOf.get(x.b) ?? 0, note: x.note })).filter((x) => x.a && x.b && x.a !== x.b);
  const timeline = r.data.timeline?.map((t) => ({ date: t.date, event: t.event, cites: remap(t.cites) })).filter((t) => t.cites.length || mode === "balanced");
  const text = notFound ? `Not found: the documents in scope do not answer this.${r.data.direct && mode === "balanced" ? ` ${r.data.direct}` : ""}`
    : [r.data.direct, ...claims.map((c) => `- ${c.text}${c.cites.length ? ` ${c.cites.map((n) => `[${n}]`).join("")}` : " *(analysis)*"}`)].join("\n");
  return save(userId, input, {
    question, mode, text, claims, citations, notFound, form: r.data.form, contradictions, web: webResult?.citations ?? [],
    checked: { quotes: tried, verified, dropped: Math.max(0, dropped) }, scopeDocs: docIds.length,
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
