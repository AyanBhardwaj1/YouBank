"use client";

/**
 * FLR: the flaring monitor across every mapped processing plant. Each plant with its owner and ticker,
 * the last seven days of radiant heat as bars, the days it flared, the week's heat, twelve weeks of its
 * record as a sparkline and the change against its average week, and its current card. Live: it asks
 * again every minute, and the hourly flare passes (and the refresh this board triggers when the last is
 * over an hour old) bring new detections. When a pass fails it shows the last good record and says so.
 */
import { useMemo, useState } from "react";
import { useClock } from "@/components/edge/client";
import type { FlrRow, FlrView } from "@/lib/terminal/edge/flr";
import { EdgeCardDrill } from "./EdgeCardDrill";
import { Chip, DASH, Empty, etTime, Fallback, FnLinks, Keys, NavTable, num, pct, shortAgo, signTone, SourceStrip, Spark, SparkBars, Stats, Waiting, useEdgeTerminal, type Col, type Run } from "./edge-kit";

const POLL = 60_000;

function WeekTable({ r, onRun }: { r: FlrRow; onRun: Run }) {
  return (
    <div className="space-y-1.5 p-3 text-[11px]">
      <div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{r.name}</span><span className="text-muted">{r.company || "unmapped operator"}{r.cap ? ` · ${num(r.cap)} MMcfd` : ""}</span><FnLinks ticker={r.ticker} fns={["SAT", "ALT", "GEO"]} onRun={onRun} /></div>
      <div className="flex flex-wrap gap-4">
        <div><div className="text-[10px] uppercase tracking-wider text-muted">Last seven days, MW</div><div className="num">{r.daily.map((v) => (v ? v.toFixed(1) : "·")).join("  ")}</div></div>
        <div><div className="text-[10px] uppercase tracking-wider text-muted">Weeks on record, MW</div><div className="num">{r.weekly.length ? r.weekly.map((v) => v.toFixed(0)).join("  ") : "no record yet"}</div></div>
      </div>
      <p className="text-[10px] text-faint">No flaring card this week: Edge posts one when a plant flares on three days of seven, or two with real heat. The heat is VIIRS fire radiative power within 1.5 km of the plant&apos;s mapped location.</p>
    </div>
  );
}

