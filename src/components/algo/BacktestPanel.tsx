"use client";

/**
 * Backtest results: the hypothetical-performance disclosure first, then the curve against its benchmark
 * (and the walk-forward out-of-sample line), drawdowns, the metrics with their 90% bootstrap intervals,
 * the deflated Sharpe with the number of trials, overfitting warnings, assumptions, events and trades.
 */
import { useState } from "react";
import { LinesChart } from "@/components/copy/charts";
import { Icon } from "@/components/ui/Icon";
import { errorMessage } from "@/lib/client/errors";
import { useAlgoConsent } from "./AlgoConsent";
import { DrawdownChart, Stat } from "./charts";
import { call, json, num, pct, usd } from "./client";

type P = { date: string; value: number };
type Iv = { p05: number; p50: number; p95: number };
type StatsT = { cagr: number; volatility: number; sharpe: number | null; sortino: number | null; maxDrawdown: number; hitRateDays: number; psr: number | null; totalReturn: number; days: number; longestDrawdownDays: number };
export type BacktestView = {
  from: string; to: string; curve: P[]; benchmark: P[]; drawdown: P[]; exposure: P[];
  stats: StatsT | null; benchmarkStats: StatsT | null; beta: number | null; excessCagr: number | null; informationRatio: number | null;
  turnover: number; costsUsd: number; contributionsUsd: number; trades: { date: string; symbol: string; side: string; qty: number; price: number; fees: number; reason: string }[]; tradeCount: number; roundTrips: number; hitRateTrades: number | null;
  events: { date: string; kind: string; text: string }[]; uncertainty: { cagr: Iv; sharpe: Iv; maxDrawdown: Iv; paths: number } | null;
  deflated: { dsr: number | null; sr0: number; trials: number }; warnings: string[]; assumptions: string[]; disclosure: string;
  walkForward: { folds: { train: [string, string]; test: [string, string]; chosen: string; isSharpe: number | null; oosSharpe: number | null }[]; oosCurve: P[]; oosStats: StatsT | null; isSharpe: number | null; variants: { label: string; sharpe: number | null; cagr: number | null }[]; pbo: number | null; deflated: { dsr: number | null; trials: number; best: string } } | null;
  missing: string[]; providers: string[];
};

const iv = (x: Iv | undefined, f: (v: number) => string) => (x ? `90%: ${f(x.p05)} to ${f(x.p95)}` : null);
/** The out-of-sample line starts where the strategy's line stood on its first day, so both share the axis. */
const rebase = (oos: P[], curve: P[]) => { const base = curve.find((c) => c.date >= (oos[0]?.date ?? ""))?.value ?? 100; const o0 = oos[0]?.value || 100; return oos.map((p) => ({ date: p.date, value: (p.value * base) / o0 })); };
const sr = (v: number | null | undefined) => (v === null || v === undefined ? "–" : v.toFixed(2));

