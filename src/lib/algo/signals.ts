/**
 * The algo engine's side of the Quant contract (src/lib/quant/contracts.ts, spec in docs/quant-edge.md
 * section 5). The types are Quant's and are not redefined here; this module reads and adapts them:
 * - `QuantSignal` → a score and a confidence the strategies can rank on (`signalValue`);
 * - the timing rules (5.3, rule 1): a signal is used only from `asOf` and traded no earlier than the next
 *   session open after it; a target no earlier than `rebalance.notBefore`; live strategies drop a signal
 *   after `validUntil` (rule 2) and backtests keep the same rule, so the two agree;
 * - `TargetPortfolio` → weights by symbol, checked against the strategy's own limits (`targetWeights`);
 * - `RiskBudget` → the engine's risk limits, tightened and never loosened (rule 4, `tightenWithBudget`);
 * - the engine's own indicator readings are emitted as `QuantSignal`s too (producer "algo.<rule>"), so a
 *   decision's audit trail reads the same whoever produced its inputs.
 *
 * The functions Quant builds on its branch (`signalsAsOf`, `latestSignals`, `logTrial`, `estimateCost`,
 * `integrityCheck`, and the risk budget) reach the engine through the small ports below. Until both
 * branches merge they have local or no-op defaults; after the merge one call (`wireQuant`) plugs them in.
 * Pure apart from the ports, safe on the client.
 */
import { z } from "zod";
import { newYorkParts, nextTradingDay } from "@/lib/copytrade/markethours";
import { CONTRACT_VERSION, type CostEstimate, type Fill, type Instrument, type IntegrityReport, type QuantSignal, type RiskBudget, type TargetPortfolio } from "@/lib/quant/contracts";
import type { RiskLimits } from "./strategy";

export { CONTRACT_VERSION };
export type { CostEstimate, Fill, Instrument, IntegrityReport, QuantSignal, RiskBudget, TargetPortfolio };

/** The engine's own decision: weights by symbol, and why. (Quant's `TargetPortfolio` is its input; this is its output.) */
export type EngineTarget = { asOf: string; weights: Record<string, number>; rationale: string; signalIds: string[] };

/* ---------------- Time ---------------- */

/** The UTC instant of a New York wall-clock time on a date (daylight saving through the platform's time zone data). */
export function nyInstant(date: string, hh: number, mm: number): string {
  for (const off of [4, 5]) {
    const t = new Date(Date.parse(`${date}T${String(hh + off).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00Z`));
    const p = newYorkParts(t);
    if (p.date === date && p.minutes === hh * 60 + mm) return t.toISOString();
  }
  return new Date(Date.parse(`${date}T${String(hh + 5).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00Z`)).toISOString();
}
export const openInstant = (date: string) => nyInstant(date, 9, 30);
export const closeInstant = (date: string) => nyInstant(date, 16, 0);

/** The first regular-session open strictly after an instant (5.3 rule 1). */
export function sessionOpenAfter(iso: string): string {
  const at = new Date(iso);
  const { date, minutes } = newYorkParts(at);
  const today = nextTradingDay(date, true);
  if (today === date && minutes < 9 * 60 + 30) return openInstant(date);
  return openInstant(nextTradingDay(date, false));
}

/** Whether a signal may drive an order that executes at `execAt` (backtests: the next open; live: now). */
export function usable(s: Pick<QuantSignal, "asOf" | "validUntil">, execAt: string, opts: { crypto?: boolean } = {}): boolean {
  if (!(s.asOf <= execAt)) return false;
  if (s.validUntil && execAt >= s.validUntil) return false;
  return opts.crypto ? true : sessionOpenAfter(s.asOf) <= execAt;
}

/** The signals usable at `execAt`: the latest per producer and instrument. */
export function pointInTime(signals: QuantSignal[], execAt: string, opts: { crypto?: boolean } = {}): QuantSignal[] {
  const latest = new Map<string, QuantSignal>();
  for (const s of signals) {
    if (!usable(s, execAt, opts)) continue;
    const k = `${s.producer}|${s.instrument.symbol}`;
    const prev = latest.get(k);
    if (!prev || s.asOf > prev.asOf) latest.set(k, s);
  }
  return [...latest.values()];
}

/* ---------------- Reading a signal ---------------- */

const clip = (x: number, a = 3) => Math.max(-a, Math.min(a, x));

/**
 * One number per signal on the score scale (a z-score in [-3, 3]) and a confidence in [0, 1]:
 * - score: as given;
 * - expected_return: the mean over its interval's half-width in standard errors (mean / ((high − low) / 2 / z));
 * - probability: the gap over the base rate in base-rate standard deviations;
 * - event: the base rate's average abnormal return over its interval, as for an expected return.
 * Confidence comes from the calibration actually measured: none → 0.3, otherwise rising with the number of
 * resolved examples, and halved for a producer whose integrity grade is D or F.
 */
