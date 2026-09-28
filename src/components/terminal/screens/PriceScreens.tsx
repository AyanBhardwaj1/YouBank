"use client";

import { useState } from "react";
import type { Command } from "@/lib/functions";
import type { PriceAnalytics } from "@/lib/terminal/price";
import { AiRead, AskAi, BarList, DataTable, fdate, fn, fp, Frame, fsp, Hint, Pill, Ranges, SeriesChart, Section, Tile, Tiles, tone, useTerminal, VolumeBars, Why } from "../kit";

type Props = { ticker: string; onRun?: (c: Command) => void };
const RANGES = ["1M", "3M", "6M", "YTD", "1Y", "2Y", "5Y"] as const;
type Range = (typeof RANGES)[number];

function slice<T extends { date: string }>(points: T[], range: Range): T[] {
  if (!points.length) return points;
  const last = points[points.length - 1].date;
  if (range === "YTD") return points.filter((p) => p.date >= `${last.slice(0, 4)}-01-01`);
  const days = { "1M": 31, "3M": 92, "6M": 183, "1Y": 366, "2Y": 731, "5Y": 1830 }[range];
  const from = new Date(new Date(last + "T00:00:00Z").getTime() - days * 86_400_000).toISOString().slice(0, 10);
  return points.filter((p) => p.date >= from);
}

const usePrice = (ticker: string) => useTerminal<PriceAnalytics>("price", { ticker });
const money = (v: number) => (Math.abs(v) >= 1000 ? v.toFixed(0) : v.toFixed(2));

