"use client";

import type { Command } from "@/lib/functions";
import type { AssetRow } from "@/lib/terminal/markets";
import type { Deal, Mover } from "@/lib/market/fmp";
import { Sparkline } from "@/components/charts/Sparkline";
import { AiRead, AskAi, BarList, DataTable, fn, fp, Frame, fsp, Heat, Hint, Section, Tile, Tiles, tone, useTerminal, Why, type Column } from "../kit";

type Props = { onRun?: (c: Command) => void; ticker?: string };

const px = (v: number | null) => (v === null ? "—" : Math.abs(v) >= 1000 ? v.toLocaleString("en-US", { maximumFractionDigits: 0 }) : v >= 10 ? v.toFixed(2) : v.toFixed(4));

/** The columns every cross-asset board shares: level, moves over five horizons as heat, volatility and the day's move in standard deviations. */
function assetColumns(extra: Column<AssetRow>[] = []): Column<AssetRow>[] {
  return [
    ...extra,
    { key: "name", label: "Name", align: "left", value: (r) => r.name, render: (r) => <span><span className="text-fg">{r.name}</span> <span className="num text-[10px] text-faint">{r.symbol}</span>{r.via && <span className="ml-1 rounded border border-line px-1 text-[9.5px] text-muted" title={r.via === "AI research" ? "Latest level researched on the web; no history" : r.via === "ECB fixing" ? "The ECB's daily reference rate" : `Returns of the ${r.via} ETF, which tracks it; the level shown is the ETF's`}>via {r.via}</span>}</span> },
    { key: "price", label: "Last", value: (r) => r.price, render: (r) => px(r.price) },
    { key: "d1", label: "1D", value: (r) => r.d1, render: (r) => <Heat v={r.d1} scale={0.02} /> },
    { key: "z", label: "1D in σ", title: "The day's move divided by the asset's typical daily move over the last year", value: (r) => r.z, render: (r) => <span className={r.z !== null && Math.abs(r.z) >= 2 ? "font-semibold text-chart-emphasis" : "text-muted"}>{r.z === null ? "—" : `${r.z >= 0 ? "+" : ""}${r.z.toFixed(1)}σ`}</span> },
    { key: "w1", label: "1W", value: (r) => r.w1, render: (r) => <Heat v={r.w1} scale={0.04} /> },
    { key: "m1", label: "1M", value: (r) => r.m1, render: (r) => <Heat v={r.m1} scale={0.08} /> },
    { key: "ytd", label: "YTD", value: (r) => r.ytd, render: (r) => <Heat v={r.ytd} scale={0.2} /> },
    { key: "y1", label: "1Y", value: (r) => r.y1, render: (r) => <Heat v={r.y1} scale={0.25} /> },
    { key: "vol", label: "Vol", title: "Realized volatility, one year, annualized", value: (r) => r.vol, render: (r) => fp(r.vol, 0) },
    { key: "spark", label: "60 days", sortable: false, value: () => null, render: (r) => <Sparkline values={r.spark} width={70} height={18} stroke={(r.m1 ?? 0) >= 0 ? "var(--pos)" : "var(--neg)"} /> },
  ];
}

function Unusual({ rows }: { rows: AssetRow[] }) {
  const big = rows.filter((r) => r.z !== null && Math.abs(r.z) >= 2).sort((a, b) => Math.abs(b.z ?? 0) - Math.abs(a.z ?? 0));
  if (!big.length) return <div className="text-[11px] text-muted">No move today is unusual for its asset (all within two standard deviations).</div>;
  return <div className="flex flex-wrap gap-1.5 text-[11px]">{big.map((r) => <span key={r.symbol} className="rounded-md border border-chart-emphasis/40 bg-chart-emphasis/10 px-2 py-0.5"><span className="font-semibold">{r.name}</span> <span className={tone(r.d1)}>{fsp(r.d1)}</span> <span className="text-muted">({(r.z ?? 0).toFixed(1)}σ)</span></span>)}</div>;
}