export function signalValue(s: QuantSignal): { value: number; confidence: number } {
  const zOf = (level: number) => (level >= 0.95 ? 1.96 : level >= 0.9 ? 1.645 : 1);
  let v = 0;
  if (s.kind === "score" && typeof s.score === "number") v = s.score;
  else if (s.kind === "expected_return" && s.expectedReturn) { const e = s.expectedReturn; const se = (e.high - e.low) / 2 / zOf(e.level); v = se > 0 ? e.mean / se : Math.sign(e.mean); }
  else if (s.kind === "probability" && s.probability) { const p = s.probability; const sd = Math.sqrt(Math.max(1e-6, p.baseRate * (1 - p.baseRate))); v = (p.p - p.baseRate) / sd; }
  else if (s.kind === "event" && s.event) { const b = s.event.baseRate; const se = (b.high - b.low) / 2 / 1.96; v = se > 0 ? b.car / se : Math.sign(b.car); }
  const c = s.calibration;
  let confidence = c.method === "none" ? 0.3 : Math.min(1, 0.4 + 0.6 * Math.min(1, c.n / 1000));
  if (s.integrity && (s.integrity.grade === "D" || s.integrity.grade === "F")) confidence /= 2;
  return { value: clip(Number.isFinite(v) ? v : 0), confidence: Math.round(confidence * 1000) / 1000 };
}

const InstrumentZ = z.object({ symbol: z.string().regex(/^[A-Z0-9][A-Z0-9.\-/]{0,20}$/), assetClass: z.enum(["equity", "etf", "option", "crypto", "future", "fx"]), currency: z.string().min(3).max(3) }).passthrough();
const SignalZ = z.object({
  contract: z.literal(CONTRACT_VERSION), id: z.string().min(1), producer: z.string().min(1), producerVersion: z.string(), instrument: InstrumentZ,
  asOf: z.string().min(10), computedAt: z.string().min(10), reconstructed: z.boolean(), validUntil: z.string().min(10), horizonDays: z.number().int().min(1),
  kind: z.enum(["score", "expected_return", "probability", "event"]), universe: z.string(), explain: z.string(), evidence: z.array(z.any()), calibration: z.object({ method: z.string(), n: z.number() }).passthrough(),
}).passthrough();

/** A signal checked against the contract (version, required fields, a value for its kind), or the reason it was refused. */
export function checkSignal(raw: unknown): { ok: true; signal: QuantSignal } | { ok: false; reason: string } {
  const p = SignalZ.safeParse(raw);
  if (!p.success) return { ok: false, reason: p.error.issues.slice(0, 3).map((i) => `${i.path.join(".") || "signal"}: ${i.message}`).join("; ") };
  const s = p.data as unknown as QuantSignal;
  const has = s.kind === "score" ? typeof s.score === "number" : s.kind === "expected_return" ? !!s.expectedReturn : s.kind === "probability" ? !!s.probability : !!s.event;
  return has ? { ok: true, signal: s } : { ok: false, reason: `A ${s.kind} signal without its ${s.kind} value.` };
}

/** One score per symbol: the confidence-weighted mean of its signals' values. */
export function combineSignals(signals: QuantSignal[], minConfidence = 0): Record<string, { score: number; confidence: number; n: number }> {
  const acc = new Map<string, { s: number; w: number; n: number; c: number }>();
  for (const x of signals) {
    const { value, confidence } = signalValue(x);
    if (confidence < minConfidence) continue;
    const a = acc.get(x.instrument.symbol) ?? { s: 0, w: 0, n: 0, c: 0 };
    a.s += value * confidence; a.w += confidence; a.n++; a.c = Math.max(a.c, confidence);
    acc.set(x.instrument.symbol, a);
  }
  return Object.fromEntries([...acc].filter(([, a]) => a.w > 0).map(([k, a]) => [k, { score: a.s / a.w, confidence: a.c, n: a.n }]));
}

/** Scores to long-only weights: the `topN` best positive scores, equal or proportional, each capped (the rest stays in cash). */
export function scoresToWeights(scores: Record<string, { score: number }>, opts: { topN: number; maxWeight: number; method?: "equal" | "proportional" }): Record<string, number> {
  const ranked = Object.entries(scores).filter(([, v]) => v.score > 0).sort((a, b) => b[1].score - a[1].score || (a[0] < b[0] ? -1 : 1)).slice(0, Math.max(1, opts.topN));
  if (!ranked.length) return {};
  const total = ranked.reduce((s, [, v]) => s + v.score, 0);
  return Object.fromEntries(ranked.map(([k, v]) => [k, Math.min(opts.maxWeight, opts.method === "proportional" ? v.score / total : 1 / ranked.length)]));
}

