/**
 * QF1 adapters from Edge:
 * - `edge.pulse`: a Pulse change point (a hiring, attention or patent finding whose BOCPD change probability is
 *   at least 0.9) becomes an `event` QuantSignal, with the detector's placebo false-alarm rate in its
 *   calibration. It is published only once QF5 has a base rate for that kind of finding (rule 4).
 * - `edge.odds`: a Deal Radar probability becomes a `probability` QuantSignal: P(announces a sale within 12
 *   months), with its Venn-Abers interval and base rate. It is an estimate about a corporate event, not about
 *   returns, and the signal says so. Its forecast is already in the ledger (kind deal_target), so the signal
 *   carries that forecast's id instead of logging it again.
 */
import { and, desc, eq, gte, inArray, isNull, isNotNull, sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { siteLink } from "@/lib/site";
import { CONTRACT_VERSION, type QuantSignal } from "../contracts";
import { baseRateFor, CATALOG, signalBaseRate } from "../events/rates";
import { addSessions, nextOpenAfter } from "../pit/calendar";
import { publishSignals, type PublishResult } from "../signals";
import { signalId } from "../validate";
import { T } from "../words";

export const PULSE_VERSION = "2026-10-15.1";
export const ODDS_VERSION = "2026-10-15.1";

const FAMILY: Record<string, string> = { hiring_shift: "jobs", attention_spike: "attention", patent_shift: "patents" };
const METRIC_LABEL: Record<string, string> = { "jobs.open": "Open job postings", "wiki.views": "Wikipedia page views", "patents.grants": "Patent grants" };
const sym = (t: string) => t.toUpperCase().replace(/\./g, "-");

type Detection = typeof schema.edgeDetections.$inferSelect;

/** A Pulse finding as a signal, or null when it is not a change point or has no base rate yet. Pure. */
export function pulseSignal(d: Pick<Detection, "id" | "kind" | "title" | "tickers" | "visual" | "observedAt" | "detectedAt">, baseRate: ReturnType<typeof signalBaseRate>, falseAlarmPerYear: number | null, now = new Date()): QuantSignal | null {
  const v = d.visual as { prob?: number; metric?: string; ticker?: string };
  const ticker = (v.ticker || d.tickers[0] || "").trim();
  if (!ticker || !(Number(v.prob) >= 0.9) || !FAMILY[d.kind] || !baseRate) return null;
  const asOf = d.detectedAt.toISOString();
  const def = CATALOG[d.kind];
  const base = {
    contract: CONTRACT_VERSION, producer: "edge.pulse", producerVersion: PULSE_VERSION,
    instrument: { symbol: sym(ticker), assetClass: "equity" as const, currency: "USD" },
    asOf, horizonDays: def.horizonDays,
  };
  return {
    ...base, id: signalId(base), computedAt: now.toISOString(), reconstructed: false,
    validUntil: new Date(Date.parse(addSessions(nextOpenAfter(asOf).slice(0, 10), def.horizonDays)) + 86_400_000).toISOString(),
    kind: "event",
    event: { type: d.kind, occurredAt: (d.observedAt ?? d.detectedAt).toISOString(), baseRate },
    universe: "us-edge-pulse",
    explain: T.pulseChange(METRIC_LABEL[v.metric ?? ""] ?? "The series", Number(v.prob), falseAlarmPerYear),
    evidence: [{ label: d.title, url: siteLink(`/app/edge?view=pulse&ticker=${encodeURIComponent(ticker)}`), source: "YouBank Edge Pulse", licence: "YouBank derived data from public sources", knownAt: asOf, retrievedAt: now.toISOString() }],
    calibration: { method: "event-study", n: baseRate.n, falseAlarmRate: falseAlarmPerYear, trackKind: "quant_event" },
    tags: ["edge", "pulse", d.kind],
  };
}

/** Publish signals for the last 30 days of Pulse change points. */
export async function publishPulseSignals(): Promise<PublishResult & { candidates: number; pending: string[] }> {
  const db = requireDb();
  const since = new Date(Date.now() - 30 * 86_400_000);
  const rows = await db.select().from(schema.edgeDetections).where(and(inArray(schema.edgeDetections.kind, Object.keys(FAMILY)), gte(schema.edgeDetections.detectedAt, since), isNull(schema.edgeDetections.ownerId), sql`(${schema.edgeDetections.visual}->>'prob')::float >= 0.9`)).orderBy(desc(schema.edgeDetections.detectedAt)).limit(500);
  const [placebo] = await db.select().from(schema.edgeJobState).where(eq(schema.edgeJobState.name, "pulse.placebo"));
  const fa = (placebo?.state ?? {}) as Record<string, { perYear?: number }>;
  const rates = new Map<string, ReturnType<typeof signalBaseRate>>();
  for (const k of Object.keys(FAMILY)) rates.set(k, signalBaseRate(await baseRateFor(k)));
  const signals = rows.map((d) => pulseSignal(d, rates.get(d.kind) ?? null, fa[FAMILY[d.kind]]?.perYear ?? null)).filter((s): s is QuantSignal => !!s);
  const res = await publishSignals(signals);
  return { ...res, candidates: rows.length, pending: [...rates].filter(([, r]) => !r).map(([k]) => k) };
}

/** A Deal Radar forecast as a probability signal. Pure. */
export function oddsSignal(f: { id: number; probability: number; low: number | null; high: number | null; baseRate: number | null; question: string; createdAt: Date; closesAt: Date; modelVersion: string }, node: { ticker: string; cik: string; name: string }, track: { n: number; skill: number | null }, now = new Date()): QuantSignal | null {
  if (!node.ticker) return null;
  const asOf = f.createdAt.toISOString();
  const base = { contract: CONTRACT_VERSION, producer: "edge.odds", producerVersion: `${ODDS_VERSION}+${f.modelVersion}`, instrument: { symbol: sym(node.ticker), assetClass: "equity" as const, currency: "USD", ...(node.cik ? { cik: String(Number(node.cik)) } : {}) }, asOf, horizonDays: 252 };
  const low = f.low ?? f.probability, high = f.high ?? f.probability, br = f.baseRate ?? 0;
  return {
    ...base, id: signalId(base), computedAt: now.toISOString(), reconstructed: false,
    // Re-scored weekly: valid for eight days, so a stale estimate drops out of live reads.
    validUntil: new Date(Math.min(f.closesAt.getTime(), Date.parse(asOf) + 8 * 86_400_000)).toISOString(),
    kind: "probability",
    probability: { p: f.probability, low: Math.min(low, f.probability), high: Math.max(high, f.probability), baseRate: br, question: f.question },
    universe: "us-deal-radar",
    explain: T.saleOdds(f.probability, Math.min(low, f.probability), Math.max(high, f.probability), br),
    evidence: [{ label: `Deal Radar: ${node.name}`, url: siteLink(`/app/edge?view=radar&ticker=${encodeURIComponent(node.ticker)}`), source: "YouBank Deal Radar (SEC filings)", licence: "YouBank derived data from public filings", knownAt: asOf, retrievedAt: now.toISOString() }],
    calibration: { method: "venn-abers", n: track.n, brierSkill: track.skill, trackKind: "deal_target" },
    forecastId: f.id, tags: ["edge", "odds", "not-a-return-forecast"],
  };
}

/** Publish the latest Deal Radar estimate for each company scored in the last eight days. */
export async function publishOddsSignals(limit = 1_000): Promise<PublishResult & { candidates: number }> {
  const db = requireDb();
  const since = new Date(Date.now() - 8 * 86_400_000);
  const rows = await db.selectDistinctOn([schema.edgeForecasts.subject], {
    id: schema.edgeForecasts.id, subject: schema.edgeForecasts.subject, probability: schema.edgeForecasts.probability, low: schema.edgeForecasts.low, high: schema.edgeForecasts.high,
    baseRate: schema.edgeForecasts.baseRate, question: schema.edgeForecasts.question, createdAt: schema.edgeForecasts.createdAt, closesAt: schema.edgeForecasts.closesAt, modelVersion: schema.edgeForecasts.modelVersion,
  }).from(schema.edgeForecasts).where(and(eq(schema.edgeForecasts.kind, "deal_target"), isNull(schema.edgeForecasts.ownerId), isNull(schema.edgeForecasts.resolvedAt), gte(schema.edgeForecasts.createdAt, since)))
    .orderBy(schema.edgeForecasts.subject, desc(schema.edgeForecasts.createdAt)).limit(limit);
  const ids = rows.map((r) => Number(/^node:(\d+)$/.exec(r.subject)?.[1])).filter(Number.isFinite);
  const nodes = ids.length ? await db.select({ id: schema.edgeNodes.id, ticker: schema.edgeNodes.ticker, cik: schema.edgeNodes.cik, name: schema.edgeNodes.name }).from(schema.edgeNodes).where(inArray(schema.edgeNodes.id, ids)) : [];
  const byId = new Map(nodes.map((n) => [`node:${n.id}`, n]));
  const [t] = (await db.select({ n: sql<number>`count(*)::int` }).from(schema.edgeForecasts).where(and(eq(schema.edgeForecasts.kind, "deal_target"), isNull(schema.edgeForecasts.ownerId), isNotNull(schema.edgeForecasts.outcome))));
  const signals = rows.map((r) => { const n = byId.get(r.subject); return n ? oddsSignal(r, n, { n: Number(t?.n ?? 0), skill: null }) : null; }).filter((s): s is QuantSignal => !!s);
  return { ...(await publishSignals(signals)), candidates: rows.length };
}