export function BacktestPanel({ strategyId, initial }: { strategyId: number; initial?: BacktestView | null }) {
  const ask = useAlgoConsent();
  const [r, setR] = useState<BacktestView | null>(initial ?? null);
  const [years, setYears] = useState(5);
  const [wf, setWf] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    setBusy(true); setError(null);
    try { setR(await call<BacktestView>("/api/algo/backtest", json("POST", { strategyId, years, walkForward: wf }), ask)); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-[11.5px] text-muted">Years<select value={years} onChange={(e) => setYears(Number(e.target.value))} className="ctl ml-2 border border-line bg-panel px-2 py-1.5 text-[12.5px] text-fg">{[1, 3, 5, 10].map((y) => <option key={y} value={y}>{y}</option>)}</select></label>
        <label className="flex items-center gap-1.5 text-[12px] text-fg"><input type="checkbox" checked={wf} onChange={(e) => setWf(e.target.checked)} />Walk-forward and overfitting tests</label>
        <button onClick={run} disabled={busy} className="ctl ml-auto flex items-center gap-1.5 bg-accent px-3 py-2 text-[12.5px] font-semibold text-accent-fg disabled:opacity-60"><Icon name={busy ? "Loader" : "Play"} className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />{busy ? "Running…" : r ? "Run again" : "Run backtest"}</button>
      </div>
      <p className="text-[11px] text-muted">Each run counts as a trial: the more variants you try, the higher the bar the deflated Sharpe sets.</p>
      {error && <p className="rounded-md border border-neg/40 bg-neg/10 p-2.5 text-[12px] text-neg">{error}</p>}
      {r && (
        <>
          <p className="rounded-md border border-line bg-elevated p-2.5 text-[11.5px] leading-relaxed text-muted"><Icon name="Info" className="mr-1 inline h-3.5 w-3.5 text-accent" />{r.disclosure}</p>
          <div className="panel p-3">
            <LinesChart title={`Hypothetical growth of 100, ${r.from} to ${r.to}`} lines={[
              { name: "Strategy", points: r.curve, color: "var(--accent)" },
              { name: "Benchmark", points: r.benchmark, color: "var(--chart-dim)" },
              ...(r.walkForward?.oosCurve.length ? [{ name: "Out of sample", points: rebase(r.walkForward.oosCurve, r.curve), color: "var(--info)", dashed: true }] : []),
            ]} />
          </div>
          <div className="panel p-3"><DrawdownChart points={r.drawdown} title="Drawdown from the running peak" /></div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="CAGR" value={pct(r.stats?.cagr)} interval={iv(r.uncertainty?.cagr, (v) => pct(v))} hint="Bootstrap interval: resampled blocks of the daily returns" />
            <Stat label="Sharpe" value={sr(r.stats?.sharpe)} interval={iv(r.uncertainty?.sharpe, (v) => v.toFixed(2))} />
            <Stat label="Max drawdown" value={pct(r.stats?.maxDrawdown)} interval={iv(r.uncertainty?.maxDrawdown, (v) => pct(v))} />
            <Stat label="Deflated Sharpe" value={r.deflated.dsr === null ? "–" : pct(r.deflated.dsr, 0)} interval={`${r.deflated.trials} trial${r.deflated.trials === 1 ? "" : "s"}`} hint="Probability the true Sharpe beats what the best of this many tries would show by luck (Bailey and López de Prado 2014). Under 95% is consistent with luck." />
            <Stat label="Volatility" value={pct(r.stats?.volatility)} />
            <Stat label="Sortino" value={sr(r.stats?.sortino)} />
            <Stat label="Benchmark CAGR" value={pct(r.benchmarkStats?.cagr)} interval={r.excessCagr !== null ? `excess ${pct(r.excessCagr, 1)}` : null} />
            <Stat label="Beta" value={sr(r.beta)} interval={r.informationRatio !== null ? `IR ${r.informationRatio.toFixed(2)}` : null} />
            <Stat label="Turnover" value={`${(r.turnover * 100).toFixed(0)}%/yr`} />
            <Stat label="Hit rate" value={pct(r.hitRateTrades)} interval={`${r.roundTrips} round trips · days ${pct(r.stats?.hitRateDays, 0)}`} />
            <Stat label="Costs" value={usd(r.costsUsd)} interval={`${num(r.tradeCount)} trades`} />
            <Stat label="P(Sharpe > 0)" value={r.stats?.psr === null || r.stats?.psr === undefined ? "–" : pct(r.stats.psr, 0)} hint="Probabilistic Sharpe ratio: from this record's length, skewness and kurtosis" />
          </div>
          {r.warnings.length > 0 && <ul className="space-y-1 rounded-md border border-neg/40 bg-neg/10 p-2.5 text-[12px] text-fg">{r.warnings.map((w) => <li key={w} className="flex gap-1.5"><Icon name="AlertTriangle" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-neg" />{w}</li>)}</ul>}
          {r.walkForward && (
            <details className="panel p-3" open>
              <summary className="cursor-pointer text-[12.5px] font-semibold text-fg">Walk-forward: {r.walkForward.folds.length} folds · out-of-sample Sharpe {sr(r.walkForward.oosStats?.sharpe)} vs in-sample {sr(r.walkForward.isSharpe)} · PBO {r.walkForward.pbo === null ? "–" : pct(r.walkForward.pbo, 0)}</summary>
              <div className="mt-2 overflow-x-auto"><table className="w-full min-w-[480px] text-[11.5px]"><thead><tr className="text-left text-muted"><th className="py-1">Train</th><th>Test</th><th>Chosen</th><th className="text-right">IS Sharpe</th><th className="text-right">OOS Sharpe</th></tr></thead>
                <tbody>{r.walkForward.folds.map((f) => <tr key={f.test[0]} className="border-t border-line"><td className="py-1">{f.train[0]} – {f.train[1]}</td><td>{f.test[0]} – {f.test[1]}</td><td>{f.chosen}</td><td className="num text-right">{sr(f.isSharpe)}</td><td className="num text-right">{sr(f.oosSharpe)}</td></tr>)}</tbody></table></div>
              <p className="mt-2 text-[11.5px] text-muted">Variants tried: {r.walkForward.variants.map((v) => `${v.label} (Sharpe ${sr(v.sharpe)})`).join(", ")}. The best, {r.walkForward.deflated.best}, has a deflated Sharpe of {r.walkForward.deflated.dsr === null ? "–" : pct(r.walkForward.deflated.dsr, 0)} over {r.walkForward.deflated.trials} trials.</p>
            </details>
          )}
          <details className="panel p-3"><summary className="cursor-pointer text-[12.5px] font-semibold text-fg">Assumptions and data</summary>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-[11.5px] text-muted">{r.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>
            <p className="mt-2 text-[11px] text-muted">Prices: {r.providers.join(", ") || "market data layer"}.{r.missing.length ? ` No prices for ${r.missing.join(", ")} (left out).` : ""}</p>
          </details>
          {r.events.length > 0 && <details className="panel p-3"><summary className="cursor-pointer text-[12.5px] font-semibold text-fg">Events ({r.events.length})</summary><ul className="mt-2 max-h-72 space-y-1 overflow-y-auto text-[11.5px]">{r.events.slice().reverse().map((e, i) => <li key={i} className="border-t border-line pt-1"><span className="num text-muted">{e.date}</span> <span className={e.kind === "kill" ? "font-semibold text-neg" : "text-fg"}>{e.text}</span></li>)}</ul></details>}
          {r.trades.length > 0 && <details className="panel p-3"><summary className="cursor-pointer text-[12.5px] font-semibold text-fg">Last trades</summary><div className="mt-2 overflow-x-auto"><table className="w-full min-w-[420px] text-[11.5px]"><thead><tr className="text-left text-muted"><th className="py-1">Date</th><th>Symbol</th><th>Side</th><th className="text-right">Qty</th><th className="text-right">Price</th><th className="text-right">Fees</th></tr></thead><tbody>{r.trades.slice(-50).reverse().map((t, i) => <tr key={i} className="border-t border-line"><td className="py-1 num">{t.date}</td><td>{t.symbol}</td><td className={t.side === "buy" ? "text-pos" : "text-neg"}>{t.side}</td><td className="num text-right">{num(t.qty, 4)}</td><td className="num text-right">{t.price.toFixed(2)}</td><td className="num text-right">{t.fees.toFixed(2)}</td></tr>)}</tbody></table></div></details>}
        </>
      )}
    </div>
  );
}
