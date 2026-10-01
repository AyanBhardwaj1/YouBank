/**
 * The change radar: what a company changed between its last two filings of a kind (10-K year on year,
 * 10-Q quarter on quarter) in a section such as Risk Factors. Paragraphs are matched by their word
 * sequences, so reworded ones show as changed with both versions, new ones as added and dropped ones
 * as removed; a small model then says in a few quoted lines what matters most.
 */
import { inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { requireDb, schema } from "@/db";
import { structured } from "@/lib/ai/agent";
import { cacheGet, cacheSet } from "@/lib/cache";
import { edgarFetch } from "@/lib/edgar/client";
import { htmlToText } from "@/lib/edgar/filingText";
import { getSubmissions, listFilings } from "@/lib/edgar/submissions";
import { resolveTicker } from "@/lib/edgar/tickers";
import { logError } from "@/lib/errors";
import { getObject, putObject, r2Ready } from "../infra/r2";
import { small } from "../models";
import { sectionText } from "./chunk";
import { canRead } from "./store";
import { quoteFound } from "./text";
import { toneShift, type Turn } from "./tone";

export type ChangeRow = { status: "added" | "removed" | "changed"; text: string; before?: string; similarity: number };
export type Radar = {
  ticker: string; name: string; form: string; section: string;
  current: { filed: string; url: string } | null; prior: { filed: string; url: string } | null;
  counts: { added: number; removed: number; changed: number; unchanged: number }; rows: ChangeRow[]; summary: string[];
};

const SECTION_NAME: Record<string, string> = { risk: "Risk factors", mdna: "MD&A" };

/** Paragraphs worth comparing (headings and table scraps are skipped). Pure. */
export function paragraphs(text: string): string[] {
  return text.split(/\n+/).map((p) => p.replace(/\s+/g, " ").trim()).filter((p) => p.length >= 80 && /[a-z]{3,}/i.test(p)).slice(0, 600);
}

const shingles = (t: string) => { const w = t.toLowerCase().replace(/[^a-z0-9% ]+/g, " ").split(/\s+/).filter(Boolean); const s = new Set<string>(); for (let i = 0; i + 3 <= w.length; i++) s.add(w.slice(i, i + 3).join(" ")); return s; };

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  const [small, big] = a.size < b.size ? [a, b] : [b, a];
  for (const x of small) if (big.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Paragraph-level differences between two versions of a section. Pure, for tests. */
export function diffSections(prior: string, current: string): { rows: ChangeRow[]; counts: Radar["counts"] } {
  const P = paragraphs(prior), C = paragraphs(current);
  const sp = P.map(shingles), sc = C.map(shingles);
  const rows: ChangeRow[] = [];
  let unchanged = 0;
  const priorBest = new Array(P.length).fill(0);
  C.forEach((c, i) => {
    let best = 0, at = -1;
    sp.forEach((s, j) => { const v = jaccard(sc[i], s); if (v > best) { best = v; at = j; } if (v > priorBest[j]) priorBest[j] = v; });
    if (best >= 0.85) unchanged++;
    else if (best >= 0.3) rows.push({ status: "changed", text: c, before: P[at], similarity: Math.round(best * 100) / 100 });
    else rows.push({ status: "added", text: c, similarity: Math.round(best * 100) / 100 });
  });
  P.forEach((p, j) => { if (priorBest[j] < 0.3) rows.push({ status: "removed", text: p, similarity: Math.round(priorBest[j] * 100) / 100 }); });
  const order = { added: 0, changed: 1, removed: 2 };
  rows.sort((a, b) => order[a.status] - order[b.status] || a.similarity - b.similarity);
  return { rows, counts: { added: rows.filter((r) => r.status === "added").length, removed: rows.filter((r) => r.status === "removed").length, changed: rows.filter((r) => r.status === "changed").length, unchanged } };
}

/** A filing's text, kept in R2 after the first read (shared with Documents and the graph). */
export async function filingTextCached(accession: string, url: string): Promise<string> {
  const key = `docs/sec/${accession}.txt`;
  if (r2Ready()) { const hit = await getObject(key).catch(() => null); if (hit) return hit.text(); }
  const res = await edgarFetch(url);
  if (!res.ok) throw new Error(`SEC answered ${res.status}`);
  const text = htmlToText(await res.text());
  if (r2Ready()) await putObject(key, text, "text/plain; charset=utf-8").catch(() => undefined);
  return text;
}

const Summary = z.object({ lines: z.array(z.string()).max(6).describe("what changed that matters, each line quoting a few words from the filing") });

export async function changeRadar(tickerIn: string, form: "10-K" | "10-Q", section: "risk" | "mdna" | "all"): Promise<Radar> {
  const ticker = tickerIn.trim().toUpperCase();
  const t = await resolveTicker(ticker);
  if (!t) throw Object.assign(new Error(`No SEC filer for ${ticker}`), { status: 404 });
  const filings = listFilings(await getSubmissions(String(t.cik)), [form], 10).filter((f) => f.form === form).slice(0, 2);
  const empty: Radar = { ticker, name: t.name, form, section, current: null, prior: null, counts: { added: 0, removed: 0, changed: 0, unchanged: 0 }, rows: [], summary: [] };
  if (filings.length < 2) return { ...empty, summary: [`${t.name} has fewer than two ${form} filings on EDGAR to compare.`] };
  const [cur, prev] = filings;
  // v3 for MD&A: a 10-Q's "Item 2. Management's Discussion" was not read as MD&A before, so its radar came back empty.
  const cacheKey = `edge:radar:${section === "mdna" ? "v3" : "v2"}:${cur.accession}:${prev.accession}:${section}`;
  const hit = await cacheGet(cacheKey);
  if (hit) return JSON.parse(hit) as Radar;
  const [a, b] = await Promise.all([filingTextCached(cur.accession, cur.url), filingTextCached(prev.accession, prev.url)]);
  const pick = (text: string) => (section === "all" ? text : sectionText(text, SECTION_NAME[section]) || "");
  const { rows, counts } = diffSections(pick(b), pick(a));
  let summary: string[] = [];
  const notable = rows.filter((r) => r.status !== "changed" || r.similarity < 0.6).slice(0, 14);
  if (notable.length) {
    try {
      const r = await structured(Summary, "edge-radar", "You compare two versions of a company's filing section for an analyst. Say what is new, removed or materially reworded and why it might matter. Quote the filing; never speculate beyond it.",
        notable.map((x, i) => `${i + 1}. ${x.status.toUpperCase()}: ${x.text.slice(0, 600)}${x.before ? `\n   BEFORE: ${x.before.slice(0, 400)}` : ""}`).join("\n\n"),
        { override: small(), maxTokens: 900, timeoutMs: 60_000 });
      summary = r.data.lines;
    } catch (e) { logError(e, { where: "edge-radar-summary" }); }
  }
  const radar: Radar = { ...empty, current: { filed: cur.filed, url: cur.url }, prior: { filed: prev.filed, url: prev.url }, counts, rows: rows.slice(0, 120), summary };
  await cacheSet(cacheKey, JSON.stringify(radar), 7 * 86_400_000);
  return radar;
}

/* ---------------- Two documents: calls quarter to quarter, data-room versions ---------------- */

export type NovelPassage = { chunkId: number; text: string; page: number; tStart: number | null; speaker: string; novelty: number };
export type DocCompare = {
  a: { id: number; title: string; source: string }; b: { id: number; title: string; source: string };
  recording: boolean;
  /** 0 when every passage has a close match on the other side, towards 1 when little does. */
  distance: number;
  newInB: NovelPassage[]; goneFromA: NovelPassage[];
  paragraphs: { counts: Radar["counts"]; rows: ChangeRow[] } | null;
  tone: ReturnType<typeof toneShift> | null;
  summary: { text: string; quote: string; chunkId: number; side: "a" | "b" }[];
};

const Compared = z.object({
  lines: z.array(z.object({
    text: z.string().describe("one change that matters, in a sentence"),
    n: z.number().int().describe("the numbered passage it rests on"),
    quote: z.string().describe("the exact words from that passage, under 30 words"),
  })).max(8),
});

type ChunkRow = { id: number; ord: number; text: string; page: number; t_start: number | null; speaker: string; dist: number };

/** The passages of one document least like anything in the other (by meaning, not wording). */
async function novelPassages(from: number, against: number, limit = 8): Promise<{ rows: NovelPassage[]; mean: number }> {
  const res = await requireDb().execute(sql`
    with x as (select id, ord, text, page, t_start, speaker, embedding from edge_chunks where doc_id = ${from} and embedding is not null order by ord limit 600),
         y as (select embedding from edge_chunks where doc_id = ${against} and embedding is not null order by ord limit 600)
    select x.id, x.ord, x.text, x.page, x.t_start, x.speaker, (select min(x.embedding <=> y.embedding) from y) as dist from x`);
  const all = (res.rows as ChunkRow[]).map((r) => ({ ...r, dist: Number(r.dist) || 0 }));
  const mean = all.length ? all.reduce((s, r) => s + r.dist, 0) / all.length : 0;
  const rows = all.filter((r) => r.text.length >= 60).sort((p, q) => q.dist - p.dist).slice(0, limit)
    .map((r) => ({ chunkId: Number(r.id), text: r.text.slice(0, 900), page: r.page, tStart: r.t_start === null ? null : Number(r.t_start), speaker: r.speaker, novelty: Math.round(r.dist * 100) / 100 }));
  return { rows, mean };
}

async function fullText(docId: number): Promise<string> {
  const rows = (await requireDb().execute(sql`select text from edge_chunks where doc_id = ${docId} order by ord limit 4000`)).rows as { text: string }[];
  return rows.map((r) => r.text).join("\n");
}

/**
 * What changed from one document to another the person can read: passages new in the later one and
 * gone from the earlier (by meaning, so it works for calls where nothing is said the same way twice),
 * paragraph edits when the two are versions of one text, hedging and tone per speaker for recordings,
 * and a few quoted lines on what matters (each quote checked against its passage).
 */
export async function compareDocs(userId: string, aId: number, bId: number): Promise<DocCompare> {
  const db = requireDb();
  const docs = await db.select().from(schema.edgeDocs).where(inArray(schema.edgeDocs.id, [aId, bId]));
  const A = docs.find((d) => d.id === aId), B = docs.find((d) => d.id === bId);
  if (!A || !B || !(await canRead(userId, A)) || !(await canRead(userId, B))) throw Object.assign(new Error("Pick two documents you can read."), { status: 404 });
  if (A.status !== "ready" || B.status !== "ready") throw Object.assign(new Error("Both documents must finish reading first."), { status: 409 });
  const key = `edge:cmp:v2:${aId}:${bId}:${A.chunks}:${B.chunks}`;
  const hit = await cacheGet(key);
  if (hit) return JSON.parse(hit) as DocCompare;

  const recording = A.source === "audio" && B.source === "audio";
  const [nb, na] = await Promise.all([novelPassages(bId, aId), novelPassages(aId, bId)]);
  let paragraphs: DocCompare["paragraphs"] = null;
  if (!recording) {
    const d = diffSections(await fullText(aId), await fullText(bId));
    // Only worth showing when the two are versions of one text (enough paragraphs survive unchanged).
    if (d.counts.unchanged >= Math.max(3, (d.counts.added + d.counts.removed) * 0.1)) paragraphs = { counts: d.counts, rows: d.rows.slice(0, 80) };
  }
  const turnsOf = (m: unknown) => ((m as { turns?: Turn[] }).turns ?? []);
  const tone = recording && turnsOf(A.meta).length && turnsOf(B.meta).length ? toneShift(turnsOf(A.meta), turnsOf(B.meta)) : null;

  const numbered = [...nb.rows.map((p) => ({ p, side: "b" as const })), ...na.rows.map((p) => ({ p, side: "a" as const }))];
  let summary: DocCompare["summary"] = [];
  if (numbered.length) {
    try {
      const r = await structured(Compared, "edge-compare",
        "You compare two documents for an analyst: an earlier one (A) and a later one (B), such as two quarters' earnings calls or two versions of a data-room file. From the numbered passages (new in B, or found only in A) say what changed that matters: new topics, dropped topics, changed guidance or numbers, shifts in confidence. Every line quotes its passage word for word. Never speculate beyond the passages.",
        `A: ${A.title}\nB: ${B.title}\n${tone?.length ? `Tone shift by speaker (B minus A): ${tone.map((t) => `${t.speaker} hedging ${t.hedging >= 0 ? "+" : ""}${t.hedging}, tone ${t.tone >= 0 ? "+" : ""}${t.tone}`).join("; ")}\n` : ""}\nPassages:\n${numbered.map((x, i) => `[${i + 1}] ${x.side === "b" ? "NEW IN B" : "ONLY IN A"}${x.p.speaker ? ` (${x.p.speaker})` : ""}: ${x.p.text}`).join("\n\n")}`,
        { override: small(), maxTokens: 1200, timeoutMs: 60_000 });
      summary = r.data.lines.flatMap((l) => {
        const x = numbered[l.n - 1];
        return x && quoteFound(l.quote, x.p.text) ? [{ text: l.text, quote: l.quote, chunkId: x.p.chunkId, side: x.side }] : [];
      });
    } catch (e) { logError(e, { where: "edge-compare-summary" }); }
  }
  const out: DocCompare = {
    a: { id: A.id, title: A.title, source: A.source }, b: { id: B.id, title: B.title, source: B.source }, recording,
    distance: Math.round(((nb.mean + na.mean) / 2) * 100) / 100, newInB: nb.rows, goneFromA: na.rows, paragraphs, tone, summary,
  };
  await cacheSet(key, JSON.stringify(out), 7 * 86_400_000);
  return out;
}