/** GP: price with its moving averages and volume, the trend and volatility regime, and a GARCH price cone. */
export function GpScreen({ ticker, onRun }: Props) {
  const q = usePrice(ticker);
  const [range, setRange] = useState<Range>("1Y");
  return (
    <Frame q={q} what={`${ticker} prices`}>
      {(d) => {
        const pts = slice(d.points, range);
        const long = pts.length > 200;
        const regimeKind = d.regime.trend === "uptrend" ? "pos" : d.regime.trend === "downtrend" ? "neg" : "muted";
        return (
          <div className="flex flex-col gap-3 p-3">
            <Tiles>
              <Tile label="Last" value={money(d.last)} sub={`${fsp(d.change.d1, 2)} today`} subTone={tone(d.change.d1)} title={`As of ${d.asOf}`} />
              <Tile label="1 month" value={fsp(d.change.m1)} subTone={tone(d.change.m1)} sub={`YTD ${fsp(d.change.ytd)}`} />
              <Tile label="1 year" value={fsp(d.change.y1)} sub={`3 years ${fsp(d.change.y3)}`} />
              <Tile label="52-week range" value={`${money(d.low52)}–${money(d.high52)}`} sub={`${fsp(d.drawdownNow)} from the high`} subTone={tone(d.drawdownNow)} />
              <Tile label="Volatility (20d)" value={fp(d.vol.realized20)} sub={`${Math.round(d.vol.percentile * 100)}th percentile, 5y`} />
              <Tile label="GARCH, next month" value={d.vol.garch ? fp(d.vol.garch.m1) : "—"} sub={d.vol.garch ? `long run ${fp(d.vol.garch.longRun)}` : "not enough history"} />
            </Tiles>
            <div className="flex flex-wrap items-center gap-2">
              <Pill kind={regimeKind}>{d.regime.trend}</Pill>
              <Pill kind={d.regime.vol === "stressed" ? "neg" : d.regime.vol === "calm" ? "pos" : "muted"}>volatility {d.regime.vol}</Pill>
              <span className="text-[11px] text-muted">{d.regime.note}</span>
              <span className="ml-auto flex items-center gap-1.5"><AiRead fn="price" params={{ ticker }} /><AskAi onRun={onRun} ticker={ticker} question={`Walk me through ${ticker}'s price action, trend and volatility regime. What is the market pricing in?`} /></span>
            </div>
            <Hint skill="GP">The blue line is the price, amber the 50-day average and green the 200-day. Above a rising 200-day line is an uptrend. The cone on the right is where the price should stay 80% of the time if volatility follows the GARCH forecast: it widens with time, and faster when volatility is high.</Hint>
            <Section title={`${ticker} price`} right={<Ranges value={range} options={RANGES} onChange={setRange} />}>
              <SeriesChart x={pts.map((p) => p.date)} xLabel={(s) => fdate(s, long)} format={money} height={230}
                lines={[{ name: "Price", values: pts.map((p) => p.close), width: 2 }, { name: "50-day", values: pts.map((p) => p.sma50), color: "var(--chart-emphasis)", width: 1.25 }, { name: "200-day", values: pts.map((p) => p.sma200), color: "var(--pos)", width: 1.25 }]} />
              <VolumeBars values={pts.map((p) => p.volume)} />
            </Section>
            <div className="grid gap-4 @3xl:grid-cols-2">
              <Section title="Price cone (GARCH, 80%)">
                <SeriesChart x={["Now", ...d.cone.map((c) => (c.horizonDays === 5 ? "1W" : c.horizonDays === 21 ? "1M" : c.horizonDays === 63 ? "3M" : c.horizonDays === 126 ? "6M" : "1Y"))]} format={money} height={170}
                  lines={[{ name: "Today's price", values: [d.last, ...d.cone.map((c) => c.p50)], color: "var(--muted)", dashed: true }]}
                  bands={[{ name: "80% range", lo: [d.last, ...d.cone.map((c) => c.p10)], hi: [d.last, ...d.cone.map((c) => c.p90)], opacity: 0.22 }]} />
              </Section>
              <Section title="Against the S&P 500, one year">
                <SeriesChart x={d.relative.map((r) => r.date)} xLabel={(s) => fdate(s, true)} format={(v) => fsp(v, 0)} height={170} zero
                  lines={[{ name: ticker, values: d.relative.map((r) => r.stock) }, { name: "S&P 500", values: d.relative.map((r) => r.index), color: "var(--muted)" }]} />
              </Section>
            </div>
            <Why items={[
              ["Trend", "Price against the 200-day average and the slope of the 50-day over the last month."],
              ["Volatility regime", "Today's 20-day realized volatility ranked against every 20-day window in the last five years: calm below the 30th percentile, stressed above the 80th."],
              ["GARCH(1,1)", <>Fitted to up to 1,000 daily log returns with variance targeting (the long-run variance is pinned to the sample&apos;s, so only the persistence is estimated). Persistence {d.vol.garch ? fn(d.vol.garch.persistence, 3) : "n/a"}: close to 1 means shocks fade slowly.</>],
              ["Cone", "Lognormal around today's price with the GARCH variance summed over each horizon: the 10th to 90th percentile. It assumes no drift, so it is a risk range, not a forecast of direction."],
            ]} sources={["Daily prices: Financial Modeling Prep", "Models: YouBank inference library"]} />
          </div>
        );
      }}
    </Frame>
  );
}

