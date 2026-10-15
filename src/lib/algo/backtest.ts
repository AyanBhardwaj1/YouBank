/**
 * The backtester: event-driven, day by day, point in time. Pure: prices come in, results go out, and
 * scripts/test-algo.ts checks it on paths whose answers are known.
 *
 * How a day goes:
 * 1. Orders decided yesterday fill at today's open (or, without opens, today's close: never yesterday's),
 *    at a price moved against us by the spread and market impact, less commissions and fees (costs.ts).
 * 2. The book is marked at today's close; contributions (DCA) arrive as cash and are taken out of returns
 *    (time-weighted), so adding money is not counted as performance.
 * 3. Risk: below `maxDrawdownPct` from the peak the strategy's kill switch trips, it sells everything at
 *    the next open and stays in cash (as live trading would); past the daily loss limit it adds no risk
 *    the next day. Position, gross and net limits are applied by the decision itself (evaluate.ts).
 * 4. On decision days, `decide` sees closes up to today only and sets tomorrow's orders, if any weight
 *    moved past the drift band.
 * Options income: on decision days a call (covered) or put (cash-secured) is sold at a Black–Scholes price
 * on realised volatility plus a premium, marked daily and settled at expiry for its intrinsic value.
 *
 * What it does not model: dividends (price returns only, unless adjusted closes are passed), borrow costs
 * and locate availability for shorts, intraday paths (stops), partial fills, taxes, and the per-order and
 * per-day notional limits and throttles (live-only rules in risk.ts). It cannot see survivorship: a
 * universe picked today was, by definition, still listed today.
 */
import { kurtosis, mean, skew, std } from "@/lib/edge/scen/stats";
import { bsPrice, fillCost, monthlyExpiry, strikeForDelta, US_EQUITY, type CostModel } from "./costs";
import { decide, isDecisionDay, needsTrade, type EvalState, type Panel } from "./evaluate";
import { realizedVol } from "./indicators";
import { beta, bootstrap, deflatedSharpe, drawdown, overfitWarnings, pbo, PERIODS_PER_YEAR, returnsOf, sharpe, stats, type Point, type Stats } from "./metrics";
import { openInstant, pointInTime, targetAt, targetWeights, type QuantSignal, type TargetPortfolio } from "./signals";
import { HYPOTHETICAL } from "./disclosures";
import { warmupDays, type StrategySpec } from "./strategy";

export { HYPOTHETICAL };


export type BacktestInput = {
  spec: StrategySpec;
  panel: Panel;
  /** Daily opens aligned to the panel; without them fills use the next close. */
  opens?: Record<string, number[]>;
  costs?: CostModel;
  /** First and last index to simulate (decisions need warm-up history before `from`). */
  from?: number;
  to?: number;
  /** 13F weights by filing date: usable from the first close after the date. */
  copyTimeline?: { date: string; weights: Record<string, number> }[];
  /** Quant signals (any time range); each is used only from the first open after its asOf, until validUntil. */
  external?: QuantSignal[];
  /** Versions of a Quant target; each is traded no earlier than its rebalance.notBefore. */
  targets?: TargetPortfolio[];
  /** How many variants were tried before this one (for the deflated Sharpe). */
  trials?: number;
  /** Variance of the Sharpe ratios across those trials (per period); unknown: the estimator's own variance under the null. */
  trialSharpeVar?: number;
  /** Skip the bootstrap (inner loops of walk-forward). */
  fast?: boolean;
};

export type BTrade = { date: string; symbol: string; side: "buy" | "sell"; qty: number; price: number; fees: number; slippage: number; reason: string };
export type BEvent = { date: string; kind: "kill" | "daily-loss" | "decision" | "option-sold" | "option-settled" | "contribution"; text: string };

export type BacktestResult = {
  from: string; to: string;
  curve: Point[]; benchmark: Point[]; drawdown: Point[]; exposure: Point[];
  stats: Stats | null; benchmarkStats: Stats | null;
  beta: number | null; excessCagr: number | null; informationRatio: number | null;
  turnover: number; costsUsd: number; contributionsUsd: number;
  trades: BTrade[]; tradeCount: number; roundTrips: number; hitRateTrades: number | null;
  events: BEvent[];
  uncertainty: ReturnType<typeof bootstrap>;
  deflated: { dsr: number | null; sr0: number; trials: number };
  warnings: string[];
  assumptions: string[];
  disclosure: string;
  returns: number[];
};

