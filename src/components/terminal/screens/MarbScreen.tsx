"use client";

/**
 * MARB: the merger-arbitrage monitor, after Bloomberg's MA and MARB. Every pending takeover with its
 * offer value (a stock leg marked at the acquirer's price), the target's and acquirer's prices, the
 * gross spread, the spread annualised to the expected close, the odds the price implies, Edge's
 * deal-watch flags on either party, and prediction markets on the deal. Sortable from the keyboard;
 * Enter drills into a deal: its terms, the close estimate's reasoning, the spread since announcement,
 * the flags and markets, and the parties' functions.
 */
import { useMemo, useState } from "react";
import { ExternalLink } from "lucide-react";
import type { MarbRow, MarbView, SpreadHistoryView } from "@/lib/terminal/edge/marb";
import { Chip, DASH, Empty, Fallback, FnLinks, Keys, money, NavTable, pct, Sev, signTone, SourceStrip, Spark, Stats, Waiting, useEdgeTerminal, type Col, type Run } from "./edge-kit";

const POLL = 60_000;
type Filter = "all" | "cash" | "stock" | "mixed" | "flagged" | "markets" | "reported";
const FILTERS: [Filter, string, string][] = [["all", "All", "a"], ["cash", "Cash", "c"], ["stock", "Stock", "s"], ["mixed", "Mixed", "m"], ["flagged", "Flagged", "f"], ["markets", "Markets", "p"], ["reported", "Reported", "r"]];
const CONS: Record<string, string> = { cash: "C", stock: "S", mixed: "M", "": "?" };
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };

function SpreadChart({ r }: { r: MarbRow }) {
  const params = { ticker: r.targetTicker, acquirer: r.acquirerTicker, from: r.announced, cons: r.terms.consideration, cash: r.terms.cash, ratio: r.terms.ratio, stated: r.terms.stated };
  const q = useEdgeTerminal<SpreadHistoryView>("spread", params, 0, !!r.targetTicker && !!r.announced && r.spread.offer !== null);
  if (!r.targetTicker || !r.announced || r.spread.offer === null) return <p className="text-[10.5px] text-muted">No spread history: {r.spread.offer === null ? "the terms are not read yet" : "no target ticker or announcement date"}.</p>;
  if (!q.data) return q.error ? <p className="text-[10.5px] text-muted">The spread history did not load: {q.error}</p> : <div className="shimmer h-16 ctl" />;
  const pts = q.data.points;
  const now = pts.length ? pts[pts.length - 1].spreadPct : null;
  return (
    <div>
      <div className="mb-0.5 flex items-baseline justify-between text-[10px] text-muted"><span>Gross spread since announcement</span><span className="num">{pts.length ? `${pct(pts[0].spreadPct)} → ${pct(now)}` : ""}</span></div>
      {pts.length > 1 ? <Spark values={pts.map((p) => p.spreadPct)} w={300} h={56} tone={now !== null && now > pts[0].spreadPct ? "neg" : "pos"} label="Spread since announcement" /> : null}
      <p className="text-[10px] text-faint">{q.data.note}</p>
    </div>
  );
}

