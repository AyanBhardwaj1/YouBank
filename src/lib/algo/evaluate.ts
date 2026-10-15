/**
 * The strategy engine's decision: from a strategy and the prices known at a point in time, the target
 * portfolio, the signals behind it and a plain-language reason. Pure. Backtests call it day by day; live
 * and paper ticks call it once with today's history; the agent calls it to explain a trade. One function,
 * so what a backtest did is what the live strategy does.
 *
 * Point in time by construction: `decide` cuts every series at index `t` before anything reads it, so no
 * indicator can see a later price (scripts/test-algo.ts changes the future and checks nothing moves).
 */
import { covariance, engleGranger, momentum, portfolioVol, realizedVol, rsi, sma, zscore } from "./indicators";
import { closeInstant, combineSignals, engineSignal, scoresToWeights, signalValue, type EngineTarget, type QuantSignal } from "./signals";
import { warmupDays, type StrategySpec } from "./strategy";

/** Days of history each decision reads. */
export const historyWindow = (spec: StrategySpec) => Math.max(300, warmupDays(spec) * 2);

/** Daily closes aligned to `dates` (oldest first), forward-filled; NaN before a symbol's first price. */
export type Panel = { dates: string[]; closes: Record<string, number[]> };

/** What a strategy remembers between decisions (entries and exits that depend on where it was). */
export type EvalState = {
  /** Mean reversion: symbols currently held. */
  held?: string[];
  /** Pairs: +1 long the spread (long a, short b), −1 short it, 0 flat. */
  pairSide?: number;
};

export type OptionLeg = { kind: "call" | "put"; action: "sell_to_open"; underlying: string; strikeDelta: number; dte: number; ivPremium: number; contracts: number };

export type Decision = {
  target: EngineTarget;
  /** The engine's readings as contract signals (producer "algo.<rule>"), plus any Quant signals used. */
  signals: QuantSignal[];
  state: EvalState;
  /** Explanations of each step, for the audit log and "why did you buy X". */
  notes: string[];
  /** For options income: the option to sell this period. */
  option: OptionLeg | null;
  /** False when there is not enough history yet. */
  ready: boolean;
};

export type DecideContext = {
  state?: EvalState;
  /** Point-in-time 13F weights for copy13f strategies (the caller looks them up as of the date). */
  copyWeights?: Record<string, number> | null;
  /** Quant signals already filtered to the ones usable at this decision's execution time (signals.ts, pointInTime). */
  external?: { signals: QuantSignal[]; refused?: string[] } | null;
  /** A Quant target already read as weights (signals.ts, targetWeights), or why it cannot be used. */
  target?: { weights: Record<string, number>; rationale: string } | { reason: string } | null;
  /** Backtests mark their signals as reconstructed. */
  backtest?: boolean;
  /** The strategy's equity, for option contract counts. */
  equity?: number;
};

const r4 = (x: number) => Math.round(x * 1e4) / 1e4;
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

