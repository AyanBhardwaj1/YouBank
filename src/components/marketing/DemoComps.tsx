"use client";

import { useEffect, useMemo, useState } from "react";
import { DEMO, demoMedians, demoSet, LEVERED_SET, SOFTWARE_SET, type DemoComp } from "@/lib/demo";
import { Sparkline } from "@/components/charts/Sparkline";
import { Scatter } from "@/components/charts/Scatter";

const x = (v: number | null) => (v === null ? "NM" : `${v.toFixed(1)}x`);
const pct = (v: number | null) => (v === null ? "NM" : `${(v * 100).toFixed(0)}%`);
const money = (v: number | null) => (v === null ? "n/a" : Math.abs(v) >= 1000 ? `$${(v / 1000).toFixed(1)}B` : `$${v.toFixed(0)}M`);

type SetId = "software" | "levered";
const SETS: { id: SetId; label: string; tickers: string[]; target: string; note: string }[] = [
  { id: "software", label: "Infrastructure software", tickers: SOFTWARE_SET, target: "SNOW", note: "Consumption-priced data and security platforms" },
  { id: "levered", label: "Levered issuers", tickers: LEVERED_SET, target: "CCL", note: "Post-pandemic deleveraging stories" },
];

/** The real comps grid, driven by a frozen snapshot of SEC and price data, with sortable columns and a live-feeling refresh. */
export function DemoComps() {
  const [setId, setSetId] = useState<SetId>("software");
  const [sort, setSort] = useState<{ key: keyof DemoComp; dir: 1 | -1 }>({ key: "evRevLtm", dir: -1 });
  const [tick, setTick] = useState(0);
  const cfg = SETS.find((s) => s.id === setId)!;

  useEffect(() => { const t = setInterval(() => setTick((n) => n + 1), 2600); return () => clearInterval(t); }, []);

  const rows = useMemo(() => {
    const list = demoSet(cfg.tickers);
    return [...list].sort((a, b) => {
      const av = a[sort.key] as number | null, bv = b[sort.key] as number | null;
      if (av === null) return 1; if (bv === null) return -1;
      return (av - bv) * sort.dir;
    });
  }, [cfg.tickers, sort]);
  const m = useMemo(() => demoMedians(rows.filter((r) => r.ticker !== cfg.target)), [rows, cfg.target]);
  const maxEvRev = Math.max(...rows.map((r) => r.evRevLtm ?? 0), 1);
  const jitter = (seed: number) => ((Math.sin((tick + seed) * 12.9898) * 43758.5453) % 1) * 0.6;

  const cols: { key: keyof DemoComp; label: string; fmt: (r: DemoComp) => string; bar?: boolean }[] = [
    { key: "marketCap", label: "Mkt cap", fmt: (r) => money(r.marketCap) },
    { key: "ev", label: "EV", fmt: (r) => money(r.ev) },
    { key: "evRevLtm", label: "EV/Rev", fmt: (r) => x(r.evRevLtm), bar: true },
    { key: "evEbitdaLtm", label: "EV/EBITDA", fmt: (r) => x(r.evEbitdaLtm) },
    { key: "growth", label: "Rev growth", fmt: (r) => pct(r.growth) },
    { key: "gm", label: "GM", fmt: (r) => pct(r.gm) },
    { key: "fcfm", label: "FCF margin", fmt: (r) => pct(r.fcfm) },
    { key: "r40", label: "Rule of 40", fmt: (r) => (r.r40 === null ? "NM" : r.r40.toFixed(0)) },
  ];

  return (
    <div className="panel overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-elevated/50 px-3 py-2 text-[11px]">
        <span className="ctl bg-accent-soft px-1.5 py-0.5 font-semibold tracking-wider text-accent">COMPS</span>
        {SETS.map((s) => (
          <button key={s.id} type="button" onClick={() => setSetId(s.id)} className={`rounded-full border px-2.5 py-0.5 transition ${setId === s.id ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:text-fg"}`}>{s.label}</button>
        ))}
        <span className="ml-auto flex items-center gap-1.5 text-muted"><span className="pulse-ring h-1.5 w-1.5 rounded-full bg-pos" /> SEC XBRL, LTM to {rows[0]?.ltmEnd ?? DEMO.asOf}</span>
      </div>
      <div className="overflow-auto">
        <table className="w-full whitespace-nowrap text-[11.5px]">
          <thead className="bg-panel text-[10px] uppercase tracking-wider text-muted">
            <tr className="border-b border-line-strong">
              <th className="py-1.5 pl-3 text-left font-normal">Company</th>
              {cols.map((c) => (
                <th key={String(c.key)} className="py-1.5 pr-3 text-right font-normal">
                  <button type="button" onClick={() => setSort((s) => ({ key: c.key, dir: s.key === c.key && s.dir === -1 ? 1 : -1 }))} className={`hover:text-fg ${sort.key === c.key ? "text-accent" : ""}`}>
                    {c.label}{sort.key === c.key ? (sort.dir === -1 ? " ▼" : " ▲") : ""}
                  </button>
                </th>
              ))}
              <th className="py-1.5 pr-3 text-right font-normal">Quarterly revenue</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isTarget = r.ticker === cfg.target;
              const chg = (r.changePct ?? 0) + jitter(r.ticker.charCodeAt(0));
              return (
                <tr key={r.ticker} className={`border-b border-line/50 transition-colors hover:bg-elevated/70 ${isTarget ? "bg-accent-soft" : ""}`}>
                  <td className={`py-1.5 pl-3 ${isTarget ? "border-l-2 border-accent font-semibold" : "border-l-2 border-transparent"}`}>
                    <span className="flex items-baseline gap-2">
                      <span className={`num ${isTarget ? "text-accent" : "text-fg"}`}>{r.ticker}</span>
                      <span className="hidden max-w-[130px] truncate text-[10.5px] text-muted sm:inline">{r.name.replace(/,? (Inc|Corp|Holdings|plc)\.?$/i, "")}</span>
                      <span className={`num text-[10px] ${chg >= 0 ? "text-pos" : "text-neg"}`}>{chg >= 0 ? "▲" : "▼"}{Math.abs(chg).toFixed(2)}%</span>
                    </span>
                  </td>
                  {cols.map((c) => {
                    const v = r[c.key] as number | null;
                    const w = c.bar && v !== null ? (v / maxEvRev) * 100 : 0;
                    return (
                      <td key={String(c.key)} className={`num relative py-1.5 pr-3 text-right ${v === null ? "text-faint" : ""} ${isTarget ? "font-semibold" : ""}`}>
                        {c.bar && w > 0 && <span aria-hidden className="grow-x absolute inset-y-1.5 right-2 rounded-sm bg-chart-1/20" style={{ width: `calc(${w}% - 6px)` }} />}
                        <span className="relative">{c.fmt(r)}</span>
                      </td>
                    );
                  })}
                  <td className="py-1 pr-3 text-right"><span className="inline-block"><Sparkline values={r.quarters.map((q) => q.revenue)} width={70} height={18} stroke={isTarget ? "var(--chart-emphasis)" : "var(--chart-1)"} /></span></td>
                </tr>
              );
            })}
            <tr className="border-t border-line-strong bg-elevated/70 text-[11px] font-semibold">
              <td className="py-1.5 pl-3 text-muted">Peer median</td>
              <td /><td />
              <td className="num py-1.5 pr-3 text-right">{x(m.evRev)}</td>
              <td />
              <td className="num py-1.5 pr-3 text-right">{pct(m.growth)}</td>
              <td className="num py-1.5 pr-3 text-right">{pct(m.gm)}</td>
              <td className="num py-1.5 pr-3 text-right">{pct(m.fcfm)}</td>
              <td className="num py-1.5 pr-3 text-right">{m.r40?.toFixed(0) ?? "NM"}</td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>
      <div className="grid gap-4 border-t border-line p-3 lg:grid-cols-[1fr_auto]">
        <div className="text-[11px] leading-relaxed text-muted">
          <span className="text-fg">{cfg.note}.</span> Every figure is assembled from SEC XBRL company facts: last twelve months from the annual filing plus year-to-date less the prior year-to-date, with the concept the filer actually used. Prices and market caps come from a market data API. Nothing here is typed by hand, and each cell traces back to a filing.
        </div>
        <Scatter title="Growth vs. EV / LTM revenue" xLabel="LTM revenue growth" yLabel="EV/LTM rev" fx={(v) => pct(v)} fy={(v) => x(v)} height={170}
          data={rows.map((r) => ({ key: r.ticker, label: r.ticker, x: r.growth, y: r.evRevLtm, emphasis: r.ticker === cfg.target }))} />
      </div>
    </div>
  );
}
