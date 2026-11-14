"use client";

/**
 * ALT <TICKER>: a company's alternative data on one board, each row against the company's own history.
 * Hiring, web attention, federal awards, WARN layoffs and patents from the Pulse; the Deal Radar's sale
 * odds; recalls and reactor outages from public records; and the prediction markets that move the stock.
 * Every row: the latest reading, its change, its percentile and z-score among the company's earlier
 * readings, a sparkline and its source. Enter opens the series larger with its source.
 */
import { useMemo, useState } from "react";
import { ExternalLink } from "lucide-react";
import { SeriesChart } from "@/components/terminal/kit";
import type { AltFamily, AltRow, AltView } from "@/lib/terminal/edge/alt";
import { big, Chip, DASH, Empty, Fallback, FnLinks, Keys, NavTable, pct, Pctile, signTone, SourceStrip, Spark, Stats, Waiting, Z, useEdgeTerminal, type Col, type Run } from "./edge-kit";

const POLL = 300_000;
const FAMILY: Record<AltFamily, string> = { jobs: "Hiring", attention: "Attention", contracts: "Federal awards", layoffs: "Layoffs", patents: "Patents", odds: "Deal Radar", records: "Public records", markets: "Prediction markets" };
const fmtVal = (r: AltRow, v: number | null) => (v === null ? DASH : r.unit === "probability" ? pct(v, 1) : r.unit === "USD" ? `$${big(v)}` : big(v));