/** HP: the daily record, newest first, with the day's return and distance from the 50-day. */
export function HpScreen({ ticker }: Props) {
  const q = usePrice(ticker);
  const [range, setRange] = useState<Range>("3M");
  return (
    <Frame q={q} what={`${ticker} price history`}>
      {(d) => {
        const pts = slice(d.points, range);
        const all = d.points;
        const offset = all.length - pts.length;
        const rows = pts.map((p, i) => { const prev = all[offset + i - 1]; return { ...p, ret: prev ? p.close / prev.close - 1 : null, vs50: p.sma50 ? p.close / p.sma50 - 1 : null }; }).reverse();
        const rets = rows.map((r) => r.ret).filter((r): r is number => r !== null);
        const best = rows.reduce((m, r) => (r.ret !== null && (m === null || r.ret > (m.ret ?? -Infinity)) ? r : m), null as (typeof rows)[number] | null);
        const worst = rows.reduce((m, r) => (r.ret !== null && (m === null || r.ret < (m.ret ?? Infinity)) ? r : m), null as (typeof rows)[number] | null);
        const avgVol = pts.reduce((a, p) => a + p.volume, 0) / Math.max(1, pts.length);
        const up = rets.filter((r) => r > 0).length;
        return (
          <div className="flex flex-col gap-3 p-3">
            <Tiles>
              <Tile label="Return over range" value={pts.length > 1 ? fsp(pts[pts.length - 1].close / pts[0].close - 1) : "—"} />
              <Tile label="Up days" value={rets.length ? `${up}/${rets.length}` : "—"} sub={rets.length ? fp(up / rets.length, 0) : undefined} />
              <Tile label="Best day" value={fsp(best?.ret ?? null)} sub={best?.date} subTone="text-pos" />
              <Tile label="Worst day" value={fsp(worst?.ret ?? null)} sub={worst?.date} subTone="text-neg" />
              <Tile label="Average volume" value={avgVol >= 1e6 ? `${(avgVol / 1e6).toFixed(1)}M` : `${(avgVol / 1e3).toFixed(0)}K`} />
              <Tile label="Trading days" value={String(pts.length)} />
            </Tiles>
            <Section title="Daily prices" right={<Ranges value={range} options={RANGES} onChange={setRange} />}>
              <DataTable rows={rows} rowKey={(r) => r.date} max={400}
                columns={[
                  { key: "date", label: "Date", align: "left", value: (r) => r.date },
                  { key: "close", label: "Close", value: (r) => r.close, render: (r) => money(r.close) },
                  { key: "ret", label: "Change", value: (r) => r.ret, render: (r) => fsp(r.ret, 2), className: (r) => tone(r.ret) },
                  { key: "vs50", label: "vs 50-day", value: (r) => r.vs50, render: (r) => fsp(r.vs50), className: (r) => tone(r.vs50) },
                  { key: "volume", label: "Volume", value: (r) => r.volume, render: (r) => r.volume.toLocaleString("en-US") },
                ]} />
            </Section>
          </div>
        );
      }}
    </Frame>
  );
}

/** BETA: market sensitivity four ways, with precision, and how it has moved. */
export function BetaScreen({ ticker, onRun }: Props) {
  const q = usePrice(ticker);
  return (
    <Frame q={q} what={`${ticker} beta`}>
      {(d) => {
        const main = d.beta.find((b) => b.window === "2y weekly") ?? d.beta[0];
        const welch = d.beta.find((b) => b.window.includes("Welch"));
        if (!main) return <div className="p-4 text-[11px] text-muted">No index history to compare against.</div>;
        return (
          <div className="flex flex-col gap-3 p-3">
            <Tiles>
              <Tile label="Adjusted beta (2y weekly)" value={fn(main.adjusted)} sub={`raw ${fn(main.beta)}`} title="Blume: 0.67 x raw + 0.33" />
              <Tile label="95% interval, raw" value={`${fn(main.beta - 1.96 * main.se)} to ${fn(main.beta + 1.96 * main.se)}`} sub={`standard error ${fn(main.se)}`} />
              <Tile label="Welch beta (1y daily)" value={welch ? fn(welch.beta) : "—"} sub="best predictor of future beta" />
              <Tile label="R²" value={fp(main.r2, 0)} sub="share of moves the market explains" />
              <Tile label="Correlation" value={fn(main.correlation)} />
              <Tile label="Alpha, annualized" value={fsp(main.alpha)} sub="past, not a forecast" subTone={tone(main.alpha)} />
            </Tiles>
            <div className="flex items-center justify-end gap-1.5"><AskAi onRun={onRun} ticker={ticker} question={`Is ${ticker}'s beta stable enough to use in a WACC? Compare the windows and explain which one to use.`} /><button type="button" onClick={() => onRun?.({ ticker, fn: "WACC", via: "click" })} className="ctl border border-line px-2 py-0.5 text-[10.5px] text-muted hover:border-accent/50 hover:text-accent">Use in WACC →</button></div>
            <Hint skill="BETA">Beta is how far the stock moves for a 1% move in the S&amp;P 500. The adjusted figure pulls the estimate a third of the way to 1, because betas drift toward the market over time. Read the interval before the point: a beta of 1.3 with a standard error of 0.3 could easily be 1.0.</Hint>
            <Section title="Estimates">
              <DataTable rows={d.beta} rowKey={(b) => b.window}
                columns={[
                  { key: "window", label: "Window", align: "left", value: (b) => b.window },
                  { key: "beta", label: "Raw", value: (b) => b.beta, render: (b) => fn(b.beta) },
                  { key: "adjusted", label: "Adjusted", value: (b) => b.adjusted, render: (b) => fn(b.adjusted) },
                  { key: "se", label: "Std error", value: (b) => b.se, render: (b) => fn(b.se) },
                  { key: "r2", label: "R²", value: (b) => b.r2, render: (b) => fp(b.r2, 0) },
                  { key: "n", label: "Observations", value: (b) => b.n },
                ]} />
            </Section>
            <Section title="Rolling 63-day beta">
              <SeriesChart x={d.rollingBeta.map((b) => b.date)} xLabel={(s) => fdate(s, true)} format={(v) => v.toFixed(2)} height={180}
                lines={[{ name: "Beta", values: d.rollingBeta.map((b) => b.beta) }]} refs={[{ value: 1, label: "market" }]} />
            </Section>
            <Why items={[
              ["Raw beta", "Ordinary least squares of the stock's returns on the S&P 500's, on common trading days."],
              ["Blume adjustment", "0.67 x raw + 0.33 (Blume 1975): the default two years of weekly returns with this adjustment is the market's convention for cost of capital."],
              ["Welch beta", "Welch (2022): clip each daily return to between -2 and +4 times the market's move that day, then weight recent days more (half-life about 87 trading days). In his tests it predicts next year's beta better than OLS, Blume, Vasicek or Dimson."],
            ]} sources={["Daily prices: Financial Modeling Prep"]} />
          </div>
        );
      }}
    </Frame>
  );
}