function Board({ fn: key, what, skill, hint, onRun, group }: { fn: "indices" | "fx" | "commodities"; what: string; skill: string; hint: string; onRun?: (c: Command) => void; group?: boolean }) {
  const q = useTerminal<AssetRow[]>(key);
  return (
    <Frame q={q} what={what}>
      {(rows) => {
        const regions = group ? [...new Set(rows.map((r) => r.region ?? ""))] : [""];
        return (
          <div className="flex flex-col gap-3 p-3">
            <Section title="Unusual today" right={<span className="flex gap-1.5"><AiRead fn={key} params={{}} /><AskAi onRun={onRun} ticker="" question={`What is driving ${what} today? Explain the biggest moves relative to their usual volatility.`} /></span>}><Unusual rows={rows} /></Section>
            <Hint skill={skill}>{hint}</Hint>
            {regions.map((region) => (
              <Section key={region || "all"} title={region || what}>
                <DataTable rows={rows.filter((r) => !group || r.region === region)} rowKey={(r) => r.symbol} columns={assetColumns()} />
              </Section>
            ))}
            <Why items={[["Moves in σ", "The day's return divided by the asset's standard deviation of daily returns over the last year. A 3% day is routine for bitcoin and a shock for the yen; the σ column puts them on one scale."]]} sources={["Quotes and history: Financial Modeling Prep"]} />
          </div>
        );
      }}
    </Frame>
  );
}

export const WeiScreen = ({ onRun }: Props) => <Board fn="indices" what="world indices" skill="WEI" group onRun={onRun} hint="Each row is an index with its moves over five horizons. The σ column says how unusual today's move is for that index; two or more stands out." />;
export const FxcScreen = ({ onRun }: Props) => <Board fn="fx" what="currencies" skill="FXC" onRun={onRun} hint="Pairs quoted as the market does: EURUSD rising means a stronger euro; USDJPY rising means a stronger dollar. Currencies move less than stocks, so a 1% day can be a two-sigma event." />;
export const CmdtyScreen = ({ onRun }: Props) => <Board fn="commodities" what="commodities" skill="CMDTY" onRun={onRun} hint="Front-month futures and spot crypto. Volatility differs by a factor of ten across this list, so read the σ column before the percentage." />;

/** MOST: the most active names and the biggest movers, real companies first. */
export function MostScreen({ onRun }: Props) {
  const q = useTerminal<{ actives: Mover[]; gainers: Mover[]; losers: Mover[] }>("movers");
  const cols: Column<Mover>[] = [
    { key: "symbol", label: "Ticker", align: "left", value: (r) => r.symbol, render: (r) => <span className="num font-semibold text-accent">{r.symbol}</span> },
    { key: "name", label: "Name", align: "left", value: (r) => r.name, render: (r) => <span className="block max-w-[180px] truncate">{r.name}</span> },
    { key: "price", label: "Price", value: (r) => r.price, render: (r) => fn(r.price) },
    { key: "chg", label: "Change", value: (r) => r.changesPercentage, render: (r) => fsp(r.changesPercentage / 100), className: (r) => tone(r.changesPercentage) },
  ];
  const open = (r: Mover) => onRun?.({ ticker: r.symbol, fn: "DES", via: "click" });
  return (
    <Frame q={q} what="market movers">
      {(d) => (
        <div className="flex flex-col gap-3 p-3">
          <div className="flex items-center justify-between gap-2"><Hint skill="MOST">Click a row to open the company. Names under $5 are pushed to the bottom: penny stocks dominate raw gainer lists.</Hint><span className="flex shrink-0 gap-1.5"><AiRead fn="movers" params={{}} /></span></div>
          <div className="grid gap-4 @4xl:grid-cols-3">
            <Section title="Most active"><DataTable rows={d.actives} rowKey={(r) => r.symbol} columns={cols} onRow={open} /></Section>
            <Section title="Gainers"><DataTable rows={d.gainers} rowKey={(r) => r.symbol} columns={cols} onRow={open} /></Section>
            <Section title="Losers"><DataTable rows={d.losers} rowKey={(r) => r.symbol} columns={cols} onRow={open} /></Section>
          </div>
        </div>
      )}
    </Frame>
  );
}