function Detail({ r }: { r: AltRow }) {
  const x = r.x.length === r.spark.length ? r.x : r.spark.map((_, i) => `${i + 1}`);
  return (
    <div className="grid gap-3 p-3 text-[11px] @3xl:grid-cols-[minmax(0,1fr)_260px]">
      <div className="min-w-0">{r.spark.length > 1 ? <SeriesChart x={x} lines={[{ name: r.label, values: r.spark }]} format={(v) => fmtVal(r, v)} height={140} title={r.label} /> : <p className="text-muted">Not enough history to chart.</p>}</div>
      <dl className="grid grid-cols-[96px_1fr] content-start gap-x-2 gap-y-0.5">
        <dt className="text-muted">Latest</dt><dd className="num">{fmtVal(r, r.latest)}{r.period ? <span className="text-faint"> · {r.period}</span> : null}</dd>
        <dt className="text-muted">Before</dt><dd className="num">{fmtVal(r, r.prev)}</dd>
        <dt className="text-muted">Percentile</dt><dd className="num">{r.pctile === null ? DASH : `${Math.round(r.pctile * 100)} of 100, among ${r.n - 1} earlier`}</dd>
        <dt className="text-muted">Z-score</dt><dd><Z z={r.z} /></dd>
        <dt className="text-muted">Source</dt><dd>{r.url ? <a href={r.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">{r.source}<ExternalLink className="h-3 w-3" /></a> : r.source}</dd>
        {r.note ? <><dt className="text-muted">Note</dt><dd className="text-muted">{r.note}</dd></> : null}
      </dl>
    </div>
  );
}

export function AltScreen({ ticker, onRun }: { ticker: string; onRun: Run }) {
  const q = useEdgeTerminal<AltView>("alt", { ticker }, POLL, !!ticker);
  const [family, setFamily] = useState<AltFamily | null>(null);
  const rows = useMemo(() => (q.data?.rows ?? []).filter((r) => !family || r.family === family), [q.data, family]);
  const cols: Col<AltRow>[] = useMemo(() => [
    { key: "fam", label: "Family", align: "left", value: (r) => r.family, render: (r) => <span className="text-[10px] uppercase tracking-wider text-muted">{FAMILY[r.family]}</span> },
    { key: "sig", label: "Signal", align: "left", value: (r) => r.label, render: (r) => <span className="block max-w-[260px] truncate" title={r.note ? `${r.label}. ${r.note}` : r.label}>{r.label}</span> },
    { key: "last", label: "Latest", value: (r) => r.latest, render: (r) => <span className="font-semibold">{fmtVal(r, r.latest)}</span> },
    { key: "chg", label: "Chg", title: "Against the reading before", value: (r) => (r.latest !== null && r.prev ? r.latest / r.prev - 1 : null), render: (r) => { const c = r.latest !== null && r.prev ? r.latest / r.prev - 1 : null; return <span className={signTone(c)}>{r.unit === "probability" && r.latest !== null && r.prev !== null ? `${r.latest - r.prev >= 0 ? "+" : ""}${((r.latest - r.prev) * 100).toFixed(1)}pt` : pct(c, 0, true)}</span>; } },
    { key: "pct", label: "Pctile", title: "Percentile of the latest reading among the company's own earlier ones", value: (r) => r.pctile, render: (r) => <Pctile p={r.pctile} /> },
    { key: "z", label: "Z", title: "Z-score against its own history", value: (r) => (r.z === null ? null : Math.abs(r.z)), render: (r) => <Z z={r.z} /> },
    { key: "spark", label: "History", sortable: false, render: (r) => <Spark values={r.spark} w={84} h={16} tone={r.pctile !== null && (r.pctile >= 0.9 || r.pctile <= 0.1) ? "warn" : "muted"} label={r.label} /> },
    { key: "n", label: "N", title: "Readings on record", value: (r) => r.n, render: (r) => <span className="text-faint">{r.n}</span> },
    { key: "per", label: "As of", value: (r) => r.period, render: (r) => <span className="text-muted">{r.period ?? "live"}</span> },
    { key: "src", label: "Source", align: "left", value: (r) => r.source, render: (r) => <span className="block max-w-[150px] truncate text-faint" title={r.source}>{r.source}</span> },
  ], []);

  if (!ticker) return <Empty title="Give a ticker">Type <span className="num text-accent">ALT NVDA</span> or <span className="num text-accent">NVDA ALT</span>.</Empty>;
  if (!q.data) return <Waiting error={q.error} what={`${ticker}'s alternative data`} />;
  const d = q.data;
  const families = [...new Set(d.rows.map((r) => r.family))];
  const extreme = d.rows.filter((r) => r.pctile !== null && (r.pctile >= 0.9 || r.pctile <= 0.1)).length;
  const odds = d.rows.find((r) => r.family === "odds");
  return (
    <div className="flex h-full min-h-0 flex-col">
      <Fallback sources={d.sources} error={q.error} asOf={d.asOf} />
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-1"><span className="truncate text-[12.5px] font-semibold">{d.name}</span><FnLinks ticker={ticker} fns={["PULSE", "ODDS", "SAT", "EDGE"]} onRun={onRun} /></div>
      <Stats items={[
        { label: "Signals", value: d.rows.length },
        { label: "At extremes", value: extreme, tone: extreme ? "text-chart-emphasis" : undefined, title: "Latest reading in the top or bottom tenth of its own history" },
        { label: "Sale odds (12m)", value: odds ? pct(odds.latest, 1) : DASH },
        { label: "Markets", value: d.rows.filter((r) => r.family === "markets").length },
        { label: "Records", value: d.rows.filter((r) => r.family === "records").reduce((s, r) => s + (r.latest ?? 0), 0), title: "Record cards this month" },
        { label: "Pulse read", value: d.pulseAt ? d.pulseAt.slice(0, 10) : "not yet" },
      ]} />
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-line px-3 py-1">
        <Chip active={!family} onClick={() => setFamily(null)}>All</Chip>
        {families.map((f) => <Chip key={f} active={family === f} onClick={() => setFamily(family === f ? null : f)}>{FAMILY[f]}</Chip>)}
        <span className="ml-auto"><Keys items={[["↑↓", "move"], ["⏎", "chart"], ["1-9", "sort"]]} /></span>
      </div>
      <NavTable label={`${ticker} alternative data`} rows={rows} cols={cols} rowKey={(r) => r.key} detail={(r) => <Detail r={r} />}
        empty={<Empty title={`No alternative data for ${ticker} yet`}>
          {d.inGraph ? <>Edge has {d.name} in its graph but has not read its Pulse (job boards, Wikipedia, USAspending, WARN notices, patents). <button type="button" onClick={() => onRun({ ticker, fn: "PULSE", via: "click" })} className="text-accent hover:underline">PULSE</button> shows what it has; add it to your Pulse list in Edge to read it daily.</> : <>{ticker} is not in Edge&apos;s relationship graph yet, so it has no Pulse series. <button type="button" onClick={() => onRun({ ticker, fn: "NET", via: "click" })} className="text-accent hover:underline">NET</button> reads its filings in.</>}
          {" "}No recall or reactor records name it, and no open prediction market moves it{d.sources.some((s) => s.id.startsWith("predict") && s.status === "down") ? " (or the venues are not answering)" : ""}.
        </Empty>} />
      <SourceStrip sources={d.sources} asOf={d.asOf} pollMs={POLL} />
    </div>
  );
}
