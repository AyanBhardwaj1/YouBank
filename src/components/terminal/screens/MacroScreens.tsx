"use client";

import type { Command } from "@/lib/functions";
import type { CurveView, MacroView } from "@/lib/terminal/macro";
import { Sparkline } from "@/components/charts/Sparkline";
import { AiRead, AskAi, DataTable, fdate, fn, fp, Frame, Hint, Meter, Pill, SeriesChart, Section, Tile, Tiles, useTerminal, Why } from "../kit";

type Props = { onRun?: (c: Command) => void };
const pts = (v: number | null | undefined, d = 2) => (v === null || v === undefined ? "—" : `${v.toFixed(d)}%`);

/** GC: the Treasury curve today against a week, a month and a year ago, its Nelson-Siegel factors, and the recession signal. */
export function GcScreen({ onRun }: Props) {
  const q = useTerminal<CurveView>("curve");
  return (
    <Frame q={q} what="the Treasury curve">
      {(d) => {
        const today = d.curves[0];
        const y = (label: string) => today.yields[d.labels.indexOf(label)] ?? null;
        const hist = d.history.slice(-260);
        const sh = d.shape;
        const shape = sh.s3m10y !== null && sh.s3m10y < 0 ? "Inverted" : sh.inverted ? "Kinked" : sh.s2s10 !== null && sh.s2s10 > 1 ? "Steep" : sh.s2s10 !== null && sh.s2s10 < 0.25 ? "Flat" : "Upward";
        return (
          <div className="flex flex-col gap-3 p-3">
            <Tiles>
              <Tile label="2-year" value={pts(y("2Y"))} />
              <Tile label="10-year" value={pts(y("10Y"))} />
              <Tile label="30-year" value={pts(y("30Y"))} />
              <Tile label="10y minus 2y" value={y("10Y") !== null && y("2Y") !== null ? `${((y("10Y")! - y("2Y")!) * 100).toFixed(0)} bp` : "—"} />
              <Tile label="10y minus 3m" value={y("10Y") !== null && y("3M") !== null ? `${((y("10Y")! - y("3M")!) * 100).toFixed(0)} bp` : "—"} />
              <Tile label="Shape" value={shape} sub={sh.butterfly !== null ? `2s5s10s butterfly ${(sh.butterfly * 100).toFixed(0)} bp` : undefined} title="Kinked: some segment of the curve slopes down" />
            </Tiles>
            <div className="grid gap-3 @3xl:grid-cols-[1fr_280px]">
              <Section title={`Par yield curve, ${d.asOf}`} right={<span className="flex gap-1.5"><AiRead fn="curve" params={{}} /><AskAi onRun={onRun} ticker="" question="Read the Treasury curve for me: level, slope and curvature, how it has moved, and what it implies for rates and recession risk." /></span>}>
                <SeriesChart x={d.labels} format={(v) => `${v.toFixed(2)}%`} height={220}
                  lines={[
                    ...d.curves.map((c, i) => ({ name: `${c.label} (${c.date})`, values: c.yields, color: ["var(--chart-1)", "var(--info)", "var(--muted)", "var(--chart-emphasis)"][i], dashed: i > 0, width: i === 0 ? 2.25 : 1.25 })),
                    ...(d.fit ? [{ name: "Nelson-Siegel fit", values: d.fit.fitted, color: "var(--pos)", dashed: true, width: 1, label: false }] : []),
                  ]} />
              </Section>
              <div className="flex flex-col gap-3">
                <Section title="Recession in the next 12 months">
                  <Meter label="New York Fed yield-curve model" value={d.recession?.probability ?? null} zones={[0.15, 0.3]} detail={d.recession ? `10y minus 3m, monthly average: ${(d.recession.spread * 100).toFixed(0)} bp` : undefined} />
                </Section>
                {d.fit && (
                  <Section title="Nelson-Siegel factors">
                    <div className="num space-y-1 text-[11px]">
                      <div className="flex justify-between"><span className="text-muted">Level (long end)</span><span>{pts(d.fit.level)}</span></div>
                      <div className="flex justify-between"><span className="text-muted">Slope (short minus long)</span><span>{fn(d.fit.slope)} pts</span></div>
                      <div className="flex justify-between"><span className="text-muted">Curvature (the belly)</span><span>{fn(d.fit.curvature)} pts</span></div>
                      <div className="flex justify-between"><span className="text-muted">Fit error (RMSE)</span><span>{(d.fit.rmse * 100).toFixed(1)} bp</span></div>
                    </div>
                  </Section>
                )}
              </div>
            </div>
            <Hint skill="GC">An upward-sloping curve is normal: lenders want more to lock up money longer. When short rates sit above long ones (inversion), markets expect cuts, and an inverted 10y-3m spread has preceded each US recession since the late 1960s, though not every inversion was followed by one. The New York Fed turns that spread into a probability.</Hint>
            <Section title="The spreads over the last year">
              <SeriesChart x={hist.map((h) => h.date)} xLabel={(s) => fdate(s, true)} format={(v) => `${(v * 100).toFixed(0)} bp`} height={170} zero
                lines={[{ name: "10y minus 2y", values: hist.map((h) => h.s2s10) }, { name: "10y minus 3m", values: hist.map((h) => h.s3m10y), color: "var(--chart-emphasis)" }]} refs={[{ value: 0, label: "inverted below" }]} />
            </Section>
            <Why items={[
              ["Recession probability", "Estrella and Mishkin's probit as the New York Fed runs it: P = N(-0.5333 - 0.6330 x spread), with the spread the monthly average of the 10-year minus the 3-month Treasury in percentage points."],
              ["Nelson-Siegel", "y(τ) = β0 + β1·(1 - e^(-λτ))/(λτ) + β2·[(1 - e^(-λτ))/(λτ) - e^(-λτ)], with Diebold and Li's λ fixed and the three betas fitted by least squares to today's par yields."],
            ]} sources={["U.S. Treasury daily par yield curve (public domain)"]} />
          </div>
        );
      }}
    </Frame>
  );
}

