/**
 * Call Desk (E5) on stored calls: read a call (a recording's speaker turns, or a transcript filed as an 8-K
 * exhibit) into Q&A pairs, score each pair's evasion with calibrated probabilities, state the call's evasion
 * rate as a Beta-binomial posterior against the company's last four calls, list what was avoided, and keep
 * the commitments ledger: every quantified forward statement becomes a forecast in the ledger (F3, kind
 * `guidance`) that the daily resolver settles from XBRL when the 10-Q or 10-K lands. Pairs and the summary
 * live in `edge_docs.meta` (meta.qa, meta.callDesk); provenance goes under `call:<docId>`.
 *
 * Free by default (the in-process classifier). The Eva-4B ensemble runs only inside a premium scope holding
 * edge.calls-eva, with EDGE_CALLS_EVA=1 and the ML service configured; otherwise the free result stands.
 * Background work (the daily pass reading filed transcripts) never opens a scope.
 *
 * Interface for other features (Management Track Record, the Thesis Agent):
 *   readCall(userId, docId, opts)   score a call and log its commitments; returns the call view
 *   callView(userId, docId)         the stored view of a read call
 *   commitmentsFor(userId, ticker)  the company's promises with their status and the hit rate
 *   callsDaily(deadline)            filed transcripts and releases of watched companies; due and resolved cards
 */