function Detail({ r, onRun }: { r: MarbRow; onRun: Run }) {
  const t = r.terms;
  const lines: [string, string][] = [
    ["Consideration", t.consideration ? `${t.consideration}${t.cvr ? ` plus a CVR (${t.cvr})` : ""}` : "not read yet"],
    ["Cash per share", money(t.cash)], ["Exchange ratio", t.ratio ? `${t.ratio} acquirer shares` : DASH], ["Value stated at signing", money(t.stated)],
    ["Offer value now", `${money(r.spread.offer)} (${r.spread.note})`], ["Unaffected price", r.unaffected ? `${money(r.unaffected)}${r.premium !== null ? `, a ${pct(r.premium, 0)} premium` : ""}` : DASH],
    ["Annualised, compounded", pct(r.spread.annualisedCompound)], ["Expected close", `${r.close.date}${r.close.overdue ? " (past the estimate)" : ""}: ${r.close.why}`],
    ["Approvals", r.approvals.length ? r.approvals.join("; ") : "not read"], ["HSR second request", r.secondRequest ? "yes" : "not reported"],
  ];
  return (
    <div className="grid gap-3 p-3 text-[11px] @3xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12.5px] font-semibold">{r.target} <span className="text-muted">by</span> {r.acquirer || "an unnamed buyer"}</span>
          <FnLinks ticker={r.targetTicker} fns={["DES", "SAT", "ALT", "EDGE"]} onRun={onRun} />
          <FnLinks ticker={r.acquirerTicker} fns={["DES", "ALT"]} onRun={onRun} />
        </div>
        <dl className="grid grid-cols-[150px_1fr] gap-x-2 gap-y-0.5">{lines.map(([k, v]) => <div key={k} className="contents"><dt className="text-muted">{k}</dt><dd className="num">{v}</dd></div>)}</dl>
        <p className="text-[10px] text-faint">Terms from {t.source ?? "nowhere yet"}{r.stage === "reported" ? "; the deal is reported, not signed" : ""}. Implied odds assume the target falls back to its unaffected price if the deal breaks and ignore the time to close. Not advice.</p>
        <div className="flex flex-wrap gap-3">
          {r.url && <a href={r.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">{r.dealId ? "The merger filing" : "The story"}<ExternalLink className="h-3 w-3" /></a>}
          <a href="/app/edge?view=deals" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">Edge deals database<ExternalLink className="h-3 w-3" /></a>
        </div>
      </div>
      <div className="space-y-3">
        <SpreadChart r={r} />
        <section>
          <div className="mb-0.5 text-[10px] uppercase tracking-wider text-muted">Edge risk flags</div>
          {!r.flags.length ? <p className="text-muted">No deal-watch card on either party in 120 days.</p> : (
            <ul className="space-y-0.5">{r.flags.map((f) => <li key={f.id} className="flex items-center gap-1.5"><Sev s={f.severity} short /><span className="text-muted">{f.side || "party"}</span><span className="min-w-0 flex-1 truncate" title={f.title}>{f.title}</span><span className="num text-faint">{f.at.slice(5, 10)}</span></li>)}</ul>
          )}
        </section>
        <section>
          <div className="mb-0.5 text-[10px] uppercase tracking-wider text-muted">Prediction markets</div>
          {!r.markets.length ? <p className="text-muted">No open market on this deal or its regulator.</p> : (
            <ul className="space-y-0.5">{r.markets.map((m) => <li key={m.key} className="flex items-center gap-1.5"><span className="num w-10 text-right font-semibold">{pct(m.prob, 0)}</span><span className={`num w-10 text-right ${signTone(m.change24h)}`}>{m.change24h === null ? "" : `${m.change24h >= 0 ? "+" : ""}${Math.round(m.change24h * 100)}`}</span><a href={m.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate hover:text-accent" title={m.label}>{m.label}</a><span className="text-faint">{m.venue}</span></li>)}</ul>
          )}
        </section>
      </div>
    </div>
  );
}

export function MarbScreen({ onRun }: { onRun: Run }) {
  const q = useEdgeTerminal<MarbView>("marb", {}, POLL);
  const [filter, setFilter] = useState<Filter>("all");
  const rows = useMemo(() => (q.data?.rows ?? []).filter((r) => filter === "all" || (filter === "flagged" ? r.flags.length > 0 : filter === "markets" ? r.markets.length > 0 : filter === "reported" ? r.stage === "reported" : r.consideration === filter)), [q.data, filter]);
  const cols: Col<MarbRow>[] = useMemo(() => [
    { key: "target", label: "Target", align: "left", value: (r) => r.targetTicker || r.target, render: (r) => <span className="flex max-w-[190px] items-baseline gap-1.5"><span className="num font-semibold text-fg">{r.targetTicker || DASH}</span><span className="truncate text-muted" title={r.target}>{r.target}</span>{r.stage === "reported" && <span className="rounded-sm border border-line px-0.5 text-[9px] text-faint" title="Reported, not signed">RPT</span>}</span> },
    { key: "acq", label: "Acquirer", align: "left", value: (r) => r.acquirerTicker || r.acquirer, render: (r) => <span className="flex max-w-[150px] items-baseline gap-1.5"><span className="num font-semibold">{r.acquirerTicker}</span><span className="truncate text-muted" title={r.acquirer}>{r.acquirerTicker ? "" : r.acquirer || DASH}</span></span> },
    { key: "cons", label: "Cons", align: "center", title: "Consideration: C cash, S stock, M mixed", value: (r) => r.consideration, render: (r) => <span className={r.consideration ? "text-fg" : "text-faint"} title={r.terms.consideration || "not read"}>{CONS[r.consideration]}</span> },
    { key: "offer", label: "Offer", title: "Offer value per target share now", value: (r) => r.spread.offer, render: (r) => <span title={r.spread.note} className={r.spread.basis === "stated" ? "text-muted" : ""}>{money(r.spread.offer)}{r.spread.basis === "stated" ? "*" : ""}</span> },
    { key: "tpx", label: "Tgt px", title: "Target's price now (day change)", value: (r) => r.px.target, render: (r) => <span>{money(r.px.target)} <span className={`text-[10px] ${signTone(r.px.targetChg)}`}>{r.px.targetChg === null ? "" : pct(r.px.targetChg, 1, true)}</span></span> },
    { key: "apx", label: "Acq px", title: "Acquirer's price now", value: (r) => r.px.acquirer, render: (r) => <span className="text-muted">{money(r.px.acquirer)}</span> },
    { key: "sprd", label: "Spread", title: "Gross spread in dollars", value: (r) => r.spread.spreadAbs, render: (r) => <span className={signTone(r.spread.spreadAbs)}>{r.spread.spreadAbs === null ? DASH : r.spread.spreadAbs.toFixed(2)}</span> },
    { key: "sp", label: "Sprd %", title: "Gross spread as a share of the target's price", value: (r) => r.spread.spreadPct, render: (r) => <span className={`font-semibold ${signTone(r.spread.spreadPct)}`}>{pct(r.spread.spreadPct, 2)}</span> },
    { key: "ann", label: "Ann %", title: "Spread annualised (simple) to the expected close", value: (r) => r.spread.annualised, render: (r) => <span className={signTone(r.spread.annualised)} title={`Compounded ${pct(r.spread.annualisedCompound)}`}>{pct(r.spread.annualised)}</span> },
    { key: "days", label: "Days", title: "Days to the expected close (e: estimate)", value: (r) => r.close.days, render: (r) => <span className={r.close.overdue ? "text-neg" : ""} title={`${r.close.date}: ${r.close.why}`}>{r.close.days}{r.close.basis === "estimate" ? <span className="text-faint">e</span> : ""}</span> },
    { key: "impl", label: "Impl", title: "Deal odds the price implies, between the unaffected price and the offer", value: (r) => r.spread.implied, render: (r) => <span>{pct(r.spread.implied, 0)}</span> },
    { key: "pm", label: "PM", title: "A prediction market on the deal or its regulator", value: (r) => r.markets[0]?.prob ?? null, render: (r) => (r.markets[0] ? <span title={`${r.markets[0].label} (${r.markets[0].venue})`} className="text-info">{pct(r.markets[0].prob, 0)}</span> : <span className="text-faint">{DASH}</span>) },
    { key: "flags", label: "Flags", title: "Edge deal-watch cards on either party (120 days)", value: (r) => r.flags.length, render: (r) => (r.flags.length ? <span className="inline-flex items-center gap-1"><Sev s={r.flags[0].severity} short />{r.flags.length}</span> : <span className="text-faint">{DASH}</span>) },
    { key: "ann_d", label: "Ann'd", title: "Announced", value: (r) => r.announced, render: (r) => <span className="text-muted">{r.announced?.slice(2) ?? DASH}</span> },
  ], []);

  if (!q.data) return <Waiting error={q.error} what="pending deals" />;
  const d = q.data;
  const priced = d.rows.filter((r) => r.spread.spreadPct !== null);
  const k = (f: Filter) => FILTERS.find((x) => x[0] === f)![2];
  const onKey = (e: React.KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey || e.altKey) return;
    const f = FILTERS.find((x) => x[2] === e.key);
    if (f) { e.preventDefault(); setFilter(f[0]); }
  };
  return (
    <div className="flex h-full min-h-0 flex-col" onKeyDown={onKey}>
      <Fallback sources={d.sources} error={q.error} asOf={d.asOf} />
      <Stats items={[
        { label: "Pending deals", value: d.counts.deals },
        { label: "Priced", value: `${d.counts.priced}/${d.counts.deals}` },
        { label: "Median spread", value: pct(median(priced.map((r) => r.spread.spreadPct!)), 2) },
        { label: "Median ann.", value: pct(median(priced.filter((r) => r.spread.annualised !== null).map((r) => r.spread.annualised!))) },
        { label: "Flagged", value: d.counts.flagged, tone: d.counts.flagged ? "text-neg" : undefined },
        { label: "With markets", value: d.counts.markets },
      ]} />
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-line px-3 py-1">
        {FILTERS.map(([f, label]) => <Chip key={f} k={k(f)} active={filter === f} onClick={() => setFilter(f)}>{label}</Chip>)}
        <span className="ml-auto"><Keys items={[["↑↓", "move"], ["⏎", "drill"], ["1-9", "sort"], ["a c s m f p r", "filter"]]} /></span>
      </div>
      <NavTable label="Pending deals" rows={rows} cols={cols} rowKey={(r) => r.key} initialSort={{ key: "ann", desc: true }} detail={(r) => <Detail r={r} onRun={onRun} />}
        rowClass={(r) => (r.spread.spreadPct !== null && r.spread.spreadPct < 0 ? "bg-neg/5" : "")}
        empty={<Empty title={d.rows.length ? "No deal matches this filter" : "No pending deals"}>{d.rows.length ? "Press a for all deals." : <>Edge lists takeovers announced in the last 18 months that its deals database does not show as completed or terminated, and takeovers the Newsroom recorded in the last nine months. None are pending now{d.sources.some((s) => s.status === "down") ? ", or the sources that hold them are not answering (see below)" : ""}. Recent deals: <button type="button" className="text-accent hover:underline" onClick={() => onRun({ ticker: "", fn: "MA", via: "click" })}>MA</button>.</>}</Empty>} />
      <SourceStrip sources={d.sources} asOf={d.asOf} pollMs={POLL}>
        <span className="text-faint">* stated value, stock not marked · e estimated close · spreads are gross, before dividends and borrow</span>
      </SourceStrip>
    </div>
  );
}