const r2 = (x: number) => Math.round(x * 100) / 100;

export function runBacktest(input: BacktestInput): BacktestResult {
  const { spec, panel } = input;
  const costs = input.costs ?? US_EQUITY;
  const T = panel.dates.length;
  const warm = warmupDays(spec);
  const from = Math.max(input.from ?? warm, 1);
  const to = Math.min(input.to ?? T - 1, T - 1);
  const px = (s: string, t: number) => panel.closes[s]?.[t] ?? NaN;
  const openPx = (s: string, t: number) => { const o = input.opens?.[s]?.[t]; return o && o > 0 ? o : px(s, t); };
  const contribEvery = spec.dca?.every ?? null;

  let cash = spec.capitalUsd;
  const units: Record<string, number> = {};
  const cost: Record<string, number> = {}; // average cost per unit, for round trips
  let state: EvalState = {};
  let pending: { target: Record<string, number>; reason: string } | null = null;
  let killed = false, noRiskTomorrow = false;
  let option: { kind: "call" | "put"; strike: number; expiry: string; contracts: number; vol: number; underlying: string } | null = null;
  const curve: Point[] = [], bench: Point[] = [], expo: Point[] = [];
  const trades: BTrade[] = [], events: BEvent[] = [];
  let index = 100, benchIndex = 100, prevEquity = 0, peak = 0, startDay = 0;
  let costsUsd = 0, traded = 0, contributions = 0, roundTrips = 0, wins = 0, tradeCount = 0;
  const benchSym = spec.benchmark;
  const value = (t: number) => cash + Object.entries(units).reduce((s, [k, u]) => s + u * (Number.isFinite(px(k, t)) ? px(k, t) : 0), 0) - optionValue(t);
  function optionValue(t: number): number {
    if (!option) return 0;
    const S = px(option.underlying, t);
    const Tyrs = Math.max(0, (Date.parse(`${option.expiry}T00:00:00Z`) - Date.parse(`${panel.dates[t]}T00:00:00Z`)) / (365 * 86_400_000));
    return bsPrice(option.kind, S, option.strike, Tyrs, option.vol) * 100 * option.contracts;
  }
  const trade = (t: number, symbol: string, side: "buy" | "sell", qty: number, ref: number, reason: string) => {
    if (!(qty > 1e-9) || !(ref > 0)) return;
    const f = fillCost(side, qty, ref, costs);
    const v = qty * f.price;
    if (side === "buy") {
      cost[symbol] = ((cost[symbol] ?? 0) * Math.max(0, units[symbol] ?? 0) + v) / (Math.max(0, units[symbol] ?? 0) + qty);
      units[symbol] = (units[symbol] ?? 0) + qty; cash -= v + f.fees;
    } else {
      if ((units[symbol] ?? 0) > 1e-9) { roundTrips++; if (f.price > (cost[symbol] ?? f.price)) wins++; }
      units[symbol] = (units[symbol] ?? 0) - qty; cash += v - f.fees;
      if (Math.abs(units[symbol]) < 1e-9) { delete units[symbol]; delete cost[symbol]; }
    }
    costsUsd += f.fees + f.slippageUsd; traded += v; tradeCount++;
    if (trades.length < 2000) trades.push({ date: panel.dates[t], symbol, side, qty: Math.round(qty * 1e4) / 1e4, price: r2(f.price), fees: f.fees, slippage: r2(f.slippageUsd), reason });
  };
  const rebalanceTo = (t: number, target: Record<string, number>, reason: string, mark: number) => {
    const eq = mark;
    const want = Object.fromEntries(Object.entries(target).map(([k, w]) => [k, Number.isFinite(openPx(k, t)) && openPx(k, t) > 0 ? (w * eq) / openPx(k, t) : units[k] ?? 0]));
    const keys = [...new Set([...Object.keys(units), ...Object.keys(want)])];
    // Sells first (they fund the buys).
    for (const k of keys) { const d = (want[k] ?? 0) - (units[k] ?? 0); if (d < -1e-9) trade(t, k, "sell", -d, openPx(k, t), reason); }
    // Buys are paid from cash (long-only books never borrow): each is cut to what the cash buys at its fill price and fees.
    for (const k of keys) {
      let d = (want[k] ?? 0) - (units[k] ?? 0);
      if (!(d > 1e-9) || (noRiskTomorrow && (units[k] ?? 0) >= 0)) continue;
      if (!spec.risk.allowShort) { const f = fillCost("buy", d, openPx(k, t), costs); d = Math.min(d, Math.max(0, cash) / (f.price + f.fees / d)); }
      trade(t, k, "buy", d, openPx(k, t), reason);
    }
  };

  for (let t = from; t <= to; t++) {
    const date = panel.dates[t];
    // 1. Yesterday's orders fill at today's open.
    if (pending) {
      const mark = cash + Object.entries(units).reduce((s, [k, u]) => s + u * (openPx(k, t) || 0), 0) - (option ? optionValue(t) : 0);
      rebalanceTo(t, pending.target, pending.reason, mark);
      pending = null;
    }
    noRiskTomorrow = false;
    // Options expiring today settle for their intrinsic value.
    if (option && date >= option.expiry) {
      const S = px(option.underlying, t);
      const pay = Math.max(0, option.kind === "call" ? S - option.strike : option.strike - S) * 100 * option.contracts;
      cash -= pay;
      events.push({ date, kind: "option-settled", text: `${option.contracts} ${option.underlying} ${option.kind}${option.contracts === 1 ? "" : "s"} at ${option.strike} expired ${pay > 0 ? `in the money: paid $${Math.round(pay).toLocaleString("en-US")}` : "worthless: kept the premium"}.` });
      option = null;
    }
    // 2. Contributions.
    const next = t + 1 < T ? panel.dates[t + 1] : null;
    let flow = 0;
    if (contribEvery && spec.dca && t > from && isDecisionDay(contribEvery, panel.dates[t - 1], date)) { flow = spec.dca.amountUsd; cash += flow; contributions += flow; }
    const eq = value(t);
    if (t === from) { prevEquity = eq; peak = index; startDay = eq; }
    const r = prevEquity > 0 ? (eq - flow) / prevEquity - 1 : 0;
    if (t > from) index *= 1 + r;
    const b0 = px(benchSym, from), bt = px(benchSym, t);
    benchIndex = b0 > 0 && bt > 0 ? (100 * bt) / b0 : benchIndex;
    curve.push({ date, value: index }); bench.push({ date, value: benchIndex });
    const gross = eq > 0 ? Object.entries(units).reduce((s, [k, u]) => s + Math.abs(u * (px(k, t) || 0)), 0) / eq : 0;
    expo.push({ date, value: Math.round(gross * 1000) / 1000 });
    // 3. Risk.
    peak = Math.max(peak, index);
    if (!killed && index / peak - 1 <= -spec.risk.maxDrawdownPct) {
      killed = true;
      events.push({ date, kind: "kill", text: `Drawdown of ${((1 - index / peak) * 100).toFixed(1)}% passed the ${(spec.risk.maxDrawdownPct * 100).toFixed(0)}% limit: kill switch on, sold everything at the next open, stayed in cash.` });
      pending = { target: {}, reason: "kill switch" };
    }
    if (!killed && startDay > 0 && eq / startDay - 1 <= -spec.risk.dailyLossPct) { noRiskTomorrow = true; events.push({ date, kind: "daily-loss", text: `Down ${((1 - eq / startDay) * 100).toFixed(1)}% on the day: no new risk at the next open.` }); }
    // 4. Decide.
    if (!killed && t < to && isDecisionDay(spec.rebalance.every, date, next)) {
      const copyWeights = input.copyTimeline ? [...input.copyTimeline].filter((e) => e.date < date).sort((a, b) => (a.date < b.date ? -1 : 1)).at(-1)?.weights ?? null : null;
      // Orders decided today execute at the next open: that instant is what the contract's timing rules check.
      const execAt = openInstant(next ?? date);
      const external = input.external ? { signals: pointInTime(input.external, execAt, { crypto: spec.assetClass === "crypto" }) } : null;
      let target: { weights: Record<string, number>; rationale: string } | { reason: string } | null = null;
      if (input.targets) {
        const v = targetAt(input.targets, execAt);
        if (v) { const w = targetWeights(v, execAt, { allowShort: spec.risk.allowShort, maxGross: spec.risk.maxGross }); target = w.ok ? { weights: w.weights, rationale: w.rationale } : { reason: w.reason }; }
      }
      const d = decide(spec, panel, t, { state, copyWeights, external, target, equity: eq, backtest: true });
      state = d.state;
      const current = Object.fromEntries(Object.entries(units).map(([k, u]) => [k, eq > 0 ? (u * (px(k, t) || 0)) / eq : 0]));
      if (d.ready && needsTrade(d.target.weights, current, spec.rebalance.drift)) {
        pending = { target: d.target.weights, reason: d.notes.slice(0, 2).join(" ").slice(0, 200) };
        if (events.length < 400) events.push({ date, kind: "decision", text: d.notes.join(" ").slice(0, 400) });
      }
      // Options income: sell the next option once the last one has settled.
      if (d.option && !option) {
        const S = px(d.option.underlying, t);
        const vol = realizedVol(panel.closes[d.option.underlying].slice(Math.max(0, t - 64), t + 1), 63) * (1 + d.option.ivPremium);
        const expiry = monthlyExpiry(date, d.option.dte);
        const Tyrs = (Date.parse(`${expiry}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / (365 * 86_400_000);
        if (S > 0 && vol > 0 && Tyrs > 0) {
          const strike = strikeForDelta(d.option.kind, S, Tyrs, vol, d.option.strikeDelta, S > 200 ? 5 : 1);
          const premium = bsPrice(d.option.kind, S, strike, Tyrs, vol) * 100 * d.option.contracts * (1 - costs.halfSpreadBps / 10_000 * 10);
          const fee = d.option.contracts * costs.optionPerContract;
          cash += premium - fee; costsUsd += fee;
          option = { kind: d.option.kind, strike, expiry, contracts: d.option.contracts, vol, underlying: d.option.underlying };
          events.push({ date, kind: "option-sold", text: `Sold ${d.option.contracts} ${d.option.underlying} ${expiry} ${strike} ${d.option.kind}${d.option.contracts === 1 ? "" : "s"} for about $${Math.round(premium).toLocaleString("en-US")} (model price at ${(vol * 100).toFixed(0)}% volatility).` });
        }
      }
    }
    prevEquity = value(t);
    startDay = prevEquity;
  }

  const rets = returnsOf(curve);
  const st = stats(curve);
  const bst = stats(bench);
  const br = returnsOf(bench);
  const ex = rets.map((x, i) => x - (br[i] ?? 0));
  const te = std(ex) * Math.sqrt(PERIODS_PER_YEAR);
  const trials = Math.max(1, input.trials ?? 1);
  const srp = st?.sharpe != null ? st.sharpe / Math.sqrt(PERIODS_PER_YEAR) : null;
  const varSr = input.trialSharpeVar ?? 1 / Math.max(2, rets.length);
  const ds = srp !== null ? deflatedSharpe(srp, rets.length, skew(rets), kurtosis(rets) + 3, trials, varSr) : null;
  const years = rets.length / PERIODS_PER_YEAR;
  const avgEq = mean(curve.map((p) => p.value)) / 100 * spec.capitalUsd || spec.capitalUsd;
  const dsr = ds && Number.isFinite(ds.dsr) ? ds.dsr : null;
  const res: BacktestResult = {
    from: panel.dates[from], to: panel.dates[to],
    curve, benchmark: bench, drawdown: drawdown(curve).series, exposure: expo,
    stats: st, benchmarkStats: bst,
    beta: beta(rets, br), excessCagr: st && bst ? st.cagr - bst.cagr : null, informationRatio: te > 0 ? (mean(ex) * PERIODS_PER_YEAR) / te : null,
    turnover: years > 0 ? traded / 2 / avgEq / years : 0, costsUsd: r2(costsUsd), contributionsUsd: contributions,
    trades: trades.slice(-500), tradeCount, roundTrips, hitRateTrades: roundTrips ? wins / roundTrips : null,
    events: events.slice(-200),
    uncertainty: input.fast ? null : bootstrap(rets),
    deflated: { dsr, sr0: ds?.sr0 ?? 0, trials },
    warnings: [],
    assumptions: assumptions(spec, costs, !!input.opens),
    disclosure: HYPOTHETICAL,
    returns: rets,
  };
  res.warnings = overfitWarnings({ dsr, trials, pbo: null, days: rets.length, trades: tradeCount });
  if (spec.signal.type === "income") res.warnings.unshift("Option prices here come from a model (Black–Scholes on realised volatility plus a premium), not from historical option quotes: treat the result as a rough sketch.");
  if (spec.risk.allowShort) res.warnings.push("Short positions are simulated without borrow fees or recall risk. Live and paper strategies are long-only.");
  return res;
}

function assumptions(spec: StrategySpec, c: CostModel, opens: boolean): string[] {
  return [
    `Decisions use closes up to the decision day only; orders fill at the next ${opens ? "open" : "close"}.`,
    `Costs: ${c.halfSpreadBps} bp half-spread on every fill${c.commissionBps ? `, ${c.commissionBps} bp commission` : ", no commission"}${c.secFeePerMillion ? `, SEC fee $${c.secFeePerMillion} per $1M sold and FINRA TAF on sells` : ""}${c.optionPerContract && spec.signal.type === "income" ? `, $${c.optionPerContract} per option contract` : ""}.`,
    "Price returns on split-adjusted daily closes; dividends are not reinvested unless the prices include them.",
    `Rebalanced ${spec.rebalance.every} when a weight drifts more than ${(spec.rebalance.drift * 100).toFixed(1)} points; fractional shares.`,
    `Kill switch at a ${(spec.risk.maxDrawdownPct * 100).toFixed(0)}% drawdown, no new risk after a ${(spec.risk.dailyLossPct * 100).toFixed(1)}% daily loss.`,
    "The universe is chosen today, so delisted names are absent (survivorship bias flatters old periods).",
    "Sharpe and Sortino use a 0% risk-free rate; the deflated Sharpe counts the variants tried on this strategy.",
  ];
}

/* ---------------- Walk-forward and variants ---------------- */

/** A small grid of variants around a strategy's settings, for walk-forward selection and the overfitting tests. */
export function variants(spec: StrategySpec): { label: string; spec: StrategySpec }[] {
  const s = spec.signal;
  const out: { label: string; spec: StrategySpec }[] = [];
  const add = (label: string, signal: StrategySpec["signal"]) => out.push({ label, spec: { ...spec, signal } });
  if (s.type === "trend") for (const f of [20, 50, 100]) for (const l of [100, 150, 200]) { if (f < l) add(`MA ${f}/${l}`, { ...s, fast: f, slow: l }); }
  else if (s.type === "momentum") for (const lb of [126, 189, 252]) for (const top of [1, 2, 3]) add(`${lb}d top ${top}`, { ...s, lookback: lb, top: Math.min(top, spec.universe.length) });
  else if (s.type === "meanReversion") for (const e of s.indicator === "rsi" ? [5, 10, 20] : [-1.5, -2, -2.5]) for (const x of s.indicator === "rsi" ? [50, 60, 70] : [-0.5, 0, 0.5]) add(`entry ${e} exit ${x}`, { ...s, entry: e, exit: x });
  else if (s.type === "pairs") for (const z of [1.5, 2, 2.5]) for (const lb of [60, 120, 250]) add(`z ${z}, ${lb}d`, { ...s, entryZ: z, exitZ: Math.min(0.5, z / 3), lookback: lb });
  else out.push({ label: "as set", spec });
  return out.length ? out : [{ label: "as set", spec }];
}

export type WalkForward = {
  folds: { train: [string, string]; test: [string, string]; chosen: string; isSharpe: number | null; oosSharpe: number | null }[];
  oosCurve: Point[];
  oosStats: Stats | null;
  isSharpe: number | null;
  variants: { label: string; sharpe: number | null; cagr: number | null }[];
  pbo: number | null;
  deflated: { dsr: number | null; sr0: number; trials: number; best: string };
  warnings: string[];
};

/**
 * Walk-forward: roll a training window over history; in each, pick the variant with the best Sharpe, then
 * run it on the following test window it never saw. The test windows, stitched, are the out-of-sample
 * record. Across the whole period, every variant's returns feed the probability of backtest overfitting
 * and the deflated Sharpe of the best one (with as many trials as there were variants).
 */
export function walkForward(input: Omit<BacktestInput, "from" | "to" | "fast">, opts: { trainDays?: number; testDays?: number; deadline?: number } = {}): WalkForward | null {
  const T = input.panel.dates.length;
  const warm = warmupDays(input.spec);
  const train = opts.trainDays ?? 504, test = opts.testDays ?? 126;
  if (T < warm + train + test) return null;
  const vs = variants(input.spec);
  const full = vs.map((v) => runBacktest({ ...input, spec: v.spec, fast: true, from: warm }));
  const folds: WalkForward["folds"] = [];
  const oosRets: number[] = [], oosDates: string[] = [];
  const isSharpes: number[] = [];
  for (let s = warm; s + train + test <= T; s += test) {
    if (opts.deadline && Date.now() > opts.deadline) break;
    const trained = vs.map((v) => ({ v, r: runBacktest({ ...input, spec: v.spec, fast: true, from: s, to: s + train - 1 }) }));
    trained.sort((a, b) => (b.r.stats?.sharpe ?? -9) - (a.r.stats?.sharpe ?? -9));
    const best = trained[0];
    const oos = runBacktest({ ...input, spec: best.v.spec, fast: true, from: s + train, to: s + train + test - 1 });
    folds.push({ train: [input.panel.dates[s], input.panel.dates[s + train - 1]], test: [oos.from, oos.to], chosen: best.v.label, isSharpe: best.r.stats?.sharpe ?? null, oosSharpe: oos.stats?.sharpe ?? null });
    if (best.r.stats?.sharpe != null) isSharpes.push(best.r.stats.sharpe);
    oosRets.push(...oos.returns); oosDates.push(...oos.curve.slice(1).map((p) => p.date));
  }
  let v = 100;
  const oosCurve: Point[] = oosDates.length ? [{ date: folds[0]?.test[0] ?? oosDates[0], value: 100 }] : [];
  oosRets.forEach((r, i) => { v *= 1 + r; oosCurve.push({ date: oosDates[i], value: v }); });
  const oosStats = stats(oosCurve);
  const len = Math.min(...full.map((f) => f.returns.length));
  const matrix = full.map((f) => f.returns.slice(-len));
  const pb = pbo(matrix, 8);
  const srs = full.map((f) => (f.stats?.sharpe ?? 0) / Math.sqrt(PERIODS_PER_YEAR));
  const bestIdx = srs.indexOf(Math.max(...srs));
  const br = full[bestIdx].returns;
  const varSr = srs.length > 1 ? std(srs) ** 2 : 1 / Math.max(2, br.length);
  const ds = deflatedSharpe(srs[bestIdx], br.length, skew(br), kurtosis(br) + 3, vs.length, varSr);
  const isSharpe = isSharpes.length ? mean(isSharpes) : null;
  const dsr = Number.isFinite(ds.dsr) ? ds.dsr : null;
  return {
    folds, oosCurve, oosStats, isSharpe,
    variants: vs.map((x, i) => ({ label: x.label, sharpe: full[i].stats?.sharpe ?? null, cagr: full[i].stats?.cagr ?? null })),
    pbo: pb?.pbo ?? null,
    deflated: { dsr, sr0: ds.sr0, trials: vs.length, best: vs[bestIdx].label },
    warnings: overfitWarnings({ dsr, trials: vs.length, pbo: pb?.pbo ?? null, days: oosRets.length, trades: 30, isSharpe, oosSharpe: oosStats?.sharpe ?? null }).filter((w) => !/trades:/.test(w)),
  };
}

/** Thin a curve to at most `max` points for charts (first and last kept). */
export function thinCurve(c: Point[], max = 400): Point[] {
  if (c.length <= max) return c;
  const step = (c.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => c[Math.round(i * step)]);
}

/** Sharpe of a return series, re-exported for callers that only have returns. */
export const sharpeOf = (r: number[]) => sharpe(r);
