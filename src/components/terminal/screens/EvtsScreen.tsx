"use client";

/**
 * EVTS: the live tape of Edge findings, like Bloomberg's TOP and FIRST for alternative data. Every new
 * card across kinds, newest first: when (New York time), how much it matters, its group, its tickers and
 * what it found. Filter by group (the strip, or ← →), by severity (h for high only), or by the words
 * after EVTS (EVTS FLR, EVTS XOM, EVTS DEAL high). It asks again every 20 seconds; findings that arrive
 * while it is open are marked. Enter opens the full finding; a ticker opens the matching monitor.
 */
import { useMemo, useState } from "react";
import { useClock } from "@/components/edge/client";
import { freshness } from "@/lib/edge/fresh";
import { EVENT_GROUPS, parseTape, type Severity } from "@/lib/terminal/edge-signals";
import type { TapeEvent, EvtsView } from "@/lib/terminal/edge/evts";
import type { FunctionCode } from "@/lib/functions";
import { EdgeCardDrill } from "./EdgeCardDrill";
import { Chip, Empty, etTime, Fallback, Keys, NavTable, Sev, SourceStrip, Stats, Waiting, useEdgeTerminal, type Col, type Run } from "./edge-kit";

const POLL = 20_000;
const GROUP_FN: Record<string, FunctionCode> = { FLR: "SAT", SAT: "SAT", CH4: "SAT", PMT: "SAT", DEAL: "MARB", ALT: "ALT", REC: "ALT", NET: "NET", DOC: "EDGE", QNT: "INSC" };
const GROUP_TONE: Record<string, string> = { FLR: "text-chart-emphasis", SAT: "text-info", CH4: "text-neg", PMT: "text-pos", REC: "text-neg", DEAL: "text-accent", ALT: "text-info", DOC: "text-muted", NET: "text-muted", QNT: "text-muted", OTHER: "text-faint" };
const SEVS: (Severity | null)[] = [null, "medium", "high"];