/* ---------------- Targets ---------------- */

/**
 * A Quant target as weights the engine can trade at `execAt`, or why not: wrong contract, not yet tradable
 * (`notBefore`), expired (`validUntil`), shorts in a long-only strategy, gross over the limit. Symbols on the
 * target's excluded list are dropped. The strategy's own sizing and risk limits still apply afterwards.
 */
export function targetWeights(t: TargetPortfolio, execAt: string, opts: { allowShort: boolean; maxGross: number }): { ok: true; weights: Record<string, number>; rationale: string } | { ok: false; reason: string } {
  if (t.contract !== CONTRACT_VERSION) return { ok: false, reason: `Target ${t.key} uses contract ${String(t.contract)}; this engine reads ${CONTRACT_VERSION}.` };
  if (execAt < t.rebalance.notBefore) return { ok: false, reason: `Target ${t.key} v${t.version} may not be traded before ${t.rebalance.notBefore}.` };
  if (t.validUntil && execAt >= t.validUntil) return { ok: false, reason: `Target ${t.key} v${t.version} expired at ${t.validUntil}.` };
  const excluded = new Set(t.constraints.excluded.map((s) => s.toUpperCase()));
  const w: Record<string, number> = {};
  for (const x of t.weights) { const k = x.instrument.symbol.toUpperCase(); if (!excluded.has(k) && Math.abs(x.weight) > 1e-9) w[k] = (w[k] ?? 0) + x.weight; }
  if (!opts.allowShort && Object.values(w).some((v) => v < 0)) return { ok: false, reason: `Target ${t.key} has short positions; this strategy is long-only.` };
  const gross = Object.values(w).reduce((s, v) => s + Math.abs(v), 0);
  if (gross > Math.min(opts.maxGross, t.constraints.maxGross) + 1e-6) return { ok: false, reason: `Target ${t.key}'s gross exposure ${(gross * 100).toFixed(0)}% is over the limit.` };
  return { ok: true, weights: w, rationale: `${t.name} (${t.producer} ${t.producerVersion}, v${t.version}, as of ${t.asOf}): ${t.weights.length} positions, ${(t.cashWeight * 100).toFixed(0)}% cash.` };
}

/** The version of a target in force at `execAt`: the latest whose notBefore has passed and that has not expired. */
export function targetAt(versions: TargetPortfolio[], execAt: string): TargetPortfolio | null {
  return versions.filter((t) => t.rebalance.notBefore <= execAt && t.asOf <= execAt && (!t.validUntil || execAt < t.validUntil)).sort((a, b) => b.version - a.version || (a.asOf < b.asOf ? 1 : -1))[0] ?? null;
}

/* ---------------- Risk budgets (rule 4) ---------------- */

/** The strategy's limits after adopting a Quant risk budget: each limit can only go down. */
export function tightenWithBudget(limits: RiskLimits, b: RiskBudget | null): { limits: RiskLimits; changed: string[] } {
  if (!b) return { limits, changed: [] };
  const out = { ...limits };
  const changed: string[] = [];
  const lower = (k: "maxPositionPct" | "maxGross" | "dailyLossPct" | "maxDrawdownPct", v: number | null | undefined) => {
    if (typeof v === "number" && Number.isFinite(v) && v > 0 && v < out[k]) { out[k] = v; changed.push(k); }
  };
  lower("maxPositionPct", b.maxPositionWeight);
  lower("maxGross", b.maxGross);
  lower("dailyLossPct", b.maxDailyLossPct);
  const stop = b.drawdownRules.filter((r) => r.action === "flatten" || r.action === "pause_new").map((r) => r.fromPeakPct);
  if (stop.length) lower("maxDrawdownPct", Math.min(...stop));
  if (out.maxNet > out.maxGross) out.maxNet = out.maxGross;
  return { limits: out, changed };
}

/** Integrity grades that need a typed, logged override before a strategy may trade live (5.3 rule 6). */
export const needsGradeOverride = (r: IntegrityReport | null | undefined) => !!r && (r.grade === "D" || r.grade === "F");
export const gradeOverridePhrase = (r: IntegrityReport) => `OVERRIDE GRADE ${r.grade}`;

/* ---------------- The engine's own signals, in the contract's shape ---------------- */

