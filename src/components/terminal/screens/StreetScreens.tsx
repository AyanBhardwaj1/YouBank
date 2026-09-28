"use client";

import type { Command } from "@/lib/functions";
import type { AnalystView, DividendView, EarningsView } from "@/lib/terminal/street";
import { AiRead, AskAi, BarList, DataTable, fbig, fn, fp, Frame, fsp, Hint, Meter, Pill, SeriesChart, Section, Tile, Tiles, tone, useTerminal, Why, type Column } from "../kit";

type Props = { ticker: string; onRun?: (c: Command) => void };

/** A beat-rate tile's figures; with no quarters on record the posterior is only its prior, so say so. */
const beatTile = (b: EarningsView["beat"]["eps"]) =>
  b.n ? { value: fp(b.rate, 0), sub: `80% range ${fp(b.lo, 0)}–${fp(b.hi, 0)} · n=${b.n}` } : { value: "—", sub: "no estimates on record" };

/** EE: the earnings record, how often the company beats (with honest uncertainty), and how the stock reacts. */
export function EeScreen({ ticker, onRun }: Props) {
  const q = useTerminal<EarningsView>("earnings", { ticker });
  return (
    <Frame q={q} what={`${ticker} earnings`}>
      {(d) => {
        const qs = [...d.quarters].reverse();
        return (
          <div className="flex flex-col gap-3 p-3">
            <Tiles>
              <Tile label={d.next?.estimatedDate ? "Next report (estimated)" : "Next report"} value={d.next?.date ?? "—"} sub={d.next?.epsEstimated !== null && d.next?.epsEstimated !== undefined ? `EPS est. ${fn(d.next.epsEstimated)}` : undefined} />
              <Tile label="Revenue est., next" value={d.next?.revenueEstimated ? fbig(d.next.revenueEstimated) : "—"} />
              <Tile label="Typical move on the day" value={fp(d.move.median, 1)} sub={d.move.p80 !== null ? `80% of reactions within ±${fp(d.move.p80, 1)}` : undefined} />
              <Tile label="EPS beat rate" {...beatTile(d.beat.eps)} />
              <Tile label="Revenue beat rate" {...beatTile(d.beat.revenue)} />
              <Tile label="Quarters on record" value={String(d.quarters.length)} />
            </Tiles>
            <div className="flex justify-end gap-1.5"><AiRead fn="earnings" params={{ ticker }} /><AskAi onRun={onRun} ticker={ticker} question={`Preview ${ticker}'s next earnings: beat history, the typical move on report days, and what to watch in the release.`} /></div>
            <Hint skill="EE">Beat rates come with a range because a few quarters prove little: four beats in four could be luck. The typical move is the stock&apos;s close-to-close reaction on report days; the 80% figure is the size of move that four reports in five stayed within.</Hint>
            <div className="grid gap-4 @3xl:grid-cols-2">
              <Section title="EPS surprise by quarter">
                <BarList format={(v) => fsp(v)} rows={qs.slice(-12).map((x) => ({ label: x.date, value: x.epsSurprise }))} />
              </Section>
              <Section title="Stock reaction by quarter">
                <BarList format={(v) => fsp(v)} rows={qs.slice(-12).map((x) => ({ label: x.date, value: x.move }))} />
              </Section>
            </div>
            <Section title="History">
              <DataTable rows={d.quarters} rowKey={(r) => r.date}
                columns={[
                  { key: "date", label: "Reported", align: "left", value: (r) => r.date },
                  { key: "eps", label: "EPS", value: (r) => r.epsActual, render: (r) => fn(r.epsActual) },
                  { key: "est", label: "Estimate", value: (r) => r.epsEstimated, render: (r) => fn(r.epsEstimated) },
                  { key: "s", label: "Surprise", value: (r) => r.epsSurprise, render: (r) => fsp(r.epsSurprise), className: (r) => tone(r.epsSurprise) },
                  { key: "rev", label: "Revenue", value: (r) => r.revenueActual, render: (r) => fbig(r.revenueActual) },
                  { key: "rs", label: "Rev. surprise", value: (r) => r.revenueSurprise, render: (r) => fsp(r.revenueSurprise), className: (r) => tone(r.revenueSurprise) },
                  { key: "m", label: "Move", value: (r) => r.move, render: (r) => fsp(r.move), className: (r) => tone(r.move) },
                ]} />
            </Section>
            {d.annual.length > 0 && (
              <Section title="Annual consensus">
                <DataTable rows={d.annual} rowKey={(r) => r.year}
                  columns={[
                    { key: "y", label: "Year", align: "left", value: (r) => r.year },
                    // Nasdaq, the backup, has EPS consensus only: no revenue columns without revenue.
                    ...(d.annual.some((r) => r.revenueAvg !== null) ? [
                      { key: "r", label: "Revenue ($mm)", value: (r) => r.revenueAvg, render: (r) => fn(r.revenueAvg, 0) },
                      { key: "range", label: "Range", value: (r) => r.revenueLow, render: (r) => (r.revenueLow === null && r.revenueHigh === null ? "—" : `${fn(r.revenueLow, 0)}–${fn(r.revenueHigh, 0)}`) },
                    ] satisfies Column<EarningsView["annual"][number]>[] : []),
                    { key: "e", label: "EPS", value: (r) => r.epsAvg, render: (r) => fn(r.epsAvg) },
                    { key: "n", label: "Analysts", value: (r) => r.analysts },
                  ]} />
              </Section>
            )}
            <Why items={[
              ["Beat rate", "A Beta-Binomial posterior with a uniform prior: (beats + 1) / (reports + 2), with an 80% credible interval (normal approximation). It shrinks short records toward a coin flip."],
              ["Typical move", "The median absolute close-to-close return across the report date; the 80% figure is a conformal quantile of past reactions."],
            ]} sources={["Earnings and estimates: Financial Modeling Prep", "Prices: Financial Modeling Prep"]} />
          </div>
        );
      }}
    </Frame>
  );
}