export function decide(spec: StrategySpec, panel: Panel, t: number, ctx: DecideContext = {}): Decision {
  const asOf = panel.dates[t];
  // Only the window the indicators need (twice the warm-up, at least 300 days): fast in day-by-day
  // backtests, and identical in live ticks, which pass the same window.
  const window = historyWindow(spec);
  const hist = (s: string) => (panel.closes[s] ?? []).slice(Math.max(0, t + 1 - window), t + 1).filter((v) => Number.isFinite(v) && v > 0);
  const notes: string[] = [];
  const signals: QuantSignal[] = [];
  const at = /T/.test(asOf) ? asOf : closeInstant(asOf);
  const state: EvalState = { held: [...(ctx.state?.held ?? [])], pairSide: ctx.state?.pairSide ?? 0 };
  // The engine's readings in the contract's shape: factual, no "buy" or "sell" (contract rule 5).
  const sig = (symbol: string, value: number, horizonDays: number, _confidence: number, meta: Record<string, number | string | boolean | null>) =>
    signals.push(engineSignal({ rule: spec.signal.type, strategy: spec.name, symbol, asOf: at, value, horizonDays, backtest: !!ctx.backtest, crypto: spec.assetClass === "crypto", explain: `${spec.signal.type} reading for ${symbol}: ${Object.entries(meta).map(([k, v]) => `${k} ${typeof v === "number" ? r4(v) : v}`).join(", ")}.` }));
  let raw: Record<string, number> = {};
  let option: OptionLeg | null = null;
  const rule = spec.signal;
  const n = spec.universe.length;

  switch (rule.type) {
    case "trend": {
      for (const s of spec.universe) {
        const x = hist(s);
        if (x.length < rule.slow) { notes.push(`${s}: ${x.length} of the ${rule.slow} days needed for its ${rule.slow}-day average.`); continue; }
        const f = sma(x, rule.fast).at(-1)!, sl = sma(x, rule.slow).at(-1)!;
        const gap = f / sl - 1;
        sig(s, gap / Math.max(0.01, (realizedVol(x) || 0.2) / Math.sqrt(12)), 21, Math.min(1, Math.abs(gap) * 10), { fast: r4(f), slow: r4(sl), gap: r4(gap) });
        if (f > sl) raw[s] = 1 / n;
        notes.push(`${s}: ${rule.fast}-day average ${f.toFixed(2)} ${f > sl ? "above" : "below"} the ${rule.slow}-day ${sl.toFixed(2)} (${gap >= 0 ? "+" : ""}${pct(gap)}): ${f > sl ? "in trend, hold" : "out of trend, cash"}.`);
      }
      break;
    }
    case "momentum": {
      const m = spec.universe.map((s) => ({ s, m: momentum(hist(s), rule.lookback, rule.skip) })).filter((x) => Number.isFinite(x.m));
      if (m.length < Math.min(n, rule.top)) notes.push(`Only ${m.length} of ${n} symbols have ${rule.lookback} days of history.`);
      m.sort((a, b) => b.m - a.m || (a.s < b.s ? -1 : 1));
      for (const [i, x] of m.entries()) sig(x.s, x.m / 0.2, rule.lookback - rule.skip, Math.min(1, 0.4 + Math.abs(x.m)), { momentum: r4(x.m), rank: i + 1 });
      const picks = m.slice(0, rule.top).filter((x) => !rule.absolute || x.m > 0);
      for (const x of picks) raw[x.s] = 1 / rule.top;
      notes.push(`Ranked by return from ${rule.lookback} to ${rule.skip} days ago: ${m.map((x) => `${x.s} ${pct(x.m)}`).join(", ") || "none yet"}. Holding ${picks.map((x) => x.s).join(", ") || "nothing"}${rule.absolute ? " (only positive momentum qualifies; the rest stays in cash)" : ""}.`);
      break;
    }
    case "meanReversion": {
      const held = new Set(state.held);
      for (const s of spec.universe) {
        const x = hist(s);
        if (x.length < Math.max(rule.lookback + 1, rule.trendFilter)) { notes.push(`${s}: not enough history yet.`); continue; }
        const v = rule.indicator === "rsi" ? rsi(x, rule.lookback).at(-1)! : zscore(x, rule.lookback).at(-1)!;
        const trendOk = rule.trendFilter === 0 || x.at(-1)! > sma(x, rule.trendFilter).at(-1)!;
        const name = rule.indicator === "rsi" ? `RSI(${rule.lookback})` : `z(${rule.lookback})`;
        sig(s, rule.indicator === "rsi" ? (50 - v) / 20 : -v, 5, trendOk ? 0.6 : 0.3, { [rule.indicator]: r4(v), trendOk });
        if (!held.has(s) && v < rule.entry && trendOk) { held.add(s); notes.push(`${s}: ${name} ${v.toFixed(1)} under ${rule.entry}${rule.trendFilter ? ` and above its ${rule.trendFilter}-day average` : ""}: buy the dip.`); }
        else if (held.has(s) && (v > rule.exit || !trendOk)) { held.delete(s); notes.push(`${s}: ${name} ${v.toFixed(1)}${!trendOk ? ", and the trend filter failed" : ` above ${rule.exit}`}: exit.`); }
        else notes.push(`${s}: ${name} ${v.toFixed(1)}; ${held.has(s) ? "holding until it recovers" : "no entry"}.`);
      }
      state.held = [...held].sort();
      for (const s of state.held) raw[s] = 1 / n;
      break;
    }
    case "pairs": {
      const a = hist(rule.a), b = hist(rule.b);
      const len = Math.min(a.length, b.length, rule.lookback);
      if (len < rule.lookback) { notes.push(`The pair needs ${rule.lookback} days of both prices; ${len} so far.`); break; }
      const eg = engleGranger(a.slice(-len), b.slice(-len));
      const ok = eg.cointegrated[rule.requireCointegration] && eg.halfLife <= rule.maxHalfLife;
      sig(rule.a, -eg.z, Math.max(1, Math.round(eg.halfLife)), ok ? 0.6 : 0.2, { z: r4(eg.z), hedge: r4(eg.hedge), adf: r4(eg.adf), halfLife: Number.isFinite(eg.halfLife) ? r4(eg.halfLife) : null });
      let side = state.pairSide ?? 0;
      if (side === 0 && ok && Math.abs(eg.z) >= rule.entryZ) side = eg.z > 0 ? -1 : 1;
      else if (side !== 0 && (Math.abs(eg.z) <= rule.exitZ || Math.sign(eg.z) === side)) side = 0;
      state.pairSide = side;
      const wa = 1 / (1 + Math.abs(eg.hedge)), wb = Math.abs(eg.hedge) / (1 + Math.abs(eg.hedge));
      if (side === 1) { raw[rule.a] = wa; if (spec.risk.allowShort) raw[rule.b] = -wb; }
      if (side === -1) { if (spec.risk.allowShort) raw[rule.a] = -wa; raw[rule.b] = wb; }
      notes.push(`Spread log ${rule.a} − ${eg.hedge.toFixed(2)}·log ${rule.b}: z ${eg.z.toFixed(2)}, ADF ${eg.adf.toFixed(2)} (needs under ${rule.requireCointegration === "1%" ? "−3.90" : rule.requireCointegration === "5%" ? "−3.34" : "−3.04"} to call it cointegrated), half-life ${Number.isFinite(eg.halfLife) ? `${eg.halfLife.toFixed(0)} days` : "none (not reverting)"}. ${side === 0 ? "Flat." : side === 1 ? `Long ${rule.a}${spec.risk.allowShort ? `, short ${rule.b}` : " (long leg only)"}.` : `${spec.risk.allowShort ? `Short ${rule.a}, ` : ""}long ${rule.b}${spec.risk.allowShort ? "" : " (long leg only)"}.`}${!ok ? " The test does not pass now, so no new entry." : ""}`);
      break;
    }
    case "rebalance": {
      const sum = Object.values(rule.weights).reduce((s, v) => s + v, 0);
      raw = Object.fromEntries(Object.entries(rule.weights).filter(([, v]) => v > 0).map(([k, v]) => [k, sum > 1 ? v / sum : v]));
      notes.push(`Fixed mix: ${Object.entries(raw).map(([k, v]) => `${k} ${pct(v)}`).join(", ")}.`);
      break;
    }
    case "copy13f": {
      const w = ctx.copyWeights ?? null;
      if (!w || !Object.keys(w).length) { notes.push("No 13F holdings were public for this fund as of this date."); break; }
      const top = Object.entries(w).sort((x, y) => y[1] - x[1]).slice(0, rule.top);
      const tot = top.reduce((s, [, v]) => s + v, 0);
      raw = Object.fromEntries(top.map(([k, v]) => [k, v / tot]));
      for (const [k, v] of top) sig(k, 1, 63, 0.5, { weight13f: r4(v) });
      notes.push(`The fund's latest public 13F: top ${top.length} positions, rescaled to 100%.`);
      break;
    }
    case "income": {
      const x = hist(rule.underlying);
      if (x.length < 64) { notes.push(`${rule.underlying}: needs 63 days of history for its volatility.`); break; }
      const vol = realizedVol(x, 63) * (1 + rule.ivPremium);
      const px = x.at(-1)!;
      const contracts = Math.floor((ctx.equity ?? spec.capitalUsd) / (px * 100));
      if (rule.kind === "covered_call") raw[rule.underlying] = contracts > 0 ? Math.min(1, (contracts * 100 * px) / (ctx.equity ?? spec.capitalUsd)) : 0;
      if (contracts > 0) option = { kind: rule.kind === "covered_call" ? "call" : "put", action: "sell_to_open", underlying: rule.underlying, strikeDelta: rule.delta, dte: rule.dte, ivPremium: rule.ivPremium, contracts };
      notes.push(contracts > 0
        ? `${rule.kind === "covered_call" ? `Hold ${contracts * 100} ${rule.underlying} and sell ${contracts} call${contracts === 1 ? "" : "s"}` : `Hold cash for ${contracts * 100} ${rule.underlying} and sell ${contracts} put${contracts === 1 ? "" : "s"}`} near ${rule.delta.toFixed(2)} delta, ${rule.dte} days out, priced at ${pct(vol)} volatility (realised ${pct(vol / (1 + rule.ivPremium))} plus a ${pct(rule.ivPremium)} premium; a model, not quotes).`
        : `The capital does not cover 100 shares of ${rule.underlying} at ${px.toFixed(2)}, so no contract can be written.`);
      break;
    }
    case "external": {
      const ext = ctx.external;
      for (const r of ext?.refused ?? []) notes.push(`Signal refused: ${r}`);
      const usable = (ext?.signals ?? []).filter((s) => spec.universe.includes(s.instrument.symbol) && s.producer === rule.producer);
      signals.push(...usable);
      const scores = combineSignals(usable, rule.minConfidence);
      raw = scoresToWeights(scores, { topN: rule.topN, maxWeight: spec.sizing.maxWeight, method: "equal" });
      for (const x of usable.filter((u) => raw[u.instrument.symbol])) notes.push(`${x.instrument.symbol}: ${x.explain} (score ${signalValue(x).value.toFixed(2)}).`);
      notes.push(usable.length ? `${usable.length} current signal${usable.length === 1 ? "" : "s"} from ${rule.producer}; holding the top ${Object.keys(raw).length} with a positive score at confidence ${rule.minConfidence} or more.` : `No current signals from ${rule.producer}: holding cash.`);
      break;
    }
    case "target": {
      const tg = ctx.target;
      if (!tg) { notes.push(`No version of target ${rule.key} is tradable as of this date.`); break; }
      if ("reason" in tg) { notes.push(tg.reason); break; }
      raw = { ...tg.weights };
      notes.push(tg.rationale);
      break;
    }
  }

  const ready = !notes.some((x) => /not enough history|days needed|days of history|needs \d+ days/.test(x)) || Object.keys(raw).length > 0;
  const sized = size(spec, raw, hist, notes);
  const weights = limit(spec, sized, notes);
  const rationale = notes.join(" ");
  return { target: { asOf, weights, rationale, signalIds: signals.map((s) => s.id) }, signals, state, notes, option, ready };
}