/** SECT: sector performance today, over a month and year to date. */
export function SectScreen({ onRun }: Props) {
  const q = useTerminal<{ date: string; sectors: { sector: string; d1: number; m1: number | null; ytd: number | null }[]; via?: string }>("sectors");
  return (
    <Frame q={q} what="sector performance">
      {(d) => {
        const lead = [...d.sectors].sort((a, b) => (b.ytd ?? -9) - (a.ytd ?? -9));
        return (
          <div className="flex flex-col gap-3 p-3">
            <Tiles>
              <Tile label="Best today" value={d.sectors[0]?.sector ?? "—"} sub={fsp(d.sectors[0]?.d1)} subTone="text-pos" />
              <Tile label="Worst today" value={d.sectors[d.sectors.length - 1]?.sector ?? "—"} sub={fsp(d.sectors[d.sectors.length - 1]?.d1)} subTone="text-neg" />
              <Tile label="Leader, year to date" value={lead[0]?.sector ?? "—"} sub={fsp(lead[0]?.ytd)} />
              <Tile label="Laggard, year to date" value={lead[lead.length - 1]?.sector ?? "—"} sub={fsp(lead[lead.length - 1]?.ytd)} />
              <Tile label="Breadth today" value={`${d.sectors.filter((s) => s.d1 > 0).length}/${d.sectors.length}`} sub="sectors up" />
              <Tile label="As of" value={d.date} sub={d.via ? `via ${d.via}` : undefined} />
            </Tiles>
            <div className="flex justify-end gap-1.5"><AiRead fn="sectors" params={{}} /><AskAi onRun={onRun} ticker="" question="Which sectors are leading and lagging this year, and what does the rotation say about the market's view of growth and rates?" /></div>
            <Hint skill="SECT">Sector returns are the average change of the US-listed stocks in each sector, compounded from daily changes. Leadership that persists over months says more than one day&apos;s ranking.</Hint>
            <div className="grid gap-4 @4xl:grid-cols-3">
              <Section title="Today"><BarList format={(v) => fsp(v, 2)} rows={d.sectors.map((s) => ({ label: s.sector, value: s.d1 }))} /></Section>
              <Section title="Last month"><BarList format={(v) => fsp(v)} rows={[...d.sectors].sort((a, b) => (b.m1 ?? -9) - (a.m1 ?? -9)).map((s) => ({ label: s.sector, value: s.m1 }))} /></Section>
              <Section title="Year to date"><BarList format={(v) => fsp(v)} rows={lead.map((s) => ({ label: s.sector, value: s.ytd }))} /></Section>
            </div>
            <Why items={[["Method", "Financial Modeling Prep's average change per sector for NYSE and Nasdaq, averaged across the two exchanges each day and compounded over the period."]]} sources={["Financial Modeling Prep"]} />
          </div>
        );
      }}
    </Frame>
  );
}

/** MA: the latest merger filings, newest first. */
export function MaScreen({ onRun }: Props) {
  const q = useTerminal<{ deals: Deal[]; via?: string }>("deals");
  return (
    <Frame q={q} what="M&A">
      {(d) => {
        const acquirers = new Map<string, number>();
        for (const x of d.deals) acquirers.set(x.companyName, (acquirers.get(x.companyName) ?? 0) + 1);
        const serial = [...acquirers.entries()].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]).slice(0, 6);
        return (
          <div className="flex flex-col gap-3 p-3">
            <Tiles>
              <Tile label="Filings listed" value={String(d.deals.length)} sub={d.via ? `from ${d.via}` : undefined} />
              <Tile label="Newest" value={d.deals[0]?.acceptedDate?.slice(0, 10) ?? "—"} />
              <Tile label="Public targets" value={String(d.deals.filter((x) => x.targetedSymbol).length)} sub="with a listed ticker" />
            </Tiles>
            {serial.length > 0 && <div className="text-[11px] text-muted">Repeat filers: {serial.map(([n, k]) => `${n} (${k})`).join(" · ")}</div>}
            <Hint skill="MA">These are merger-related SEC filings as they are accepted: announced deals, tender offers and proxy materials. Click a row to open the acquirer; the link goes to the filing.</Hint>
            <DataTable rows={d.deals} rowKey={(r, i) => `${r.symbol}-${r.targetedCik}-${i}`} onRow={(r) => r.symbol && onRun?.({ ticker: r.symbol, fn: "DES", via: "click" })}
              columns={[
                { key: "date", label: "Accepted", align: "left", value: (r) => r.acceptedDate, render: (r) => r.acceptedDate.slice(0, 10) },
                { key: "acq", label: "Acquirer", align: "left", value: (r) => r.companyName, render: (r) => <span><span className="num text-accent">{r.symbol}</span> {r.companyName}</span> },
                { key: "tgt", label: "Target", align: "left", value: (r) => r.targetedCompanyName, render: (r) => <span>{r.targetedCompanyName}{r.targetedSymbol ? <span className="num text-faint"> {r.targetedSymbol}</span> : null}</span> },
                { key: "link", label: "Filing", sortable: false, value: () => null, render: (r) => (r.link ? <a href={r.link} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-info hover:underline">SEC</a> : "") },
              ]} />
          </div>
        );
      }}
    </Frame>
  );
}