import { and, desc, eq, gte, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import type { ForecastRule } from "@/db/schema";
import { premiumOn } from "@/lib/billing/use";
import { getCompanyFactsFull, rowsFor } from "@/lib/edgar/facts";
import { getSubmissions } from "@/lib/edgar/submissions";
import { resolveTicker } from "@/lib/edgar/tickers";
import { logError } from "@/lib/errors";
import { jeffreys } from "../calib";
import { canRead, type DocRow } from "../docs/store";
import { indexFilings } from "../docs/sources";
import { logForecast } from "../forecasts/ledger";
import { pickReported } from "../forecasts/rules";
import { getBytes } from "../infra/r2";
import { mlReady, mlRun } from "../infra/ml";
import { upgradeOn } from "../premium";
import { record } from "../provenance";
import { BETA_ON } from "../watches";
import { pooled, probRose, ratePosterior, roseSentence } from "./calibrate";
import { CONCEPTS, daysWindow, extractCommitments, guidanceQuestion, guidanceRule, hitProbability, METRIC_LABEL, outcomeOf, periodEnd, withdrawsGuidance, type Commitment } from "./commitments";
import { classifyPair, ensemble, evasionModel, scorecardLine, topicOf, type Scored } from "./evasion";
import { looksLikeTranscript, pairQa, turnsFromChunks, turnsFromText, type QaPair } from "./qa";

export const DISCLAIMER = "A statistical reading of public words: whether an answer addressed the question asked. It never says anyone lied.";
const DAY = 86_400_000;

export type ScoredPair = QaPair & Partial<Scored> & { topic: string };
export type CallSummary = { n: number; scored: number; expected: number; mean: number; low: number; high: number; a: number; b: number };
export type Comparison = { calls: number; before: { mean: number; a: number; b: number }; prob: number; rose: boolean; sentence: string };
export type CommitmentView = Commitment & { id?: number; status: "open" | "hit" | "missed_low" | "missed_high" | "unresolved" | "unmapped" | "withdrawn" | "raised" | "lowered"; p?: number; closesAt?: string; reported?: number | null; missPct?: number; source?: string; docId?: number; said?: string; concept?: string };
export type CallView = {
  docId: number; title: string; ticker: string; name: string; said: string; media: boolean; url: string;
  /** The recording to play from a question's moment, when the call is a recording. */
  raw: string | null;
  pairs: ScoredPair[]; summary: CallSummary | null; comparison: Comparison | null; avoided: { topic: string; n: number; p: number }[];
  commitments: CommitmentView[]; engine: string; classifier: { version: string; scorecard: string }; eva: { asked: boolean; used: boolean; note: string };
  disclaimer: string; readAt: string; note?: string;
  /** The text withdraws or suspends guidance: open promises said before it are marked withdrawn. */
  withdrawn?: boolean;
};

type Meta = { ticker?: string; cik?: string; company?: string; filed?: string; textKey?: string; transcriptKey?: string; qa?: ScoredPair[]; callDesk?: Omit<CallView, "pairs" | "docId" | "title" | "media" | "url" | "raw"> };

/** The call's turns: a recording's passages with speakers, or the filed text (from R2, else the passages joined). */
async function turnsOf(doc: DocRow): Promise<{ turns: ReturnType<typeof turnsFromText>; text: string }> {
  const db = requireDb();
  const chunks = await db.select({ text: schema.edgeChunks.text, speaker: schema.edgeChunks.speaker, tStart: schema.edgeChunks.tStart, ord: schema.edgeChunks.ord })
    .from(schema.edgeChunks).where(eq(schema.edgeChunks.docId, doc.id)).orderBy(schema.edgeChunks.ord).limit(4000);
  const media = doc.source === "audio" || /^(audio|video)\//.test(doc.mime);
  if (media && chunks.some((c) => c.speaker)) return { turns: turnsFromChunks(chunks), text: chunks.map((c) => `${c.speaker ? `${c.speaker}: ` : ""}${c.text}`).join("\n") };
  const meta = doc.meta as Meta;
  let text = "";
  if (meta.textKey) { const b = await getBytes(meta.textKey).catch(() => null); if (b) text = new TextDecoder().decode(b); }
  if (!text) text = chunks.reduce((acc, c) => (acc ? `${acc}\n${c.text}` : c.text), "");
  return { turns: turnsFromText(text), text };
}

const docOf = async (docId: number) => (await requireDb().select().from(schema.edgeDocs).where(eq(schema.edgeDocs.id, docId)))[0] ?? null;

/** The company's earlier read calls (their summaries), newest first, readable by this person. */
async function earlierCalls(userId: string | null, ticker: string, before: string, excludeId: number): Promise<CallSummary[]> {
  if (!ticker) return [];
  const rows = await requireDb().select({ id: schema.edgeDocs.id, ownerId: schema.edgeDocs.ownerId, teamId: schema.edgeDocs.teamId, summary: sql<CallSummary | null>`${schema.edgeDocs.meta}->'callDesk'->'summary'`, said: sql<string>`coalesce(${schema.edgeDocs.meta}->'callDesk'->>'said', '')` })
    .from(schema.edgeDocs).where(and(sql`${schema.edgeDocs.meta}->>'ticker' = ${ticker}`, sql`${schema.edgeDocs.meta}->'callDesk'->'summary' is not null`)).orderBy(desc(schema.edgeDocs.createdAt)).limit(20);
  const out: CallSummary[] = [];
  for (const r of rows) {
    if (r.id === excludeId || !r.summary || (r.said && r.said >= before)) continue;
    if (userId !== null && !(await canRead(userId, { ownerId: r.ownerId, teamId: r.teamId }))) continue;
    if (userId === null && r.ownerId !== "") continue;
    out.push(r.summary);
    if (out.length >= 4) break;
  }
  return out;
}

/** Eva-4B's class probabilities for the pairs, from the ML service; null when it cannot or may not run. */
async function evaFor(pairs: QaPair[]): Promise<number[][] | null> {
  if (!premiumOn("edge.calls-eva") || !upgradeOn("calls-eva") || !mlReady()) return null;
  try {
    const r = await mlRun<{ probs: number[][] }>("calls.evasion", { pairs: pairs.map((p) => ({ question: p.question.slice(0, 3000), answer: p.answer.slice(0, 5000) })) }, 240_000);
    return Array.isArray(r.probs) && r.probs.length === pairs.length ? r.probs : null;
  } catch (e) { logError(e, { where: "edge-calls-eva" }); return null; }
}

type CompanyRef = { ticker: string; name: string; cik: string; fye: string };

async function companyRef(ticker: string): Promise<CompanyRef | null> {
  if (!ticker) return null;
  const t = await resolveTicker(ticker);
  if (!t) return null;
  const subs = await getSubmissions(String(t.cik)).catch(() => null);
  return { ticker: t.ticker, name: t.name, cik: String(t.cik), fye: subs?.fiscalYearEnd || "1231" };
}

/**
 * Log a company's commitments to the ledger: the filer's own concept chosen (the first with reported values),
 * growth ranges made absolute from the prior period, the probability from the company's resolved record.
 * Shared for public filings; private (the uploader's) for an upload. Returns each commitment's view.
 */
export async function logCommitments(c: CompanyRef, list: Commitment[], docId: number, said: string, ownerId: string | null): Promise<CommitmentView[]> {
  const out: CommitmentView[] = [];
  if (!list.length) return out;
  const cf = await getCompanyFactsFull(c.cik.padStart(10, "0")).catch(() => null);
  const record = await guidanceRecord(c.cik);
  const prob = hitProbability(record.hits, record.misses);
  for (let i = 0; i < list.length; i++) {
    const k = list[i];
    if (!k.mapped || !k.period || k.metric === "production" || !cf) { out.push({ ...k, status: "unmapped", docId, said }); continue; }
    const map = CONCEPTS[k.metric];
    const concept = map.concepts.find((x) => x.startsWith("derived:") || rowsFor(cf, "us-gaap", x, map.unit).length > 0);
    if (!concept) { out.push({ ...k, mapped: false, why: "the company reports no XBRL concept for this metric", status: "unmapped", docId, said }); continue; }
    let abs: Commitment = k;
    if (k.unit === "pct_growth") {
      // A growth range is scored against the prior period's reported value of the same concept.
      if (concept.startsWith("derived:") || k.low === null || k.high === null) { out.push({ ...k, mapped: false, why: "a growth range on a derived metric is not scored", status: "unmapped", docId, said }); continue; }
      const prior = { ...k.period, fy: k.period.fy - 1 };
      const base = pickReported(rowsFor(cf, "us-gaap", concept, map.unit), { period: periodEnd(prior, c.fye), days: daysWindow(prior), endWithinDays: 10 });
      if (!base) { out.push({ ...k, mapped: false, why: "the prior period's value is not reported, so the growth range cannot be made absolute", status: "unmapped", docId, said }); continue; }
      abs = { ...k, low: base.value * (1 + k.low), high: base.value * (1 + k.high), unit: "usd" };
    }
    const rule = guidanceRule(abs, c.cik, concept, map.unit, c.fye);
    if (!rule) { out.push({ ...k, status: "unmapped", docId, said }); continue; }
    const closes = new Date(Date.parse(rule.period) + (k.period.q ? 45 : 75) * DAY);
    if (closes.getTime() < Date.parse(said)) { out.push({ ...k, status: "unmapped", why: "the period had already ended when it was said", docId, said }); continue; }
    try {
      const f = await logForecast({
        kind: "guidance", subject: `doc:${docId}:commitment:${i + 1}`, question: guidanceQuestion(c.name, c.ticker, abs), probability: prob.p, low: prob.low, high: prob.high, baseRate: prob.base,
        opensAt: new Date(said), closesAt: closes, rule, model: "call-desk-guidance", modelVersion: `beta-record v1 (${record.hits} hit, ${record.misses} missed before)`, ownerId,
      });
      out.push({ ...abs, id: f.id, status: "open", p: prob.p, closesAt: closes.toISOString(), docId, said, concept });
    } catch (e) { logError(e, { where: "edge-calls-log" }); out.push({ ...k, status: "unmapped", why: "could not be logged", docId, said }); }
  }
  return out;
}

/** A company's resolved guidance record (shared forecasts): hits and misses. */
async function guidanceRecord(cik: string): Promise<{ hits: number; misses: number }> {
  const [r] = (await requireDb().execute(sql`select count(*) filter (where outcome >= 0.5)::int as hits, count(*) filter (where outcome < 0.5)::int as misses from edge_forecasts where kind = 'guidance' and owner_id is null and resolved_at is not null and outcome is not null and rule->>'cik' = ${cik}`)).rows as { hits: number; misses: number }[];
  return { hits: Number(r?.hits ?? 0), misses: Number(r?.misses ?? 0) };
}

/**
 * Read a call: pairs, scores, the call's posterior against the last four calls, what was avoided, and the
 * commitments it states (logged to the ledger). `userId` null is the daily pass (public filings only).
 * `ticker` names the company for an upload that does not say.
 */
export async function readCall(userId: string | null, docId: number, opts: { ticker?: string; eva?: boolean } = {}): Promise<CallView> {
  const doc = await docOf(docId);
  if (!doc || (userId === null ? doc.ownerId !== "" : !(await canRead(userId, doc)))) throw Object.assign(new Error("That document is not in your library."), { status: 404 });
  if (doc.status !== "ready") throw Object.assign(new Error("That document is still being read. Try again when it is ready."), { status: 409 });
  const meta = doc.meta as Meta;
  const ticker = (opts.ticker || meta.ticker || "").toUpperCase();
  const company = await companyRef(ticker).catch(() => null);
  const said = (meta.filed || doc.createdAt.toISOString()).slice(0, 10);
  const { turns, text } = await turnsOf(doc);
  const pairs = pairQa(turns);
  const media = doc.source === "audio" || /^(audio|video)\//.test(doc.mime);
  const m = evasionModel();
  const clear = pairs.filter((p) => p.clear);
  const eva = opts.eva && clear.length ? await evaFor(clear) : null;
  const scored: ScoredPair[] = pairs.map((p) => {
    const topic = topicOf(p.question);
    if (!p.clear) return { ...p, topic };
    const free = classifyPair(p.question, p.answer, m);
    const k = clear.indexOf(p);
    return { ...p, topic, ...(eva ? ensemble(free, eva[k] ?? null, p.question, p.answer) : free) };
  });
  const pEvasive = scored.filter((p) => p.p).map((p) => p.p!.evasive);
  const post = pEvasive.length ? ratePosterior(pEvasive) : null;
  const summary: CallSummary | null = post ? { n: pairs.length, scored: pEvasive.length, expected: post.expected, mean: post.mean, low: post.low, high: post.high, a: post.a, b: post.b } : null;
  const prior = summary ? await earlierCalls(userId, ticker, said, docId) : [];
  let comparison: Comparison | null = null;
  if (summary && prior.length) {
    const before = pooled(prior.map((c) => ({ expected: c.expected, n: c.scored })));
    const prob = probRose({ a: summary.a, b: summary.b }, before);
    comparison = { calls: prior.length, before: { mean: before.a / (before.a + before.b), ...before }, prob, rose: prob >= 0.9, sentence: roseSentence(prob, summary, before, prior.length) };
  }
  const avoided = [...scored.filter((p) => p.p && p.cls !== "direct").reduce((acc, p) => acc.set(p.topic, [...(acc.get(p.topic) ?? []), p.p!.evasive + p.p!.intermediate / 2]), new Map<string, number[]>())]
    .map(([topic, ps]) => ({ topic, n: ps.length, p: ps.reduce((s, v) => s + v, 0) / ps.length })).sort((a, b) => b.n - a.n || b.p - a.p).slice(0, 6);
  // Commitments: management's words (prepared remarks and answers), or the whole release when it is not a call.
  const mgmtText = pairs.length ? turns.filter((t) => t.role !== "analyst" && t.role !== "operator").map((t) => t.text).join("\n") || text : text;
  const found = extractCommitments(mgmtText, said);
  const ownerId = doc.ownerId === "" ? null : doc.ownerId;
  const commitments = company ? await logCommitments(company, found, docId, said, ownerId) : found.map((c) => ({ ...c, status: "unmapped" as const, why: c.mapped ? "name the company's ticker to score it" : c.why, docId, said }));
  const evaNote = !opts.eva ? "" : eva ? "Eva-4B averaged with the free classifier (Eva-4B's probabilities are not yet calibrated on Edge's labels)." : !upgradeOn("calls-eva") ? "Eva-4B is switched off (EDGE_CALLS_EVA): the free classifier was used." : "Eva-4B did not answer: the free classifier was used.";
  const note = !pairs.length ? (looksLikeTranscript(text) ? "No question-and-answer pairs could be told apart in this transcript." : "This document has no question-and-answer session; only its commitments were read.") : undefined;
  const view: CallView = {
    docId, title: doc.title, ticker, name: company?.name ?? meta.company ?? "", said, media, url: doc.url, raw: media && doc.fileId ? `/api/edge/files/${doc.fileId}/raw` : null, pairs: scored, summary, comparison, avoided, commitments,
    engine: eva ? `${scored.find((p) => p.engine)?.engine ?? ""}` : `classifier ${m.version}`, classifier: { version: m.version, scorecard: scorecardLine(m) },
    eva: { asked: !!opts.eva, used: !!eva, note: evaNote }, disclaimer: DISCLAIMER, readAt: new Date().toISOString(), ...(note ? { note } : {}), ...(withdrawsGuidance(mgmtText) ? { withdrawn: true } : {}),
  };
  const { pairs: qa, docId: _d, title: _t, media: _m, url: _u, raw: _r, ...desk } = view;
  void _d; void _t; void _m; void _u; void _r;
  await requireDb().update(schema.edgeDocs).set({ meta: { ...doc.meta, ...(ticker && !meta.ticker ? { ticker } : {}), qa: qa.map((p) => ({ ...p, question: p.question.slice(0, 2500), answer: p.answer.slice(0, 4000) })), callDesk: desk } }).where(eq(schema.edgeDocs.id, docId));
  await record(`call:${docId}`, [{ sourceName: doc.title || `Document ${docId}`, sourceUrl: doc.url, license: doc.source === "sec" ? "Public filing (SEC EDGAR)" : "Your document", method: `Q&A segmentation v1; evasion ${view.engine}; calibration set ${m.set.name} ${m.set.version}; commitments read by rule (no model)`, modelVersion: m.version, retrievedAt: new Date() }]).catch(() => undefined);
  if (comparison?.rose && company) await evasionCard(view, ownerId).catch((e) => logError(e, { where: "edge-calls-card" }));
  return view;
}

/** The stored view of a call that was read (null when it has not been). */
export async function callView(userId: string, docId: number): Promise<CallView | null> {
  const doc = await docOf(docId);
  if (!doc || !(await canRead(userId, doc))) return null;
  const meta = doc.meta as Meta;
  if (!meta.callDesk) return null;
  const statuses = await ledgerStatus((meta.callDesk.commitments ?? []).map((c) => c.id).filter((x): x is number => typeof x === "number"));
  const commitments = (meta.callDesk.commitments ?? []).map((c) => (c.id && statuses.has(c.id) ? { ...c, ...statuses.get(c.id)! } : c));
  const media = doc.source === "audio" || /^(audio|video)\//.test(doc.mime);
  return { ...meta.callDesk, commitments, pairs: meta.qa ?? [], docId, title: doc.title, media, url: doc.url, raw: media && doc.fileId ? `/api/edge/files/${doc.fileId}/raw` : null };
}

/** For forecast ids: their status from the ledger (resolved, the reported value, how far outside the range). */
async function ledgerStatus(ids: number[]): Promise<Map<number, Pick<CommitmentView, "status" | "reported" | "missPct" | "source">>> {
  const out = new Map<number, Pick<CommitmentView, "status" | "reported" | "missPct" | "source">>();
  if (!ids.length) return out;
  const rows = await requireDb().select().from(schema.edgeForecasts).where(inArray(schema.edgeForecasts.id, ids));
  for (const f of rows) {
    if (!f.resolvedAt) { out.set(f.id, { status: "open" }); continue; }
    const reported = reportedFrom(f.resolutionSource);
    if (f.outcome === null || reported === null || f.rule.type !== "xbrl") { out.set(f.id, { status: "unresolved", source: f.resolutionSource }); continue; }
    const o = outcomeOf(f.rule, reported);
    out.set(f.id, { status: o.status, reported, missPct: o.missPct, source: f.resolutionSource });
  }
  return out;
}

/** The reported value at the end of the resolver's source line ("SEC XBRL Revenues for the period ending ...: 4321000000"). Pure. */
export function reportedFrom(source: string): number | null {
  const m = /:\s*(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)\s*$/i.exec(source.trim());
  return m ? Number(m[1]) : null;
}

/**
 * A company's commitments (shared ones, and this person's own from their uploads) with their status: open,
 * hit, missed low or high, superseded by a raised or lowered range, withdrawn; the unmapped ones listed; and
 * the hit rate with a Jeffreys 90% interval.
 */
export async function commitmentsFor(userId: string, ticker: string): Promise<{ ticker: string; name: string; rows: CommitmentView[]; hitRate: { hits: number; n: number; rate: number | null; low: number | null; high: number | null; text: string } }> {
  const c = await companyRef(ticker);
  if (!c) throw Object.assign(new Error("That company is not in SEC's list."), { status: 404 });
  const db = requireDb();
  const rows = await db.select().from(schema.edgeForecasts)
    .where(and(eq(schema.edgeForecasts.kind, "guidance"), sql`${schema.edgeForecasts.rule}->>'cik' = ${c.cik}`, or(isNull(schema.edgeForecasts.ownerId), eq(schema.edgeForecasts.ownerId, userId))))
    .orderBy(desc(schema.edgeForecasts.createdAt)).limit(300);
  const status = await ledgerStatus(rows.map((r) => r.id));
  const docs = await db.select({ id: schema.edgeDocs.id, ownerId: schema.edgeDocs.ownerId, teamId: schema.edgeDocs.teamId, desk: sql<{ commitments?: CommitmentView[]; said?: string; withdrawn?: boolean } | null>`${schema.edgeDocs.meta}->'callDesk'` })
    .from(schema.edgeDocs).where(and(sql`${schema.edgeDocs.meta}->>'ticker' = ${c.ticker}`, isNotNull(sql`${schema.edgeDocs.meta}->'callDesk'`))).orderBy(desc(schema.edgeDocs.createdAt)).limit(40);
  const byId = new Map<number, CommitmentView>();
  const unmapped: CommitmentView[] = [];
  const withdrawnAfter: string[] = [];
  for (const d of docs) {
    if (!(await canRead(userId, d))) continue;
    if (d.desk?.withdrawn && d.desk.said) withdrawnAfter.push(d.desk.said);
    for (const k of d.desk?.commitments ?? []) { if (k.id) byId.set(k.id, k); else unmapped.push(k); }
  }
  const list: CommitmentView[] = rows.map((f) => {
    const base = byId.get(f.id);
    const rule = f.rule as Extract<ForecastRule, { type: "xbrl" }>;
    const metric = (base?.metric ?? (Object.entries(CONCEPTS).find(([, v]) => v.concepts.includes(rule.concept))?.[0] as CommitmentView["metric"])) ?? "revenue";
    return {
      ...(base ?? { metric, label: METRIC_LABEL[metric], low: rule.op === "<=" ? null : rule.value, high: rule.op === ">=" ? null : rule.op === "<=" ? rule.value : rule.high ?? rule.value, unit: rule.unit === "USD/shares" ? "usd_per_share" : "usd", op: rule.op, period: null, quote: f.question, mapped: true, why: "mapped to XBRL" }),
      id: f.id, p: f.probability, closesAt: f.closesAt.toISOString(), said: base?.said ?? f.opensAt.toISOString().slice(0, 10), concept: rule.concept, ...(status.get(f.id) ?? { status: "open" as const }),
    };
  });
  // A later statement of the same metric and period supersedes an open earlier one: raised or lowered.
  for (const a of list) {
    if (a.status !== "open") continue;
    const later = list.filter((b) => b !== a && b.metric === a.metric && b.concept === a.concept && b.closesAt === a.closesAt && (b.said ?? "") > (a.said ?? ""));
    const next = later.sort((x, y) => (x.said ?? "").localeCompare(y.said ?? ""))[0];
    if (next) { const mid = (x: CommitmentView) => ((x.low ?? x.high ?? 0) + (x.high ?? x.low ?? 0)) / 2; a.status = mid(next) > mid(a) ? "raised" : mid(next) < mid(a) ? "lowered" : a.status; }
    if (withdrawnAfter.some((d) => d > (a.said ?? ""))) a.status = "withdrawn";
  }
  const settled = list.filter((r) => r.status === "hit" || r.status === "missed_low" || r.status === "missed_high");
  const hits = settled.filter((r) => r.status === "hit").length, n = settled.length;
  const ci = n ? jeffreys(hits, n, 0.9) : null;
  const text = n ? `${hits} of ${n} settled promises hit their range (${Math.round((hits / n) * 100)}%; 90% interval ${Math.round(ci![0] * 100)}% to ${Math.round(ci![1] * 100)}%).` : "No promise has settled yet: each is settled from XBRL when the 10-Q or 10-K for its period is filed.";
  return { ticker: c.ticker, name: c.name, rows: [...list, ...unmapped.slice(0, 30)], hitRate: { hits, n, rate: n ? hits / n : null, low: ci?.[0] ?? null, high: ci?.[1] ?? null, text } };
}

/* ---------------- Cards ---------------- */

async function insertCard(v: { key: string; kind: string; title: string; summary: string; why: string; confidence: number; magnitude: number; ticker: string; visual: Record<string, unknown>; observedAt: string; ownerId: string | null; source: { name: string; url: string; license: string; method: string; version: string } }): Promise<number | null> {
  const [row] = await requireDb().insert(schema.edgeDetections).values({
    key: v.key.slice(0, 200), kind: v.kind, module: "signals", title: v.title.slice(0, 200), summary: v.summary.slice(0, 1200), why: v.why.slice(0, 1200), confidence: Math.max(0, Math.min(1, v.confidence)), magnitude: Math.max(0, Math.min(1, v.magnitude)),
    tickers: v.ticker ? [v.ticker] : [], bbox: null, visual: v.visual, observedAt: new Date(`${v.observedAt.slice(0, 10)}T00:00:00Z`), ...(v.ownerId ? { ownerId: v.ownerId } : {}),
  }).onConflictDoNothing().returning({ id: schema.edgeDetections.id });
  if (!row) return null;
  await record(`detection:${row.id}`, [{ sourceName: v.source.name, sourceUrl: v.source.url, license: v.source.license, method: v.source.method.slice(0, 300), modelVersion: v.source.version, retrievedAt: new Date() }]);
  return row.id;
}

async function evasionCard(v: CallView, ownerId: string | null): Promise<number | null> {
  if (!v.summary || !v.comparison) return null;
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  return insertCard({
    key: `call_evasion:${v.docId}`, kind: "call_evasion", title: `${v.name || v.ticker}'s call: more answers did not address the question asked (${pct(v.comparison.before.mean)} → ${pct(v.summary.mean)})`,
    summary: `${v.comparison.sentence} Most avoided: ${v.avoided.slice(0, 3).map((a) => a.topic).join(", ") || "no single topic"}. ${DISCLAIMER}`,
    why: `Each analyst question was paired with management's answer and scored direct, intermediate or fully evasive by ${v.engine} (calibrated on Edge's labelled pairs). The call's rate is a Beta-binomial posterior; Edge says "rose" only at a probability of 0.9 or more against the last ${v.comparison.calls} call${v.comparison.calls === 1 ? "" : "s"}.`,
    confidence: v.comparison.prob, magnitude: Math.min(1, Math.max(0, (v.summary.mean - v.comparison.before.mean) * 3)), ticker: v.ticker, observedAt: v.said, ownerId,
    visual: { type: "call_evasion", ticker: v.ticker, name: v.name, docId: v.docId, rate: { mean: v.summary.mean, low: v.summary.low, high: v.summary.high }, before: v.comparison.before.mean, prob: v.comparison.prob, calls: v.comparison.calls, topics: v.avoided.slice(0, 4), quote: v.pairs.find((p) => p.cls === "evasive" && p.quote)?.quote ?? "", version: v.classifier.version, disclaimer: DISCLAIMER },
    source: { name: v.title, url: v.url, license: "Public filing or your document", method: "Q&A pairs scored by the free evasion classifier; Beta-binomial posterior against earlier calls", version: v.classifier.version },
  });
}

/**
 * The daily pass (free): filed earnings releases and transcripts of watched companies read for Call Desk
 * (commitments, and Q&A when it is a transcript); cards for promises whose period ends within 30 days and for
 * promises the resolver settled. Returns the new cards' ids.
 */
export async function callsDaily(deadline: number): Promise<{ read: number; due: number; results: number; created: number[] }> {
  const db = requireDb();
  const created: number[] = [];
  let read = 0;
  // Filed releases and transcripts (8-K Item 2.02 or 7.01 exhibits) of watched companies, a few a day.
  const watched = await db.selectDistinct({ ticker: sql<string>`${schema.edgeWatches.target}->>'ticker'` }).from(schema.edgeWatches)
    .innerJoin(schema.profiles, eq(schema.profiles.userId, schema.edgeWatches.userId)).where(and(BETA_ON, eq(schema.edgeWatches.kind, "company"))).limit(200);
  for (const { ticker } of watched) {
    if (!ticker || Date.now() > deadline - 40_000 || read >= 4) break;
    try {
      const r = await indexFilings(ticker, ["8-K"], 1, Math.min(deadline - 30_000, Date.now() + 40_000));
      if (!r.docIds.length) continue;
      const docs = await db.select({ id: schema.edgeDocs.id, meta: schema.edgeDocs.meta }).from(schema.edgeDocs).where(inArray(schema.edgeDocs.id, r.docIds));
      for (const d of docs) {
        const m = d.meta as Meta & { items?: string };
        if (m.callDesk || !/2\.02|7\.01/.test(m.items ?? "") || Date.now() > deadline - 30_000) continue;
        const v = await readCall(null, d.id).catch((e) => { logError(e, { where: "edge-calls-daily" }); return null; });
        if (v) read++;
      }
    } catch (e) { logError(e, { where: "edge-calls-daily-filings" }); }
  }
  // Promises whose period ends within 30 days (shared ones), each carded once.
  const soon = await db.select().from(schema.edgeForecasts).where(and(eq(schema.edgeForecasts.kind, "guidance"), isNull(schema.edgeForecasts.ownerId), isNull(schema.edgeForecasts.resolvedAt), sql`(${schema.edgeForecasts.rule}->>'period')::date between current_date and current_date + 30`)).limit(50);
  let due = 0;
  for (const f of soon) {
    if (Date.now() > deadline) break;
    const t = tickerOf(f);
    const rule = f.rule as Extract<ForecastRule, { type: "xbrl" }>;
    const id = await insertCard({
      key: `commitment_due:${f.subject}`, kind: "commitment_due", title: `Due within 30 days: ${f.question}`, ticker: t,
      summary: `The period this promise covers ends ${rule.period}; the ledger settles it from XBRL when the filing for it lands. Probability it hits, from the company's record: ${Math.round(f.probability * 100)}%.`,
      why: "Call Desk logs each quantified forward statement as a question with a machine-checkable rule (XBRL concept, period, range) and settles it automatically.",
      confidence: 0.9, magnitude: 0.3, observedAt: new Date().toISOString(), ownerId: null,
      visual: { type: "commitment_due", ticker: t, question: f.question, period: rule.period, concept: rule.concept, low: rule.op === "<=" ? null : rule.value, high: rule.op === ">=" ? null : rule.op === "<=" ? rule.value : rule.high ?? rule.value, unit: rule.unit ?? "USD", p: f.probability, forecastId: f.id },
      source: { name: "Edge forecast ledger (Call Desk commitments)", url: "", license: "YouBank", method: "a commitment read from the company's own release or call", version: f.modelVersion },
    }).catch(() => null);
    if (id) { due++; created.push(id); }
  }
  // Promises the resolver settled in the last three days.
  const settled = await db.select().from(schema.edgeForecasts).where(and(eq(schema.edgeForecasts.kind, "guidance"), isNull(schema.edgeForecasts.ownerId), gte(schema.edgeForecasts.resolvedAt, new Date(Date.now() - 3 * DAY)), isNotNull(schema.edgeForecasts.outcome))).limit(100);
  let results = 0;
  for (const f of settled) {
    if (Date.now() > deadline) break;
    const reported = reportedFrom(f.resolutionSource);
    if (reported === null || f.rule.type !== "xbrl") continue;
    const o = outcomeOf(f.rule, reported);
    const t = tickerOf(f);
    const words = o.status === "hit" ? "hit its range" : o.status === "missed_low" ? `missed below the range by ${(o.missPct * 100).toFixed(1)}%` : `came in above the range by ${(o.missPct * 100).toFixed(1)}%`;
    const id = await insertCard({
      key: `guidance_result:${f.subject}`, kind: "guidance_result", title: `${f.question}: ${words}`, ticker: t,
      summary: `Reported: ${fmtVal(reported, f.rule.unit)}. ${f.resolutionSource}. Edge gave it ${Math.round(f.probability * 100)}% of hitting when it was said; the Track record scores these.`,
      why: "The ledger settled this promise from the company's XBRL facts for the period (as first reported), against the range it stated.",
      confidence: 0.95, magnitude: o.status === "hit" ? 0.3 : Math.min(1, 0.4 + o.missPct * 4), observedAt: (f.resolvedAt ?? new Date()).toISOString(), ownerId: null,
      visual: { type: "guidance_result", ticker: t, question: f.question, reported, status: o.status, missPct: o.missPct, p: f.probability, forecastId: f.id, concept: f.rule.concept, period: f.rule.period },
      source: { name: "SEC XBRL company facts", url: `https://data.sec.gov/api/xbrl/companyfacts/CIK${f.rule.cik.padStart(10, "0")}.json`, license: "Public filing (SEC EDGAR)", method: f.resolutionSource, version: f.modelVersion },
    }).catch(() => null);
    if (id) { results++; created.push(id); }
  }
  return { read, due, results, created };
}

const fmtVal = (v: number, unit?: string) => (unit === "USD/shares" ? `$${v.toFixed(2)}` : Math.abs(v) >= 1e9 ? `$${(v / 1e9).toFixed(2)}bn` : `$${(v / 1e6).toFixed(0)}m`);

/** The ticker in a guidance question ("Acme (ACME) reports ..."). */
function tickerOf(f: { question: string }): string {
  return /\(([A-Z][A-Z0-9.\-]{0,9})\)/.exec(f.question)?.[1] ?? "";
}