/** Apply the sizing method to raw weights (whose sum is the share of capital the signal wants invested). */
function size(spec: StrategySpec, raw: Record<string, number>, hist: (s: string) => number[], notes: string[]): Record<string, number> {
  const syms = Object.keys(raw).filter((k) => raw[k] !== 0);
  if (!syms.length || spec.sizing.method === "equal" || spec.signal.type === "income") return raw;
  const vols = syms.map((s) => realizedVol(hist(s), spec.sizing.volLookback));
  if (vols.some((v) => !Number.isFinite(v) || v <= 0)) { notes.push("Volatility sizing skipped: not enough history; equal weights used."); return raw; }
  const gross = syms.reduce((s, k) => s + Math.abs(raw[k]), 0);
  const inv = vols.map((v) => 1 / v), invSum = inv.reduce((s, v) => s + v, 0);
  let w = syms.map((k, i) => Math.sign(raw[k]) * (inv[i] / invSum) * gross);
  if (spec.sizing.method === "volTarget") {
    const S = covariance(syms.map(hist), spec.sizing.volLookback);
    const pv = portfolioVol(w, S);
    if (pv > 0) {
      const scale = Math.min(spec.sizing.targetVol / pv, spec.risk.maxGross / Math.max(1e-9, w.reduce((s, x) => s + Math.abs(x), 0)));
      w = w.map((x) => x * scale);
      notes.push(`Volatility target ${pct(spec.sizing.targetVol)}: the mix's recent volatility is ${pct(pv)}, so exposure is scaled by ${scale.toFixed(2)}.`);
    }
  } else notes.push(`Weighted by inverse ${spec.sizing.volLookback}-day volatility (${syms.map((s, i) => `${s} ${pct(vols[i])}`).join(", ")}).`);
  return Object.fromEntries(syms.map((k, i) => [k, w[i]]));
}