export function engineSignal(o: { rule: string; strategy: string; symbol: string; asOf: string; value: number; horizonDays: number; explain: string; backtest: boolean; crypto?: boolean }): QuantSignal {
  const validUntil = new Date(Date.parse(o.asOf) + Math.ceil(o.horizonDays * 7 / 5) * 86_400_000).toISOString();
  return {
    contract: CONTRACT_VERSION, id: `algo.${o.rule}:${o.symbol}:${o.asOf}`, producer: `algo.${o.rule}`, producerVersion: "1",
    instrument: { symbol: o.symbol, assetClass: o.crypto ? "crypto" : "equity", currency: "USD" },
    asOf: o.asOf, computedAt: o.asOf, reconstructed: o.backtest, validUntil, horizonDays: o.horizonDays, kind: "score", score: clip(Math.round(o.value * 1e4) / 1e4),
    universe: `strategy:${o.strategy}`, explain: o.explain, evidence: [], calibration: { method: "none", n: 0 },
  };
}

/** A fill as Quant's cost and slippage work (Q5) reads it. */
export const contractFill = (f: { accountRef: string; broker: string; extId: string; symbol: string; side: "buy" | "sell"; qty: number; price: number; executedAt: string; placedAt?: string; orderType?: "market" | "limit"; limitPrice?: number | null; fees?: number }): Fill =>
  ({ source: "algo", accountRef: f.accountRef, broker: f.broker, extId: f.extId, symbol: f.symbol, side: f.side, qty: f.qty, price: f.price, executedAt: f.executedAt, placedAt: f.placedAt, orderType: f.orderType, limitPrice: f.limitPrice ?? undefined, fees: f.fees });

/* ---------------- Ports to Quant's functions ---------------- */

export type SignalQuery = { producer: string; symbols: string[]; asOf?: string; from?: string };
export interface SignalSource { signalsAsOf(q: SignalQuery & { asOf: string; from: string }): Promise<QuantSignal[]>; latestSignals(q: SignalQuery): Promise<QuantSignal[]> }
export interface TargetSource { targetVersions(key: string, from: string, to: string): Promise<TargetPortfolio[]>; latestTarget(key: string): Promise<TargetPortfolio | null> }
export interface TrialLogger { logTrial(t: { family: string; params: Record<string, unknown>; returns: number[] }): Promise<void> }
export interface CostEstimator { estimateCost(i: Instrument, notionalUsd: number): Promise<CostEstimate | null> }
export interface IntegrityChecker { integrityCheck(family: string): Promise<IntegrityReport | null> }
export interface RiskBudgetSource { riskBudget(ownerId: string, accountRef: string | null): Promise<RiskBudget | null> }
export type QuantPorts = { signals: SignalSource; targets: TargetSource; trials: TrialLogger; costs: CostEstimator; integrity: IntegrityChecker; budgets: RiskBudgetSource };

/** Producers installed locally (tests, and any producer living in this app before Quant's store exists). */
const LOCAL = new Map<string, (q: SignalQuery) => Promise<QuantSignal[]>>();
export function registerLocalProducer(id: string, fn: (q: SignalQuery) => Promise<QuantSignal[]>) { LOCAL.set(id, fn); }

const localSignals: SignalSource = {
  async signalsAsOf(q) { const f = LOCAL.get(q.producer); return f ? (await f(q)).filter((s) => s.asOf <= q.asOf && s.asOf >= q.from) : []; },
  async latestSignals(q) { const f = LOCAL.get(q.producer); return f ? f(q) : []; },
};

const ports: QuantPorts = {
  signals: localSignals,
  targets: { async targetVersions() { return []; }, async latestTarget() { return null; } },
  trials: { async logTrial() { /* counted locally in algo_strategies.backtests until Quant's quant_trials is wired */ } },
  costs: { async estimateCost() { return null; } },
  integrity: { async integrityCheck() { return null; } },
  budgets: { async riskBudget() { return null; } },
};

/** Plug in Quant's implementations after the merge: wireQuant({ signals: { signalsAsOf, latestSignals }, trials: { logTrial }, ... }). */
export function wireQuant(p: Partial<QuantPorts>): void { Object.assign(ports, p); }
export const quant = (): Readonly<QuantPorts> => ports;

/** Read a producer's signals for a strategy and keep only the ones that pass the contract checks. */
export async function readSignals(q: SignalQuery & { live: boolean; asOf: string; from: string }): Promise<{ signals: QuantSignal[]; refused: string[] }> {
  let raw: QuantSignal[];
  try { raw = q.live ? await ports.signals.latestSignals(q) : await ports.signals.signalsAsOf(q); } catch { return { signals: [], refused: [`The signal store did not answer for ${q.producer}.`] }; }
  const signals: QuantSignal[] = [], refused: string[] = [];
  for (const r of raw.slice(0, 5000)) { const c = checkSignal(r); if (c.ok) signals.push(c.signal); else if (refused.length < 10) refused.push(c.reason); }
  return { signals, refused };
}