/** ECO: the economy at a glance: prices, jobs, growth, rates, with model outlooks built only on public-domain data. */
export function EcoScreen({ onRun }: Props) {
  const q = useTerminal<MacroView>("macro");
  return (
    <Frame q={q} what="the economy">
      {(d) => {
        const groups = [...new Set(d.series.map((s) => s.group))];
        return (
          <div className="flex flex-col gap-3 p-3">
            <div className="grid gap-3 @2xl:grid-cols-3">
              <div className="rounded-md border border-line p-2.5"><Meter label="Recession within 12 months (yield curve)" value={d.recession?.probability ?? null} zones={[0.15, 0.3]} detail={d.recession ? `10y minus 3m: ${(d.recession.spread * 100).toFixed(0)} bp (monthly average)` : undefined} /></div>
              <div className="rounded-md border border-line p-2.5">
                <div className="flex items-baseline justify-between text-[11px]"><span className="text-muted">Sahm rule</span>{d.sahm && <Pill kind={d.sahm.triggered ? "neg" : d.sahm.value >= 0.3 ? "warn" : "pos"}>{d.sahm.triggered ? "triggered" : "not triggered"}</Pill>}</div>
                <div className="num mt-1 text-[18px] font-semibold">{d.sahm ? `${d.sahm.value.toFixed(2)} pts` : "—"}</div>
                <div className="text-[10px] text-faint">3-month average unemployment less its 12-month low; 0.50 signals recession</div>
              </div>
              <div className="flex items-center justify-end gap-1.5"><AiRead fn="macro" params={{}} /><AskAi onRun={onRun} ticker="" question="Summarize where the US economy stands: inflation, the labor market and growth, the model outlooks, and the recession signals." /></div>
            </div>
            <Hint skill="ECO">Each tile is the latest reading with where it sits in its own ten-year range. The outlooks are statistical forecasts from each series&apos; own history, with intervals sized by how wrong the method has been before; they know nothing about policy or news.</Hint>
            <Section title="Model outlooks, next three months (BLS data)">
              <div className="grid gap-3 @xl:grid-cols-2 @4xl:grid-cols-3">
                {d.outlooks.map((o) => (
                  <div key={o.id} className="rounded-md border border-line p-2.5">
                    <div className="flex items-baseline justify-between"><span className="text-[11px] font-semibold">{o.label}</span><span className="num text-[10.5px] text-muted">{o.latest ? `${o.latest.value.toFixed(o.unit.startsWith("k") ? 0 : 2)} ${o.unit} · ${o.latest.date.slice(0, 7)}` : ""}</span></div>
                    <DataTable rows={o.months.map((m, i) => ({ m, p: o.point[i], lo: o.lo80[i], hi: o.hi80[i] }))} rowKey={(r) => r.m}
                      columns={[{ key: "m", label: "Month", align: "left", value: (r) => r.m, sortable: false }, { key: "p", label: "Forecast", value: (r) => r.p, render: (r) => r.p.toFixed(o.unit.startsWith("k") ? 0 : 2), sortable: false }, { key: "r", label: "80% range", value: (r) => r.lo, render: (r) => `${r.lo.toFixed(o.unit.startsWith("k") ? 0 : 2)} to ${r.hi.toFixed(o.unit.startsWith("k") ? 0 : 2)}`, sortable: false }]} />
                    <div className="mt-1 text-[10px] text-faint">Backtest: {o.backtest.origins} origins, MAPE {fp(o.backtest.mape, 1)}, 80% coverage {fp(o.backtest.coverage80, 0)}</div>
                  </div>
                ))}
                {!d.outlooks.length && <div className="text-[11px] text-muted">BLS data unavailable right now (the keyless API allows 25 requests a day; answers are cached for 12 hours).</div>}
              </div>
            </Section>
            {groups.map((g) => (
              <Section key={g} title={g}>
                <div className="grid grid-cols-2 gap-2 @2xl:grid-cols-3 @4xl:grid-cols-4">
                  {d.series.filter((s) => s.group === g).map((s) => (
                    <div key={s.id} className="flex min-w-0 flex-col rounded-md border border-line bg-elevated/50 px-2.5 py-2" title={`${s.id} · source: ${s.source}`}>
                      <div className="truncate text-[10px] uppercase tracking-wider text-muted">{s.label}</div>
                      <div className="mt-1 flex items-end justify-between gap-2">
                        <div>
                          <div className="num text-[16px] font-semibold leading-none">{s.latest ? s.latest.value.toLocaleString("en-US", { maximumFractionDigits: s.unit.startsWith("k") ? 0 : 2 }) : "—"}</div>
                          <div className="num mt-1 text-[10px] text-muted">{s.unit}{s.latest ? ` · ${s.latest.date.slice(0, 7)}` : ""}</div>
                        </div>
                        <Sparkline values={s.spark} width={70} height={24} />
                      </div>
                      {s.percentile10y !== null && <div className="mt-1.5 h-1 rounded-full bg-elevated"><div className="h-full rounded-full bg-chart-1/70" style={{ width: `${Math.max(3, s.percentile10y * 100)}%` }} title={`${Math.round(s.percentile10y * 100)}th percentile of the last ten years`} /></div>}
                      <div className="mt-1 text-[9.5px] text-faint">{s.source} via FRED</div>
                    </div>
                  ))}
                </div>
              </Section>
            ))}
            <Why items={[
              ["Outlooks", "Damped-trend exponential smoothing on the level of each BLS series (CPI, core CPI, unemployment, payrolls, earnings), transformed to the displayed change, with conformal 80% intervals from a rolling backtest."],
              ["Sahm rule", "Computed from the BLS unemployment rate: the three-month average minus its low over the prior twelve months."],
              ["Data and licences", "Forecasts use BLS and Treasury data, which are public domain. The tiles are FRED series, shown with attribution; under FRED's terms they are not sent to the AI or used to fit models."],
            ]} sources={["Bureau of Labor Statistics (public domain)", "U.S. Treasury (public domain)", "FRED, Federal Reserve Bank of St. Louis (display)"]} />
          </div>
        );
      }}
    </Frame>
  );
}