/** The strategy's own caps: max weight and position, gross and net exposure. What is cut stays in cash. */
function limit(spec: StrategySpec, w: Record<string, number>, notes: string[]): Record<string, number> {
  const cap = Math.min(spec.sizing.maxWeight, spec.risk.maxPositionPct);
  const out: Record<string, number> = {};
  let clipped = false;
  for (const [k, v] of Object.entries(w)) {
    if (!spec.risk.allowShort && v < 0) continue;
    const c = Math.max(-cap, Math.min(cap, v));
    if (Math.abs(c - v) > 1e-9) clipped = true;
    if (Math.abs(c) > 1e-6) out[k] = c;
  }
  if (clipped) notes.push(`Positions capped at ${pct(cap)} each.`);
  const gross = Object.values(out).reduce((s, v) => s + Math.abs(v), 0);
  if (gross > spec.risk.maxGross + 1e-9) { const f = spec.risk.maxGross / gross; for (const k of Object.keys(out)) out[k] *= f; notes.push(`Gross exposure scaled to the ${pct(spec.risk.maxGross)} limit.`); }
  const net = Object.values(out).reduce((s, v) => s + v, 0);
  if (net > spec.risk.maxNet + 1e-9 && net > 0) { const f = spec.risk.maxNet / net; for (const k of Object.keys(out)) if (out[k] > 0) out[k] *= f; notes.push(`Net exposure scaled to the ${pct(spec.risk.maxNet)} limit.`); }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, r4(v)]).filter(([, v]) => v !== 0));
}