/** ANR: what the analysts say, where their targets sit, and which way the herd is moving. */
export function AnrScreen({ ticker, onRun }: Props) {
  const q = useTerminal<AnalystView>("analysts", { ticker });
  return (
    <Frame q={q} what={`${ticker} analyst views`}>
      {(d) => {
        const total = d.counts.buy + d.counts.hold + d.counts.sell;
        return (
          <div className="flex flex-col gap-3 p-3">
            <Tiles>
              <Tile label="Consensus target" value={d.target ? fn(d.target.consensus) : "—"} sub={d.target?.upside !== null && d.target?.upside !== undefined ? `${fsp(d.target.upside)} from ${fn(d.last)}` : undefined} subTone={tone(d.target?.upside)} />
              <Tile label="Target range" value={d.target ? `${fn(d.target.low, 0)}–${fn(d.target.high, 0)}` : "—"} sub={d.target?.dispersion !== null && d.target?.dispersion !== undefined ? `dispersion ${fp(d.target.dispersion, 0)}` : undefined} />
              <Tile label="Buy / hold / sell" value={total ? `${d.counts.buy} / ${d.counts.hold} / ${d.counts.sell}` : "—"} sub={total ? `${fp(d.counts.buy / total, 0)} buy` : "no recent ratings"} />
              <Tile label="Upgrades, 90 days" value={String(d.drift.upgrades90)} subTone="text-pos" />
              <Tile label="Downgrades, 90 days" value={String(d.drift.downgrades90)} subTone="text-neg" />
              {d.snapshot || !d.consensusRating
                ? <Tile label="Quant rating" value={d.snapshot?.rating ?? "—"} sub={d.snapshot ? `score ${d.snapshot.overallScore}/5` : undefined} />
                : <Tile label="Consensus rating" value={d.consensusRating} />}
            </Tiles>
            <div className="flex flex-wrap items-center gap-2"><Pill kind={d.drift.net >= 2 ? "pos" : d.drift.net <= -2 ? "neg" : "muted"}>{d.drift.net >= 2 ? "improving" : d.drift.net <= -2 ? "cooling" : "steady"}</Pill><span className="text-[11px] text-muted">{d.drift.label}</span><span className="ml-auto flex gap-1.5"><AiRead fn="analysts" params={{ ticker }} /><AskAi onRun={onRun} ticker={ticker} question={`Summarize the bull and bear cases the Street is making on ${ticker}, and where the price targets cluster.`} /></span></div>
            <Hint skill="ANR">Wide target dispersion means the Street disagrees about the story, not just the numbers. Drift (upgrades less downgrades) tends to matter more than the level: a crowded buy list has less room to get more bullish.</Hint>
            {d.target && d.last !== null && (
              <Section title="Where the price sits in the target range">
                <div className="relative mt-3 h-2 rounded-full bg-elevated">
                  {(() => {
                    const lo = Math.min(d.target.low, d.last), hi = Math.max(d.target.high, d.last);
                    const pos = (v: number) => `${((v - lo) / (hi - lo || 1)) * 100}%`;
                    return (
                      <>
                        <div className="absolute top-0 h-full rounded-full bg-chart-1/40" style={{ left: pos(d.target.low), width: `calc(${pos(d.target.high)} - ${pos(d.target.low)})` }} />
                        <div className="absolute -top-1 h-4 w-0.5 bg-chart-emphasis" style={{ left: pos(d.target.consensus) }} title="Consensus" />
                        <div className="absolute -top-1.5 h-5 w-1 rounded bg-fg" style={{ left: pos(d.last) }} title="Price" />
                      </>
                    );
                  })()}
                </div>
                <div className="num mt-1.5 flex justify-between text-[10.5px] text-muted"><span>low {fn(d.target.low)}</span><span className="text-chart-emphasis">consensus {fn(d.target.consensus)}</span><span className="text-fg">price {fn(d.last)}</span><span>high {fn(d.target.high)}</span></div>
              </Section>
            )}
            <Section title="Latest rating by firm (last 12 months)">
              <DataTable rows={d.firms} rowKey={(r) => r.firm} initialSort={{ key: "date", desc: true }}
                columns={[
                  { key: "firm", label: "Firm", align: "left", value: (r) => r.firm },
                  { key: "grade", label: "Rating", value: (r) => r.grade, render: (r) => <span className={r.bucket === "buy" ? "text-pos" : r.bucket === "sell" ? "text-neg" : "text-muted"}>{r.grade}</span> },
                  { key: "action", label: "Action", value: (r) => r.action },
                  { key: "date", label: "Date", value: (r) => r.date },
                ]} />
            </Section>
            <Why items={[["Buckets", "Ratings are grouped into buy, hold and sell from each firm's own wording (outperform and overweight count as buy)."], ["Quant rating", "Financial Modeling Prep's factor-based rating, shown for reference."]]} sources={["Grades, targets and ratings: Financial Modeling Prep"]} />
          </div>
        );
      }}
    </Frame>
  );
}

