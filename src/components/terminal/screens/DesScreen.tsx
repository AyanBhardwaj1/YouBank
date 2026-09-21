"use client";

import type { Command } from "@/lib/functions";
import type { CompanyData } from "@/lib/types";
import { derive, fmtMoney, fmtPct } from "@/lib/metrics";
import { Columns } from "@/components/charts/Columns";
import { StatTile } from "../StatTile";

export function DesScreen({ company: c, onRun }: { company: CompanyData; onRun: (cmd: Command) => void }) {
  const d = derive(c);
  const p = c.price;
  const chg = p?.changePct ?? null;
  const rangePos = p && p.low52 !== null && p.high52 !== null && p.high52 > p.low52 ? Math.min(1, Math.max(0, (p.last - p.low52) / (p.high52 - p.low52))) : null;

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="num text-[22px] font-semibold leading-none text-accent">{c.ticker}</span>
            <span className="truncate text-[14px] text-fg">{c.name}</span>
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1.5 text-[10.5px]">
            <span className="rounded border border-line bg-elevated px-1.5 py-0.5 text-muted">{c.exchange || "SEC"}</span>
            <span className="rounded border border-line bg-elevated px-1.5 py-0.5 text-muted">SIC {c.sic} · {c.sicLabel}</span>
            {c.hq && <span className="rounded border border-line bg-elevated px-1.5 py-0.5 text-muted">{c.hq}</span>}
            <span className="rounded border border-line bg-elevated px-1.5 py-0.5 text-muted">FYE {c.fye}</span>
          </div>
        </div>
        {p ? (
          <div className="shrink-0 text-right">
            <div className="num text-[20px] font-semibold leading-none">{p.last.toFixed(2)}</div>
            {chg !== null && (
              <div className={`num mt-1 text-[11px] ${chg >= 0 ? "text-pos" : "text-neg"}`}>
                {chg >= 0 ? "▲" : "▼"} {Math.abs(chg).toFixed(2)}% <span className="text-muted">today</span>
              </div>
            )}
            {rangePos !== null && (
              <div className="mt-2 w-40" title="52-week range">
                <div className="relative h-1.5 rounded-full bg-chart-1/20">
                  <div className="absolute inset-y-0 left-0 rounded-full bg-chart-1/60" style={{ width: `${rangePos * 100}%` }} />
                  <div className="absolute top-1/2 h-3 w-0.5 -translate-y-1/2 bg-fg" style={{ left: `${rangePos * 100}%` }} />
                </div>
                <div className="num mt-0.5 flex justify-between text-[9.5px] text-muted"><span>{p.low52}</span><span>52w</span><span>{p.high52}</span></div>
              </div>
            )}
          </div>
        ) : <div className="text-[11px] text-muted">No price (FMP key missing or symbol unsupported)</div>}
      </div>

      <div className="grid grid-cols-3 gap-2 xl:grid-cols-6">
        <StatTile label="Market cap" value={d.marketCap !== null ? `$${fmtMoney(d.marketCap)}` : "n/a"} hint="From FMP" />
        <StatTile label="Enterprise value" value={d.ev !== null ? `$${fmtMoney(d.ev)}` : "n/a"} delta={d.netDebt !== null ? (d.netDebt < 0 ? `net cash $${fmtMoney(-d.netDebt)}` : `net debt $${fmtMoney(d.netDebt)}`) : undefined} hint="Market cap + debt - cash" />
        <StatTile label="LTM revenue" value={c.ltm.revenue !== null ? `$${fmtMoney(c.ltm.revenue)}` : "n/a"} delta={d.revenueGrowth !== null ? `${fmtPct(d.revenueGrowth)} y/y` : undefined} deltaGood={d.revenueGrowth !== null ? d.revenueGrowth >= 0 : undefined} trend={c.quarters.map((q) => q.revenue)} />
        <StatTile label="Gross margin" value={fmtPct(d.grossMargin)} />
        <StatTile label="FCF margin" value={fmtPct(d.fcfMargin)} delta={d.fcf !== null ? `$${fmtMoney(d.fcf)} FCF` : undefined} deltaGood={d.fcf !== null ? d.fcf >= 0 : undefined} />
        <StatTile label="Rule of 40" value={d.ruleOf40 !== null ? d.ruleOf40.toFixed(0) : "n/a"} delta={d.ruleOf40 !== null ? (d.ruleOf40 >= 40 ? "above 40" : "below 40") : undefined} deltaGood={d.ruleOf40 !== null ? d.ruleOf40 >= 40 : undefined} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {c.quarters.length > 0 ? (
          <Columns data={c.quarters.map((q) => ({ label: q.label, value: q.revenue }))} format={(v) => `$${fmtMoney(v)}`} title="Quarterly revenue, USD millions (SEC XBRL)" height={140} />
        ) : <div className="text-[11px] text-muted">No quarterly revenue series available.</div>}
        <div className="min-w-0">
          <p className="line-clamp-6 text-[12px] leading-relaxed text-fg/90">{c.description || "No description available."}</p>
          <dl className="num mt-3 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-[11px]">
            <dt className="text-muted">CIK</dt><dd>{c.cik}</dd>
            <dt className="text-muted">LTM period</dt><dd>{c.ltm.periodEnd}</dd>
            <dt className="text-muted">Shares out</dt><dd className="truncate" title={c.sources.concepts.shares}>{c.balance.sharesOut !== null ? `${fmtMoney(c.balance.sharesOut)} shares` : "n/a"}{c.sources.concepts.shares?.includes("Weighted") ? <span className="text-muted"> (diluted wtd. avg.)</span> : null}</dd>
            <dt className="text-muted">Debt / cash</dt><dd>${fmtMoney(c.balance.debt)} / ${fmtMoney(c.balance.cash)}</dd>
            {c.website && <><dt className="text-muted">Web</dt><dd><a href={c.website} target="_blank" rel="noreferrer" className="text-info hover:underline">{c.website.replace(/^https?:\/\//, "")}</a></dd></>}
          </dl>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 border-t border-line pt-2">
        {(["FA", "COMPS", "FIL", "AI"] as const).map((fn) => (
          <button key={fn} type="button" onClick={() => onRun({ ticker: c.ticker, fn })}
            className="num rounded border border-line bg-elevated px-2 py-1 text-[11px] font-semibold text-muted hover:border-accent/50 hover:text-accent">{c.ticker} {fn}</button>
        ))}
        <a href={c.sources.factsUrl} target="_blank" rel="noreferrer" className="ml-auto text-[10px] text-muted hover:text-info">XBRL source ↗</a>
      </div>
    </div>
  );
}