export function FlrScreen({ onRun }: { onRun: Run }) {
  const [all, setAll] = useState(false);
  const q = useEdgeTerminal<FlrView>("flr", { all: all ? 1 : null }, POLL);
  const now = useClock();
  const cols: Col<FlrRow>[] = useMemo(() => [
    { key: "plant", label: "Plant", align: "left", value: (r) => r.name, render: (r) => <span className="block max-w-[200px] truncate" title={r.name}>{r.card ? <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-chart-emphasis align-middle" title="Flaring card this week" /> : null}{r.name}</span> },
    { key: "owner", label: "Owner", align: "left", value: (r) => r.company, render: (r) => <span className="block max-w-[150px] truncate text-muted" title={r.company}>{r.company || DASH}</span> },
    { key: "tk", label: "Tkr", align: "left", value: (r) => r.ticker || null, render: (r) => (r.ticker ? <button type="button" onClick={(e) => { e.stopPropagation(); onRun({ ticker: r.ticker, fn: "SAT", via: "click" }); }} className="num font-semibold text-accent hover:underline" title={`SAT ${r.ticker}`}>{r.ticker}</button> : <span className="text-faint">{DASH}</span>) },
    { key: "cap", label: "MMcfd", title: "Processing capacity (EIA)", value: (r) => r.cap || null, render: (r) => <span className="text-muted">{r.cap ? num(r.cap) : DASH}</span> },
    { key: "d7", label: "7d", sortable: false, title: "Radiant heat each of the last seven days", render: (r) => <SparkBars values={r.daily} w={56} h={14} label={`${r.name}, last seven days`} /> },
    { key: "days", label: "Days", title: "Days with heat in the last seven", value: (r) => r.daysFlaring, render: (r) => <span className={r.daysFlaring >= 3 ? "font-semibold text-chart-emphasis" : r.daysFlaring ? "" : "text-faint"}>{r.daysFlaring}/7</span> },
    { key: "mw", label: "MW 7d", title: "Radiant heat in the last seven days (MW, summed)", value: (r) => r.frp7, render: (r) => <span className={r.frp7 ? "font-semibold" : "text-faint"}>{r.frp7 ? r.frp7.toFixed(1) : "0"}</span> },
    { key: "w12", label: "12 weeks", sortable: false, title: "Weekly radiant heat on Edge's record, this week last", render: (r) => <Spark values={r.weekly} w={72} h={14} tone={r.vsAvg !== null && r.vsAvg > 1 ? "warn" : "muted"} label={`${r.name}, twelve weeks`} /> },
    { key: "vs", label: "vs avg", title: "The last seven days against the plant's average week before this one", value: (r) => r.vsAvg, render: (r) => <span className={signTone(r.vsAvg === null ? null : -r.vsAvg)} title={r.vsAvg === null ? "No record of heat before this week" : pct(r.vsAvg, 0, true)}>{r.vsAvg === null ? DASH : r.vsAvg >= 1 ? `${(1 + r.vsAvg).toFixed(1)}×` : pct(r.vsAvg, 0, true)}</span> },
    { key: "card", label: "Card", align: "left", sortable: false, render: (r) => (r.card ? <span className="block max-w-[220px] truncate text-muted" title={r.card.title}>{r.card.title}</span> : <span className="text-faint">{DASH}</span>) },
  ], [onRun]);

  if (!q.data) return <Waiting error={q.error} what="the flaring board" />;
  const d = q.data;
  const totalMw = d.rows.reduce((s, r) => s + r.frp7, 0);
  const nextPass = d.pass.nextDue;
  return (
    <div className="flex h-full min-h-0 flex-col" onKeyDown={(e) => { if (e.key === "x" && !(e.target instanceof HTMLInputElement)) { e.preventDefault(); setAll((a) => !a); } }}>
      <Fallback sources={d.sources} error={q.error} asOf={d.asOf} />
      <Stats items={[
        { label: "Plants mapped", value: num(d.plants) },
        { label: "Flaring (7d)", value: d.flaring, tone: d.flaring ? "text-chart-emphasis" : undefined },
        { label: "Heat 7d, MW", value: totalMw ? totalMw.toFixed(0) : "0" },
        { label: "Last pass", value: d.pass.checkedAt ? shortAgo(d.pass.checkedAt, now) : "never", tone: !d.pass.ok ? "text-chart-emphasis" : undefined, title: d.pass.checkedAt ? `${d.pass.by ?? ""} pass at ${etTime(d.pass.checkedAt, now)} ET${d.pass.ok ? "" : "; the last try did not complete"}` : undefined },
        { label: "Newest detection", value: d.pass.newestSpot ? shortAgo(d.pass.newestSpot, now) : DASH, title: d.pass.newestSpot ?? undefined },
        { label: "Next pass due", value: !nextPass ? DASH : now && Date.parse(nextPass) <= now ? "due now" : etTime(nextPass, now), title: "Hourly passes, and a refresh when this board is open and the last pass is over an hour old" },
      ]} />
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-line px-3 py-1 text-[10.5px] text-muted">
        <Chip k="x" active={!all} onClick={() => setAll(false)}>With heat</Chip>
        <Chip k="x" active={all} onClick={() => setAll(true)}>All {num(d.plants)}</Chip>
        <span className="ml-2">Week {d.week} to {d.to}{d.pass.satellites.length ? ` · ${d.pass.satellites.join(", ")}` : ""}</span>
        <span className="ml-auto"><Keys items={[["↑↓", "move"], ["⏎", "open"], ["1-9", "sort"], ["x", "all plants"]]} /></span>
      </div>
      <NavTable label="Flaring by plant" rows={d.rows} cols={cols} rowKey={(r) => String(r.id)} initialSort={{ key: "mw", desc: true }}
        detail={(r) => (r.card ? <EdgeCardDrill id={r.card.id} onRun={onRun} /> : <WeekTable r={r} onRun={onRun} />)}
        empty={<Empty title={!d.plants ? "No plants are mapped yet" : "No plant has flared on Edge's record"}>
          {!d.plants ? "Edge reads EIA's maps of the Permian's gas processing plants the first time Edge opens on a server. Open Edge once, then come back." : <>None of the {num(d.plants)} mapped plants shows VIIRS heat within 1.5 km in the last seven days or on its weekly record. Press <kbd className="rounded border border-line px-1">x</kbd> to list every plant.</>}
        </Empty>} />
      <SourceStrip sources={d.sources} asOf={d.asOf} pollMs={POLL} />
    </div>
  );
}