/** RISK: volatility now and forecast, value at risk three ways with a backtest, and drawdowns. */
export function RiskScreen({ ticker, onRun }: Props) {
  const q = usePrice(ticker);
  return (
    <Frame q={q} what={`${ticker} risk`}>
      {(d) => {
        const closes = d.points.map((p) => p.close);
        const logr = closes.slice(1).map((c, i) => Math.log(c / closes[i]));
        const roll: (number | null)[] = d.points.map((_, i) => (i < 21 ? null : (() => { const w = logr.slice(i - 20, i); const m = w.reduce((a, b) => a + b, 0) / w.length; return Math.sqrt(w.reduce((a, b) => a + (b - m) ** 2, 0) / (w.length - 1) * 252); })()));
        let peak = -Infinity;
        const dd = closes.map((c) => { peak = Math.max(peak, c); return c / peak - 1; });
        const from = Math.max(0, d.points.length - 756);
        const v = d.risk.var95, v99 = d.risk.var99;
        return (
          <div className="flex flex-col gap-3 p-3">
            <Tiles>
              <Tile label="Volatility, 20 day" value={fp(d.vol.realized20)} sub={`60 day ${fp(d.vol.realized60)}`} />
              <Tile label="EWMA (λ 0.94)" value={fp(d.vol.ewma)} sub={`1 year ${fp(d.vol.realized1y)}`} />
              <Tile label="GARCH forecast" value={d.vol.garch ? fp(d.vol.garch.next) : "—"} sub={d.vol.garch ? `3M ${fp(d.vol.garch.m3)} · long run ${fp(d.vol.garch.longRun)}` : undefined} />
              <Tile label="1-day VaR 95%" value={fp(v.historical, 2)} sub={`expected shortfall ${fp(v.historicalEs, 2)}`} subTone="text-neg" />
              <Tile label="Max drawdown, 3y" value={fp(d.maxDrawdown.value)} sub={`${d.maxDrawdown.from} to ${d.maxDrawdown.to}`} subTone="text-neg" />
              <Tile label="Sharpe / Sortino, 1y" value={`${fn(d.risk.sharpe)} / ${fn(d.risk.sortino)}`} sub={`12-1 momentum ${fsp(d.risk.momentum12_1)}`} />
            </Tiles>
            <div className="flex items-center justify-end gap-1.5"><AiRead fn="price" params={{ ticker }} /><AskAi onRun={onRun} ticker={ticker} question={`Size a position in ${ticker}: what do its volatility forecast, VaR and drawdown history say about risk per dollar?`} /></div>
            <Hint skill="RISK">Volatility is the typical size of a year&apos;s move. The GARCH forecast bends today&apos;s level toward the long-run one. Value at risk is the one-day loss exceeded on 1 day in 20 (95%) or 1 in 100 (99%); expected shortfall is the average loss on those bad days. The backtest checks whether the VaR held up.</Hint>
            <div className="grid gap-4 @3xl:grid-cols-2">
              <Section title="Rolling 20-day volatility, 3 years">
                <SeriesChart x={d.points.slice(from).map((p) => p.date)} xLabel={(s) => fdate(s, true)} format={(x) => fp(x, 0)} height={170} zero
                  lines={[{ name: "20-day", values: roll.slice(from) }]} refs={d.vol.garch ? [{ value: d.vol.garch.longRun, label: "GARCH long run" }] : []} />
              </Section>
              <Section title="Drawdown from the running peak">
                <SeriesChart x={d.points.slice(from).map((p) => p.date)} xLabel={(s) => fdate(s, true)} format={(x) => fp(x, 0)} height={170} zero
                  lines={[{ name: "Drawdown", values: dd.slice(from), color: "var(--neg)" }]} />
              </Section>
            </div>
            <div className="grid gap-4 @3xl:grid-cols-2">
              <Section title="One-day value at risk">
                <DataTable rows={[{ m: "Historical (500 days)", a: v.historical, b: v99.historical }, { m: "Normal", a: v.parametric, b: v99.parametric }, { m: "Cornish-Fisher (skew, fat tails)", a: v.cornishFisher, b: v99.cornishFisher }, { m: "Expected shortfall (historical)", a: v.historicalEs, b: v99.historicalEs }]} rowKey={(r) => r.m}
                  columns={[{ key: "m", label: "Method", align: "left", value: (r) => r.m, sortable: false }, { key: "a", label: "95%", value: (r) => r.a, render: (r) => fp(r.a, 2), sortable: false }, { key: "b", label: "99%", value: (r) => r.b, render: (r) => fp(r.b, 2), sortable: false }]} />
                <div className="mt-1 text-[10.5px] text-muted">Skew {fn(v.skew)} · excess kurtosis {fn(v.kurtosis)}{v.kurtosis > 3 ? ": fat tails, so the normal VaR understates the risk" : ""}</div>
              </Section>
              <Section title="Backtest: did the VaR hold?">
                {d.backtest.length ? (
                  <div className="space-y-2">
                    {d.backtest.map((b) => (
                      <div key={b.level} className="rounded-md border border-line px-2.5 py-1.5 text-[11px]">
                        <div className="flex items-baseline justify-between"><span className="font-semibold">{fp(b.level, 0)} VaR, last {b.days} days</span><Pill kind={b.pValue < 0.05 ? "neg" : "pos"}>Kupiec p = {fn(b.pValue)}</Pill></div>
                        <div className="num mt-0.5 text-muted">{b.exceptions} losses beyond VaR against {b.expected.toFixed(1)} expected</div>
                        <div className="mt-0.5 text-fg/85">{b.verdict}</div>
                      </div>
                    ))}
                  </div>
                ) : <div className="text-[11px] text-muted">Needs three years of history.</div>}
              </Section>
            </div>
            <BarList title="Returns" format={(x) => fsp(x)} rows={[{ label: "1 month", value: d.change.m1 }, { label: "Year to date", value: d.change.ytd }, { label: "1 year", value: d.change.y1 }, { label: "3 years", value: d.change.y3 }]} />
            <Why items={[
              ["EWMA", "RiskMetrics exponentially weighted variance with λ = 0.94 on daily log returns: 99.9% of the weight sits in the last 112 days."],
              ["GARCH(1,1)", "Variance targeting, grid-searched α and β by maximum likelihood; the forecast decays from tomorrow's variance to the long-run one at rate α + β."],
              ["Value at risk", "Historical: the 5th and 1st percentiles of 500 daily returns. Normal: mean and standard deviation. Cornish-Fisher: the normal quantile corrected for skew and kurtosis."],
              ["Kupiec test", "Counts the days in the last 250 where the loss beat the VaR computed from the 500 days before, and tests that count against the stated rate (a likelihood ratio, chi-squared with one degree of freedom)."],
            ]} sources={["Daily prices: Financial Modeling Prep"]} />
          </div>
        );
      }}
    </Frame>
  );
}