/** DVD: the dividend record, its growth, and a safety score with reasons. */
export function DvdScreen({ ticker, onRun }: Props) {
  const q = useTerminal<DividendView>("dividends", { ticker });
  return (
    <Frame q={q} what={`${ticker} dividends`}>
      {(d) => {
        // AI research, the last backup, finds the current dividend but no payment history.
        const current = !d.payments.length && d.ttm > 0;
        if (!d.payments.length && !current) return <div className="p-4 text-[11px] text-muted">{ticker} has not paid a dividend in the available history.</div>;
        // Filings give fiscal years from the 10-K; payments by ex-date are summed by calendar year.
        const byYear = new Map<string, number>();
        if (d.annual?.length) for (const a of d.annual) byYear.set(String(a.year), a.amount);
        else for (const p of d.payments) byYear.set(p.date.slice(0, 4), (byYear.get(p.date.slice(0, 4)) ?? 0) + p.amount);
        const years = [...byYear.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).slice(-15);
        const filings = d.basis === "fiscal quarter";
        return (
          <div className="flex flex-col gap-3 p-3">
            <Tiles>
              <Tile label={current ? "Annual dividend" : "Trailing 12 months"} value={fn(d.ttm, 2)} sub={d.frequency || undefined} />
              <Tile label="Yield" value={fp(d.yield, 2)} />
              <Tile label="Payout ratio" value={fp(d.payout, 0)} sub="of trailing EPS" subTone={d.payout !== null && d.payout > 0.8 ? "text-neg" : "text-muted"} />
              {!current && <Tile label="Growth, 1 / 3 / 5y" value={`${fsp(d.growth.y1, 0)} / ${fsp(d.growth.y3, 0)}`} sub={`5y ${fsp(d.growth.y5, 0)} a year`} />}
              {!current && <Tile label="Years without a cut" value={String(d.streakYears)} sub={filings && d.annual?.length ? `in filings since FY${d.annual[0].year}` : undefined} />}
              <Tile label="Safety" value={`${d.safety.score}/100`} sub={d.safety.label} subTone={d.safety.label === "safe" ? "text-pos" : d.safety.label === "watch" ? "text-chart-emphasis" : "text-neg"} />
            </Tiles>
            <div className="grid gap-4 @3xl:grid-cols-2">
              {!current && (
                <Section title={d.annual?.length ? "Dividends per share by fiscal year (10-K)" : "Dividends per share by calendar year"}>
                  <SeriesChart x={years.map(([y]) => y)} format={(v) => v.toFixed(2)} height={170} zero lines={[{ name: "Dividend", values: years.map(([, v]) => v) }]} />
                </Section>
              )}
              <Section title="Safety" right={<AskAi onRun={onRun} ticker={ticker} question={`How safe is ${ticker}'s dividend? Check coverage by earnings and free cash flow, leverage, and management's stated policy.`} />}>
                <Meter label="Dividend safety" value={d.safety.score / 100} zones={[0.45, 0.7]} invert />
                <ul className="mt-2 list-disc space-y-0.5 pl-4 text-[11px] text-muted">{d.safety.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
              </Section>
            </div>
            <Hint skill="DVD">Safety starts at 100 and loses points for a stretched payout, earnings that do not cover the dividend, a recent cut and heavy debt. It is a screen: check free cash flow in FA before relying on it.</Hint>
            {d.payments.length > 0 && (
              <Section title={filings ? "Per share, by fiscal quarter (10-K and 10-Q)" : "Payments"}>
                <DataTable rows={d.payments} rowKey={(r, i) => `${r.date}-${i}`} max={40}
                  columns={filings
                    ? [{ key: "d", label: "Quarter ended", align: "left", value: (r) => r.date }, { key: "a", label: "Per share", value: (r) => r.amount, render: (r) => fn(r.amount, 4) }]
                    : [{ key: "d", label: "Ex-date", align: "left", value: (r) => r.date }, { key: "a", label: "Amount", value: (r) => r.amount, render: (r) => fn(r.amount, 4) }, { key: "p", label: "Paid", value: (r) => r.payDate }]} />
              </Section>
            )}
          </div>
        );
      }}
    </Frame>
  );
}