/** Whether a target differs from current weights by more than the drift band anywhere. */
export function needsTrade(target: Record<string, number>, current: Record<string, number>, drift: number): boolean {
  const keys = new Set([...Object.keys(target), ...Object.keys(current)]);
  for (const k of keys) {
    const a = target[k] ?? 0, b = current[k] ?? 0;
    if ((a === 0) !== (Math.abs(b) < 1e-6)) return true; // entering or leaving a position always trades
    if (Math.abs(a - b) > drift) return true;
  }
  return false;
}

/* ---------------- The schedule ---------------- */

const isoWeek = (d: string) => {
  const t = new Date(`${d}T00:00:00Z`);
  const day = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - day + 3);
  const first = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  return `${t.getUTCFullYear()}-${1 + Math.round(((t.getTime() - first.getTime()) / 86_400_000 - 3 + ((first.getUTCDay() + 6) % 7)) / 7)}`;
};

/**
 * Whether `date` is a decision day: every day for daily and intraday strategies, the last trading day of
 * each week or month otherwise. `next` is the next trading day (the exchange calendar is known ahead).
 */
export function isDecisionDay(every: StrategySpec["rebalance"]["every"], date: string, next: string | null): boolean {
  if (every === "daily" || every === "intraday") return true;
  if (!next) return true;
  return every === "weekly" ? isoWeek(date) !== isoWeek(next) : date.slice(0, 7) !== next.slice(0, 7);
}

/** Build a panel from per-symbol closes on a calendar, forward-filling gaps (a missing day keeps the last close). */
export function panelOf(calendar: string[], prices: Record<string, { date: string; close: number }[]>): Panel {
  const closes: Record<string, number[]> = {};
  for (const [s, xs] of Object.entries(prices)) {
    const m = new Map(xs.filter((x) => x.close > 0).map((x) => [x.date, x.close]));
    let last = NaN;
    closes[s] = calendar.map((d) => { const v = m.get(d); if (v !== undefined) last = v; return last; });
  }
  return { dates: calendar, closes };
}
