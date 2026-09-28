"use client";

import type { Command } from "@/lib/functions";
import type { ForecastView, QualityView } from "@/lib/terminal/fundamentals";
import { AiRead, AskAi, DataTable, fm, fn, fp, Frame, fsp, Hint, Meter, Pill, SeriesChart, Section, Tile, Tiles, tone, useTerminal, Why } from "../kit";

type Props = { ticker: string; onRun?: (c: Command) => void };

const BENEISH_VARS: Record<string, string> = {
  DSRI: "Receivables vs sales", GMI: "Gross margin decline", AQI: "Asset quality", SGI: "Sales growth", DEPI: "Depreciation slowdown", SGAI: "SG&A vs sales", LVGI: "Leverage", TATA: "Accruals to assets",
};

/** QUAL: forensic checks on the numbers: Beneish M, Piotroski F, accruals and working capital drift. */
export function QualScreen({ ticker, onRun }: Props) {
  const q = useTerminal<QualityView>("quality", { ticker });
  return (
    <Frame q={q} what={`${ticker} earnings quality`}>
      {(d) => (
        <div className="flex flex-col gap-3 p-3">
          <Tiles>
            <Tile label="Beneish M" value={d.beneish ? fn(d.beneish.m) : "—"} sub={d.beneish ? (d.beneish.flag ? "above -1.78: flagged" : "below -1.78: clear") : "needs two years"} subTone={d.beneish?.flag ? "text-neg" : "text-pos"} />
            <Tile label="P(manipulator)" value={d.beneish ? fp(d.beneish.p, 1) : "—"} sub="Beneish probit, N(M)" />
            <Tile label="Piotroski F" value={d.piotroski ? `${d.piotroski.score}/9` : "—"} sub={d.piotroski ? (d.piotroski.score >= 7 ? "strong" : d.piotroski.score <= 3 ? "weak" : "middling") : undefined} subTone={d.piotroski ? (d.piotroski.score >= 7 ? "text-pos" : d.piotroski.score <= 3 ? "text-neg" : "text-muted") : undefined} />
            <Tile label="Accruals / assets" value={fp(d.accruals, 1)} sub="Sloan: high predicts lower returns" subTone={d.accruals !== null && d.accruals > 0.1 ? "text-neg" : "text-muted"} />
            <Tile label="Gross profitability" value={fp(d.grossProfitability, 1)} sub="gross profit / assets (Novy-Marx)" />
            <Tile label="Fiscal year" value={`FY${d.fy}`} />
          </Tiles>
          {d.flags.length > 0 ? (
            <div className="space-y-1">{d.flags.map((f) => <div key={f} className="rounded-md border border-neg/35 bg-neg/10 px-2.5 py-1.5 text-[11.5px]">{f}</div>)}</div>
          ) : <div className="rounded-md border border-pos/30 bg-pos/10 px-2.5 py-1.5 text-[11.5px]">No red flags from these checks. They screen the numbers; they do not audit them.</div>}
          <div className="flex justify-end gap-1.5"><AiRead fn="quality" params={{ ticker }} /><AskAi onRun={onRun} ticker={ticker} question={`Dig into ${ticker}'s earnings quality: which accounts drive the Beneish and accrual readings, and what does the 10-K say about them?`} /></div>
          <Hint skill="QUAL">These scores look for the fingerprints of aggressive accounting: receivables growing faster than sales, margins slipping, profits running ahead of cash. A flag is a reason to read the footnotes, not a verdict.</Hint>
          <div className="grid gap-4 @3xl:grid-cols-2">
            <Section title="Beneish's eight ratios (1.0 = no change)">
              {d.beneish ? (
                <DataTable rows={Object.entries(d.beneish.vars).map(([k, v]) => ({ k, v, missing: d.beneish!.missing.includes(k) }))} rowKey={(r) => r.k}
                  columns={[
                    { key: "k", label: "Ratio", align: "left", value: (r) => r.k, render: (r) => <span><span className="num font-semibold">{r.k}</span> <span className="text-muted">{BENEISH_VARS[r.k]}</span></span> },
                    { key: "v", label: "Value", value: (r) => r.v, render: (r) => (r.missing ? <span className="text-faint">n/a</span> : fn(r.v, 3)), className: (r) => (!r.missing && ((r.k === "TATA" && r.v > 0.03) || (r.k !== "TATA" && r.k !== "SGAI" && r.k !== "LVGI" && r.v > 1.2)) ? "text-neg" : "") },
                  ]} />
              ) : <div className="text-[11px] text-muted">Needs two annual filings with sales and assets.</div>}
            </Section>
            <Section title="Piotroski's nine signals">
              {d.piotroski && (
                <ul className="space-y-0.5 text-[11px]">
                  {d.piotroski.signals.map((s) => (
                    <li key={s.name} className="flex items-baseline gap-2">
                      <span className={s.pass === null ? "text-faint" : s.pass ? "text-pos" : "text-neg"}>{s.pass === null ? "·" : s.pass ? "✓" : "✗"}</span>
                      <span className="min-w-0 flex-1 truncate" title={s.detail}>{s.name}</span>
                      <span className="num shrink-0 text-muted">{s.detail}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </div>
          <Section title="Trends">
            <div className="grid gap-4 @3xl:grid-cols-2">
              <SeriesChart x={d.trend.map((t) => `FY${t.fy}`)} format={(v) => v.toFixed(0)} height={160} title="Days sales and inventory outstanding"
                lines={[{ name: "DSO", values: d.trend.map((t) => t.dso) }, { name: "DIO", values: d.trend.map((t) => t.dio), color: "var(--chart-emphasis)" }]} />
              <SeriesChart x={d.trend.map((t) => `FY${t.fy}`)} format={(v) => fp(v, 0)} height={160} title="Cash conversion and accruals" zero
                lines={[{ name: "CFO / net income", values: d.trend.map((t) => t.cfoToNetIncome) }, { name: "Accruals / assets", values: d.trend.map((t) => t.accruals), color: "var(--neg)" }, { name: "Gross margin", values: d.trend.map((t) => t.grossMargin), color: "var(--pos)" }]} />
            </div>
          </Section>
          <Why items={[
            ["Beneish M-score (1999)", "-4.84 + 0.920 DSRI + 0.528 GMI + 0.404 AQI + 0.892 SGI + 0.115 DEPI - 0.172 SGAI + 4.679 TATA - 0.327 LVGI. Above -1.78 is Beneish's cut-off; a ratio that cannot be computed is set to 1 and marked n/a."],
            ["Piotroski F-score (2000)", "Nine pass/fail tests on profitability, leverage and liquidity, and efficiency. 8-9 is strong, 0-2 weak."],
            ["Accruals (Sloan 1996)", "Net income less operating cash flow, over average assets. Earnings made of accruals rather than cash have tended to disappoint."],
            ["Gross profitability (Novy-Marx 2013)", "Gross profit over assets: a quality measure that has predicted returns as well as value does."],
          ]} sources={["SEC XBRL company facts"]} />
        </div>
      )}
    </Frame>
  );
}

/** FCST: a statistical revenue forecast with calibrated intervals and its track record, against the Street. */
export function FcstScreen({ ticker, onRun }: Props) {
  const q = useTerminal<ForecastView>("forecast", { ticker });
  return (
    <Frame q={q} what={`${ticker} revenue forecast`}>
      {(d) => {
        const f = d.forecast;
        const hist = d.history.slice(-16);
        const x = [...hist.map((h) => h.label), ...d.labels];
        const pad = (xs: number[]) => [...hist.map(() => null), ...xs];
        const bridge = (xs: number[]) => [...hist.map((_, i) => (i === hist.length - 1 ? hist[i].revenue : null)), ...xs];
        const street = d.consensus.length ? [...hist.map(() => null), ...d.labels.map((l) => d.consensus.find((c) => c.period === l)?.revenueAvg ?? null)] : null;
        return (
          <div className="flex flex-col gap-3 p-3">
            <Tiles>
              <Tile label={`Next quarter (${d.labels[0]})`} value={fm(f.point[0])} sub={`80%: ${fm(f.lower80[0])} to ${fm(f.upper80[0])}`} />
              <Tile label="Growth, next quarter y/y" value={fsp(d.growth[0])} subTone={tone(d.growth[0])} sub={`then ${d.growth.slice(1).map((g) => fsp(g, 0)).join(", ")}`} />
              <Tile label="Street, next quarter" value={d.modelVsStreet ? fm(d.modelVsStreet.street) : "—"} sub={d.modelVsStreet ? `model ${fsp(d.modelVsStreet.gap)} vs Street` : "no estimates on this plan"} subTone={d.modelVsStreet ? tone(d.modelVsStreet.gap) : undefined} />
              <Tile label="Backtest error (MAPE)" value={fp(f.backtest.mape, 1)} sub={`${f.backtest.origins} rolling origins`} />
              <Tile label="80% interval coverage" value={fp(f.backtest.coverage80, 0)} sub="share of past actuals inside" subTone={f.backtest.coverage80 !== null && Math.abs(f.backtest.coverage80 - 0.8) > 0.15 ? "text-neg" : "text-pos"} />
              <Tile label="Model" value={f.model} sub={f.seasonal ? "seasonal (quarterly)" : "no seasonality found"} />
            </Tiles>
            {f.note && <div className="text-[11px] text-muted">{f.note}</div>}
            <div className="flex justify-end gap-1.5"><AiRead fn="forecast" params={{ ticker }} /><AskAi onRun={onRun} ticker={ticker} question={`Compare the model's revenue forecast for ${ticker} with the Street. What would have to happen for the gap to close?`} /></div>
            <Hint skill="FCST">The forecast extends the company&apos;s own quarterly history with the methods that won the M4 forecasting competition. The shaded bands are conformal intervals: sized from the model&apos;s actual past errors, so an 80% band has contained about 80% of past outcomes. Where the Street sits outside the band, the Street expects a change the history does not show.</Hint>
            <Section title="Quarterly revenue, USD millions">
              <SeriesChart x={x} format={(v) => fm(v)} height={240}
                lines={[{ name: "Reported", values: [...hist.map((h) => h.revenue), ...d.labels.map(() => null)], width: 2 }, { name: "Model", values: bridge(f.point), color: "var(--chart-emphasis)", dashed: true }, ...(street ? [{ name: "Street", values: street, color: "var(--pos)" }] : [])]}
                bands={[{ name: "95%", lo: pad(f.lower95), hi: pad(f.upper95), color: "var(--chart-emphasis)", opacity: 0.1 }, { name: "80%", lo: pad(f.lower80), hi: pad(f.upper80), color: "var(--chart-emphasis)", opacity: 0.2 }]} />
            </Section>
            <div className="grid gap-4 @3xl:grid-cols-2">
              <Section title="Forecast">
                <DataTable rows={d.labels.map((l, i) => ({ l, p: f.point[i], lo: f.lower80[i], hi: f.upper80[i], g: d.growth[i], s: d.consensus.find((c) => c.period === l) ?? null }))} rowKey={(r) => r.l}
                  columns={[
                    { key: "l", label: "Quarter", align: "left", value: (r) => r.l, sortable: false },
                    { key: "p", label: "Model", value: (r) => r.p, render: (r) => fm(r.p), sortable: false },
                    { key: "r", label: "80% interval", value: (r) => r.lo, render: (r) => `${fm(r.lo)}–${fm(r.hi)}`, sortable: false },
                    { key: "g", label: "y/y", value: (r) => r.g, render: (r) => fsp(r.g), className: (r) => tone(r.g), sortable: false },
                    { key: "s", label: "Street", value: (r) => r.s?.revenueAvg ?? null, render: (r) => (r.s ? `${fm(r.s.revenueAvg)} (${r.s.analysts})` : "—"), sortable: false },
                  ]} />
              </Section>
              <Section title="Is the Street inside the model's range?">
                {d.consensus.length ? d.consensus.map((c) => {
                  const i = d.labels.indexOf(c.period);
                  if (i < 0) return null;
                  const inside = c.revenueAvg >= f.lower80[i] && c.revenueAvg <= f.upper80[i];
                  return <div key={c.period} className="mb-1 flex items-center justify-between text-[11px]"><span>{c.period}: Street {fm(c.revenueAvg)}</span><Pill kind={inside ? "pos" : "warn"}>{inside ? "inside 80%" : c.revenueAvg > f.upper80[i] ? "above the band" : "below the band"}</Pill></div>;
                }) : <div className="text-[11px] text-muted">No consensus estimates for this ticker on the current data plan. The model forecast stands on its own.</div>}
                <div className="mt-2"><Meter label="Backtest coverage of the 80% band" value={f.backtest.coverage80} zones={[0.65, 0.95]} invert detail="Close to 80% means the intervals are honest." /></div>
              </Section>
            </div>
            <Why items={[
              ["Models", "Simple exponential smoothing, Holt's damped trend and the Theta method, and their average (the M4 competition's strongest simple benchmark), on seasonally adjusted data when the M4 seasonality test (autocorrelation at lag 4 beyond 90% Bartlett bounds) finds seasonality."],
              ["Conformal intervals", "Rolling-origin backtest: refit at each past origin and forecast ahead; the bands come from the empirical quantile of the relative errors, pooled across horizons and scaled by the square root of the horizon. No normality assumption. Coverage is checked only with errors known before each origin."],
              ["Street", "Quarterly revenue consensus from Financial Modeling Prep when the plan includes it."],
            ]} sources={["SEC XBRL company facts (quarterly revenue)", "Estimates: Financial Modeling Prep"]} />
          </div>
        );
      }}
    </Frame>
  );
}
