/**
 * QF1: the signal store. Producers publish QuantSignals here; the algo engine reads them.
 *
 *   publishSignals(signals, { rules? })   validate, upsert by id, log probabilities to the forecast ledger,
 *                                         emit quant/signals.published
 *   signalsAsOf({ producers, symbols, at }) the only reader a backtest may use: signals with as_of <= at and
 *                                         valid_until > at, newest per (producer, symbol). No look-ahead.
 *   latestSignals({ producers, symbols })  the live read (signalsAsOf at now)
 *
 * `pickAsOf` is the same rule as a pure function, so scripts/test-quant.ts can prove it never returns a signal
 * from after `at` (a property test over random timestamps).
 */
import { and, desc, gt, inArray, lte, sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import type { ForecastRule } from "@/db/schema";
import { logForecast } from "@/lib/edge/forecasts/ledger";
import type { QuantSignal } from "./contracts";
import { emit, QUANT_EVENTS } from "./jobs";
import { normSymbol, validateSignal } from "./validate";

export type SignalQuery = { producers?: string[]; symbols?: string[]; at?: Date | string; limit?: number };

type Row = { id: string; producer: string; symbol: string; asOf: string | Date; validUntil: string | Date; computedAt: string | Date };

/** Newest valid signal per (producer, symbol) at `at`: as_of <= at < valid_until. Pure. */
export function pickAsOf<T extends Row>(rows: T[], at: Date | string, filter: { producers?: string[]; symbols?: string[] } = {}): T[] {
  const t = new Date(at).getTime();
  const ps = filter.producers?.length ? new Set(filter.producers) : null;
  const ss = filter.symbols?.length ? new Set(filter.symbols.map(normSymbol)) : null;
  const best = new Map<string, T>();
  for (const r of rows) {
    if (ps && !ps.has(r.producer)) continue;
    if (ss && !ss.has(normSymbol(r.symbol))) continue;
    const a = new Date(r.asOf).getTime(), v = new Date(r.validUntil).getTime();
    if (!(a <= t && v > t)) continue;
    const k = `${r.producer}|${normSymbol(r.symbol)}`, cur = best.get(k);
    if (!cur || a > new Date(cur.asOf).getTime() || (a === new Date(cur.asOf).getTime() && new Date(r.computedAt).getTime() > new Date(cur.computedAt).getTime())) best.set(k, r);
  }
  return [...best.values()];
}

export type PublishResult = { stored: number; rejected: { id: string; errors: string[] }[]; forecasts: number; event: boolean };

/**
 * Validate and store signals. A probability signal is logged to the forecast ledger (kind quant_signal) when
 * the producer gives a machine-checkable rule for it in `rules` and it has no forecastId yet; producers whose
 * probability is already in the ledger (Deal Radar) pass the forecastId instead.
 */
export async function publishSignals(signals: QuantSignal[], opts: { rules?: Record<string, ForecastRule>; closesAt?: Record<string, Date>; emitEvent?: boolean } = {}): Promise<PublishResult> {
  const db = requireDb();
  const rejected: PublishResult["rejected"] = [];
  const good: QuantSignal[] = [];
  for (const s of signals) {
    const v = validateSignal(s);
    if (v.ok) good.push(s); else rejected.push({ id: String((s as { id?: unknown })?.id ?? ""), errors: v.errors });
  }
  let forecasts = 0;
  // One at a time: the pool is small and producers publish in modest batches (a slice of a nightly pass).
  for (const s of good) {
    let forecastId = s.forecastId ?? null;
    const rule = opts.rules?.[s.id];
    if (s.kind === "probability" && s.probability && forecastId === null && rule) {
      const closes = opts.closesAt?.[s.id] ?? new Date(s.validUntil);
      const f = await logForecast({
        kind: "quant_signal", subject: `quant:${s.producer}:${normSymbol(s.instrument.symbol)}`, question: s.probability.question, probability: s.probability.p,
        low: s.probability.low, high: s.probability.high, baseRate: s.probability.baseRate, opensAt: new Date(s.asOf), closesAt: closes, rule,
        model: s.producer, modelVersion: s.producerVersion,
      });
      forecastId = f.id;
      if (f.logged) forecasts++;
    }
    const body = { ...s, forecastId } as unknown as Record<string, unknown>;
    await db.insert(schema.quantSignals).values({
      id: s.id, producer: s.producer, producerVersion: s.producerVersion, symbol: normSymbol(s.instrument.symbol), cik: s.instrument.cik ?? null,
      assetClass: s.instrument.assetClass, asOf: new Date(s.asOf), computedAt: new Date(s.computedAt), reconstructed: s.reconstructed,
      validUntil: new Date(s.validUntil), horizonDays: s.horizonDays, body, forecastId,
    }).onConflictDoUpdate({ target: schema.quantSignals.id, set: { body, computedAt: new Date(s.computedAt), validUntil: new Date(s.validUntil), forecastId } });
  }
  let event = false;
  if (good.length && opts.emitEvent !== false) event = (await emit(QUANT_EVENTS.signalsPublished, { ids: good.map((s) => s.id).slice(0, 500), producers: [...new Set(good.map((s) => s.producer))] })).sent;
  return { stored: good.length, rejected, forecasts, event };
}

/** Signals usable at `at`: the backtest reader. Bounded by `limit` (5,000 by default). */
export async function signalsAsOf(q: SignalQuery): Promise<QuantSignal[]> {
  const at = q.at ? new Date(q.at) : new Date();
  if (!Number.isFinite(at.getTime())) throw Object.assign(new Error("`at` is not a time"), { status: 400 });
  const limit = Math.min(Math.max(q.limit ?? 5_000, 1), 20_000);
  const where = and(
    lte(schema.quantSignals.asOf, at), gt(schema.quantSignals.validUntil, at),
    q.producers?.length ? inArray(schema.quantSignals.producer, q.producers.slice(0, 50)) : undefined,
    q.symbols?.length ? inArray(schema.quantSignals.symbol, q.symbols.slice(0, 2_000).map(normSymbol)) : undefined,
  );
  // DISTINCT ON keeps the newest per (producer, symbol); the pure pickAsOf states the same rule.
  const rows = await requireDb().selectDistinctOn([schema.quantSignals.producer, schema.quantSignals.symbol], { body: schema.quantSignals.body })
    .from(schema.quantSignals).where(where)
    .orderBy(schema.quantSignals.producer, schema.quantSignals.symbol, desc(schema.quantSignals.asOf), desc(schema.quantSignals.computedAt))
    .limit(limit);
  return rows.map((r) => r.body as unknown as QuantSignal);
}

/** The live read: signals valid now. */
export const latestSignals = (q: Omit<SignalQuery, "at">) => signalsAsOf({ ...q, at: new Date() });

/** Signals about one symbol over time (newest first), for a company page or the INSC history. */
export async function signalHistory(symbol: string, producers?: string[], limit = 100): Promise<QuantSignal[]> {
  const rows = await requireDb().select({ body: schema.quantSignals.body }).from(schema.quantSignals)
    .where(and(sql`${schema.quantSignals.symbol} = ${normSymbol(symbol)}`, producers?.length ? inArray(schema.quantSignals.producer, producers) : undefined))
    .orderBy(desc(schema.quantSignals.asOf)).limit(Math.min(limit, 500));
  return rows.map((r) => r.body as unknown as QuantSignal);
}

/** Producers and how many signals each has live now, for the hub's Signals tab. */
export async function producerSummary(): Promise<{ producer: string; live: number; latest: string | null }[]> {
  const now = new Date();
  const rows = (await requireDb().execute(sql`select producer, count(*) filter (where as_of <= ${now} and valid_until > ${now})::int as live, max(as_of) as latest from quant_signals group by producer order by producer`)).rows as { producer: string; live: number; latest: Date | string | null }[];
  return rows.map((r) => ({ producer: r.producer, live: Number(r.live), latest: r.latest ? new Date(r.latest).toISOString() : null }));
}