export function EvtsScreen({ arg, onRun }: { arg?: string; onRun: Run }) {
  const start = useMemo(() => parseTape(arg ?? ""), [arg]);
  const [group, setGroup] = useState<string | null>(start.group);
  const [ticker, setTicker] = useState<string | null>(start.ticker);
  const [severity, setSeverity] = useState<Severity | null>(start.severity);
  const q = useEdgeTerminal<EvtsView>("evts", { group, ticker, q: severity ?? "" }, POLL);
  const now = useClock();
  // The ids on the tape when this filter first loaded: anything newer arrived while it was open.
  const key = `${group}|${ticker}|${severity}`;
  const [first, setFirst] = useState<{ key: string; ids: Set<number> } | null>(null);
  if (q.data && `${q.data.filter.group}|${q.data.filter.ticker}|${q.data.filter.severity}` === key && (!first || first.key !== key)) setFirst({ key, ids: new Set(q.data.events.map((e) => e.id)) });
  const arrived = (e: TapeEvent) => !!first && first.key === key && !first.ids.has(e.id);

  const cols: Col<TapeEvent>[] = [
    { key: "time", label: "Time ET", align: "left", value: (e) => e.detectedAt, render: (e) => { const f = arrived(e) ? "new" : now ? freshness(e.detectedAt, null, now) : null; return <span className="inline-flex items-center gap-1" title={`Found ${e.detectedAt}; observed ${e.at}`}>{etTime(e.detectedAt, now)}{f === "new" && <span className="rounded-sm bg-accent px-0.5 text-[8.5px] font-bold text-accent-fg">NEW</span>}</span>; } },
    { key: "sev", label: "Sev", align: "center", value: (e) => ({ high: 3, medium: 2, low: 1 })[e.severity], render: (e) => <Sev s={e.severity} /> },
    { key: "grp", label: "Grp", align: "left", value: (e) => e.group, render: (e) => <span className={`font-semibold ${GROUP_TONE[e.group] ?? ""}`}>{e.group}</span> },
    { key: "tk", label: "Tickers", align: "left", value: (e) => e.tickers[0] ?? null, render: (e) => <span className="inline-flex gap-1">{e.tickers.slice(0, 3).map((t) => <button key={t} type="button" onClick={(x) => { x.stopPropagation(); onRun({ ticker: t, fn: GROUP_FN[e.group] ?? "EDGE", via: "click" }); }} className="num font-semibold text-accent hover:underline" title={`${t} ${GROUP_FN[e.group] ?? "EDGE"}`}>{t}</button>)}{e.tickers.length > 3 ? <span className="text-faint">+{e.tickers.length - 3}</span> : null}</span> },
    { key: "title", label: "Finding", align: "left", sortable: false, render: (e) => <span className="block max-w-[520px] truncate" title={e.title}>{e.title}</span> },
    { key: "site", label: "Where", align: "left", value: (e) => e.site, render: (e) => <span className="block max-w-[160px] truncate text-muted" title={e.site ?? ""}>{e.site ?? ""}</span> },
    { key: "conf", label: "Conf", value: (e) => e.confidence, render: (e) => <span className="text-faint">{Math.round(e.confidence * 100)}</span> },
  ];

  if (!q.data) return <Waiting error={q.error} what="the Edge tape" />;
  const d = q.data;
  const groups = EVENT_GROUPS.filter((g) => d.groups[g.id]);
  const cycle = (dir: 1 | -1) => { const ids = [null, ...groups.map((g) => g.id)]; const i = ids.indexOf(group); setGroup(ids[(i + dir + ids.length) % ids.length]); };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "ArrowRight") { e.preventDefault(); cycle(1); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); cycle(-1); }
    else if (e.key === "h") { e.preventDefault(); setSeverity((s) => SEVS[(SEVS.indexOf(s) + 1) % SEVS.length]); }
    else if (e.key === "a") { e.preventDefault(); setGroup(null); setSeverity(null); setTicker(null); }
  };
  const hour = d.events.filter((e) => now && now - Date.parse(e.detectedAt) < 3_600_000).length;
  const day = d.events.filter((e) => now && now - Date.parse(e.detectedAt) < 86_400_000).length;
  return (
    <div className="flex h-full min-h-0 flex-col" onKeyDown={onKey}>
      <Fallback sources={d.sources} error={q.error} asOf={d.asOf} />
      <Stats items={[
        { label: "Last hour", value: hour, tone: hour ? "text-accent" : undefined },
        { label: "Last 24h", value: day },
        { label: "30 days", value: d.total },
        { label: "High", value: d.events.filter((e) => e.severity === "high").length, tone: "text-neg" },
        { label: "Showing", value: d.events.length },
        { label: "Filter", value: [group, ticker, severity].filter(Boolean).join(" ") || "all" },
      ]} />
      <div className="no-scrollbar flex shrink-0 items-center gap-1 overflow-x-auto border-b border-line px-3 py-1">
        <Chip active={!group} onClick={() => setGroup(null)}>ALL {d.total}</Chip>
        {groups.map((g) => <Chip key={g.id} active={group === g.id} onClick={() => setGroup(group === g.id ? null : g.id)} title={g.label}>{g.id} {d.groups[g.id]}</Chip>)}
        {d.groups.OTHER ? <Chip active={false} onClick={() => setGroup(null)} title="Kinds not grouped">OTHER {d.groups.OTHER}</Chip> : null}
        <span className="mx-1 h-3 w-px bg-line" />
        <Chip k="h" active={!!severity} onClick={() => setSeverity((s) => SEVS[(SEVS.indexOf(s) + 1) % SEVS.length])}>{severity ? `${severity}+` : "any severity"}</Chip>
        {ticker && <Chip active onClick={() => setTicker(null)} title="Clear the ticker">{ticker} ×</Chip>}
        <span className="ml-auto pl-2"><Keys items={[["←→", "group"], ["h", "severity"], ["a", "all"], ["⏎", "open"]]} /></span>
      </div>
      <NavTable label="Edge findings tape" rows={d.events} cols={cols} rowKey={(e) => String(e.id)} detail={(e) => <EdgeCardDrill id={e.id} onRun={onRun} />}
        rowClass={(e) => (arrived(e) ? "rise bg-accent-soft/40" : e.severity === "high" ? "bg-neg/5" : "")}
        empty={<Empty title="Nothing on the tape">{group || ticker || severity ? <>No finding in the last 30 days matches {[group, ticker, severity && `${severity} or above`].filter(Boolean).join(", ")}. Press <kbd className="rounded border border-line px-1">a</kbd> for everything.</> : <>Edge has posted no finding in the last 30 days{d.sources.some((s) => s.status === "down") ? ", or the database is not answering" : ""}. Flaring and public records are read hourly; satellites, permits and filings daily.</>}</Empty>} />
      <SourceStrip sources={d.sources} asOf={d.asOf} pollMs={POLL} />
    </div>
  );
}
