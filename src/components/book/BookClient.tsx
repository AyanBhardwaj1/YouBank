"use client";

/**
 * The Book (src/lib/book): a fund's positions, each with a thesis written so it can be proved wrong. Every
 * load checks each kill criterion against the company's SEC filings and price and shows the actual value,
 * its period and a link to the source; the thesis reads intact, on watch or broken, most urgent first. The
 * strip at the top is the book's exposure and how much of it rests on a thesis that is close to breaking.
 * A red team (an agent briefed to argue the other side, with sources) can be run on any position.
 */
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { Markdown } from "@/components/terminal/Markdown";
import { errorMessage, fetchJson } from "@/lib/client/errors";
import { actedText, brokenNow, catalystsDue, staleTheses } from "@/lib/book/discipline";
import { streakOf, type BookHistory, type HistoryPoint } from "@/lib/book/alerts";
import { filingLine } from "@/lib/book/filings";
import type { RiskHeadline, SourcedRisk, WhatIf } from "@/lib/book/risk";
import type { Proposal } from "@/lib/book/proposals";
import { CLOSE_REASONS, closedReturn, scorecardLine, type CloseReason, type ClosedPosition, type Scorecard } from "@/lib/book/journal";
import { calibrationLine, MIN_HORIZON_DAYS, type Calibration } from "@/lib/book/forecast";
import { Sparkline } from "@/components/charts/Sparkline";
import { sizingCheck } from "@/lib/book/sizing";
import { priceBaseRate } from "@/lib/book/baserate";
import { toothless } from "@/lib/book/quality";
import { isPmChange, loosened, recentVerdict, type CatalystOutcome, type LogEntry } from "@/lib/book/decisions";
import { processHealth } from "@/lib/book/process";
import { ProcessHealth } from "@/components/book/ProcessHealth";
import { DECISIONS, type Committee, type Decision } from "@/lib/book/committee";
import { isPct, METRIC_KEYS, METRICS, TEMPLATES, type BookSummary, type CheckState, type Evaluation, type MetricKey, type Op, type Position, type Verdict } from "@/lib/book/position";

type BookData = { positions: Position[]; evaluations: Evaluation[]; summary: BookSummary; history?: BookHistory; alerts?: boolean; proposals?: Proposal[]; /** One-year volatility by ticker, when today's risk is worked out. */ vols?: Record<string, number> };

const VERDICT: Record<Verdict, { label: string; cls: string }> = {
  intact: { label: "Intact", cls: "bg-pos/15 text-pos" },
  watch: { label: "On watch", cls: "bg-accent-soft text-accent" },
  broken: { label: "Broken", cls: "bg-neg/15 text-neg" },
  unknown: { label: "No data", cls: "bg-elevated text-muted" },
};
const STATE: Record<CheckState, { label: string; cls: string }> = {
  pass: { label: "holds", cls: "text-pos" },
  near: { label: "close", cls: "text-accent" },
  fail: { label: "failed", cls: "text-neg" },
  unknown: { label: "no data", cls: "text-muted" },
};
const pctOf = (x: number | null, digits = 1) => (x === null ? "n/a" : `${x >= 0 ? "+" : ""}${(x * 100).toFixed(digits)}%`);
const navPct = (x: number) => `${x.toFixed(x % 1 ? 1 : 0)}%`;

/* ---------------- The editor ---------------- */

type Draft = {
  id?: string; ticker: string; direction: "long" | "short"; weight: string; entry: string; thesis: string; pillars: string;
  criteria: { metric: MetricKey; op: Op; value: string; note: string }[]; catalysts: { label: string; date: string }[];
  /** Conviction: % chance no kill criterion fails before the date, and who said so (a proposal keeps its app's). */
  convP: string; convBy: string; convSource?: string; convAt?: string;
};
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const emptyDraft = (): Draft => ({ ticker: "", direction: "long", weight: "", entry: "", thesis: "", pillars: "", criteria: [{ metric: "revenue_growth", op: ">=", value: "", note: "" }], catalysts: [], convP: "", convBy: inDays(90) });
const draftOf = (p: Position): Draft => ({
  id: p.id, ticker: p.ticker, direction: p.direction, weight: p.weight?.toString() ?? "", entry: p.entry?.toString() ?? "", thesis: p.thesis, pillars: p.pillars.join("\n"),
  criteria: p.criteria.map((c) => ({ metric: c.metric, op: c.op, value: String(c.value), note: c.note ?? "" })), catalysts: p.catalysts.map((c) => ({ label: c.label, date: c.date })),
  convP: p.conviction ? String(Math.round(p.conviction.p * 100)) : "", convBy: p.conviction?.by ?? inDays(90), convSource: p.conviction?.source, convAt: p.conviction?.at,
});
const unitHint = (m: MetricKey) => (isPct(m) ? "%" : METRICS[m].unit === "usd" ? "$" : METRICS[m].unit === "usdmm" ? "$M" : METRICS[m].unit === "x" ? "x" : "pts");

const fieldBox = "ctl border border-line bg-bg px-2 py-1.5 text-[12px] placeholder:text-faint focus:border-accent/60 focus:outline-none";
const field = `${fieldBox} w-full`;

/** `heading` replaces the title (a proposal under review: a new position, without the templates). */
function Editor({ initial, onSaved, onCancel, heading, market, proposal, verdict }: { /** The thesis's verdict now, when editing a held position: loosening a criterion while it fails is flagged. */ verdict?: string; initial: Draft; onSaved: () => void; onCancel: () => void; heading?: string; /** Reviewing an AI app's proposal: its id (the server records where the position came from) and the app's reasoning, shown for reference only. */ proposal?: { id: string; from: string; rationale: string }; /** Today's price and one-year volatility for the ticker, when known: the base rate beside the forecast. */ market?: { price: number | null; vol: number | null } }) {
  const [d, setD] = useState<Draft>(initial);
  // Why this change: saved with it into the decision journal (decisions.ts), dated by the server.
  const [why, setWhy] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const [words, setWords] = useState("");
  const [drafting, setDrafting] = useState(false);
  const draftIt = async () => {
    setDrafting(true); setErr("");
    try {
      const { draft } = await fetchJson<{ draft: Position }>("/api/book/draft", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: words }) });
      setD((x) => ({ ...draftOf(draft), id: undefined, weight: x.weight, entry: x.entry }));
    } catch (e) { setErr(errorMessage(e)); } finally { setDrafting(false); }
  };
  const save = async () => {
    // A new or changed conviction needs a date still ahead (an unchanged one keeps the day it was made).
    // A new or changed forecast looks at least 30 days ahead (the server holds the same rule: forecast.ts).
    if (d.convP.trim() && !d.convAt && d.convBy < inDays(MIN_HORIZON_DAYS)) { setErr(`Give the forecast a date at least ${MIN_HORIZON_DAYS} days ahead.`); return; }
    setBusy(true); setErr("");
    try {
      await fetchJson("/api/book", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...d, weight: d.weight || null, entry: d.entry || null, pillars: d.pillars.split("\n"),
          criteria: d.criteria.filter((c) => c.value.trim()).map((c) => ({ ...c, value: Number(c.value) })),
          catalysts: d.catalysts.filter((c) => c.label.trim() && c.date),
          // A conviction you change becomes yours; one left as an app proposed it keeps its source.
          // Unchanged, it keeps the day it was made; changed, it is a new forecast made today.
          conviction: d.convP.trim() ? { p: Number(d.convP), by: d.convBy, source: d.convSource ?? "You", ...(d.convAt ? { at: d.convAt } : {}) } : undefined,
          convP: undefined, convBy: undefined, convSource: undefined, convAt: undefined,
          ...(why.trim() ? { note: why.trim() } : {}),
          ...(proposal ? { fromProposal: proposal.id } : {}),
        }),
      });
      onSaved();
    } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <section className="panel space-y-3 p-4" aria-label={d.id ? "Edit position" : "New position"}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-[13px] font-semibold">{heading ?? (d.id ? `Edit ${d.ticker}` : "New position")}</h2>
        {!d.id && !heading && (
          <div className="ml-auto flex flex-wrap gap-1 text-[11px]">
            <span className="text-muted">Start from:</span>
            {TEMPLATES.map((t) => (
              <button key={t.id} type="button" className="ctl border border-line px-2 py-0.5 text-muted hover:text-fg"
                onClick={() => setD((x) => ({ ...x, direction: t.direction, thesis: x.thesis || t.thesis, criteria: t.criteria.map((c) => ({ metric: c.metric, op: c.op, value: String(c.value), note: "" })) }))}>{t.label}</button>
            ))}
          </div>
        )}
      </div>
      {!d.id && !heading && (
        <div className="ctl border border-line bg-bg/60 p-2.5">
          <label htmlFor="book-words" className="text-[11.5px] font-semibold">Say it in your own words, and YouBank drafts the kill criteria</label>
          <textarea id="book-words" value={words} onChange={(e) => setWords(e.target.value)} maxLength={2000} placeholder="Long Snowflake: AI workloads re-accelerate consumption back above 20% growth, and gross margin has to get past 70%. Out if the stock breaks $150." className={`${field} mt-1 min-h-[56px]`} />
          <div className="mt-1.5 flex items-center gap-2">
            <button type="button" disabled={drafting || words.trim().length < 12} onClick={draftIt} className="ctl border border-line px-2.5 py-1 text-[12px] hover:border-accent/60 disabled:opacity-50">{drafting ? "Drafting…" : "Draft it"}</button>
            <span className="text-[11px] text-muted">Fills the form below to check and change; nothing is saved until you save. Thresholds it chose are marked &ldquo;suggested&rdquo;.</span>
          </div>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <label className="text-[11px] text-muted">Ticker<input className={field} value={d.ticker} onChange={(e) => set("ticker", e.target.value.toUpperCase())} placeholder="SNOW" disabled={!!d.id} /></label>
        <label className="text-[11px] text-muted">Side
          <select className={field} value={d.direction} onChange={(e) => set("direction", e.target.value as Draft["direction"])}><option value="long">Long</option><option value="short">Short</option></select>
        </label>
        <label className="text-[11px] text-muted">Weight (% of NAV)<input className={field} inputMode="decimal" value={d.weight} onChange={(e) => set("weight", e.target.value)} placeholder="4.5" /></label>
        <label className="text-[11px] text-muted">Entry price ($)<input className={field} inputMode="decimal" value={d.entry} onChange={(e) => set("entry", e.target.value)} placeholder="150" /></label>
      </div>
      <label className="block text-[11px] text-muted">Thesis, in one line<input className={field} value={d.thesis} maxLength={280} onChange={(e) => set("thesis", e.target.value)} placeholder="Consumption growth re-accelerates as AI workloads land." /></label>
      <label className="block text-[11px] text-muted">Pillars: why it works, one per line<textarea className={`${field} min-h-[64px]`} value={d.pillars} onChange={(e) => set("pillars", e.target.value)} placeholder={"AI data workloads move to the platform\nNet retention bottoms this year"} /></label>
      <div className="flex flex-wrap items-center gap-1.5 text-[11.5px] text-muted">
        <span>Conviction:</span>
        <input aria-label="Conviction, % chance" value={d.convP} onChange={(e) => setD((x) => ({ ...x, convP: e.target.value, convSource: undefined, convAt: undefined }))} inputMode="numeric" placeholder="70" className={`${fieldBox} w-16`} />
        <span>% chance no kill criterion fails before</span>
        <input aria-label="Conviction date" type="date" value={d.convBy} onChange={(e) => setD((x) => ({ ...x, convBy: e.target.value, convSource: undefined, convAt: undefined }))} className={`${fieldBox} w-40`} />
        {(() => {
          const pos = { direction: d.direction, entry: d.entry ? Number(d.entry) : null, criteria: d.criteria.filter((c) => c.value.trim() && Number.isFinite(Number(c.value))).map((c, k) => ({ id: `d${k}`, metric: c.metric, op: c.op, value: Number(c.value) })) };
          const base = market ? priceBaseRate(pos, market.price, market.vol, d.convBy, new Date()) : null;
          return base ? <span className="basis-full text-[11px] text-fg sm:basis-auto">Base rate from price alone: <span className="font-semibold">{Math.round(base.p * 100)}%</span> that the price line{base.lines === 1 ? " holds" : "s hold"} to that date. Start there, then adjust for the fundamentals.</span> : null;
        })()}
        <span className="basis-full text-[11px] sm:basis-auto">Optional. YouBank scores it when it resolves, so the track record shows how well calibrated the book&apos;s conviction is{d.convSource && d.convSource !== "You" ? ` (this one is ${d.convSource}'s)` : ""}.</span>
      </div>
      <div>
        <div className="mb-1 flex items-baseline justify-between"><h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted">Kill criteria</h3><span className="text-[10.5px] text-muted">Checked against SEC filings and the price on every load</span></div>
        <div className="space-y-1.5">
          {d.criteria.map((c, i) => (
            <div key={i} className="flex flex-wrap items-center gap-1.5">
              <select aria-label="Metric" className={`${fieldBox} min-w-[12rem] flex-1`} value={c.metric} onChange={(e) => set("criteria", d.criteria.map((x, j) => (j === i ? { ...x, metric: e.target.value as MetricKey } : x)))}>
                {METRIC_KEYS.map((m) => <option key={m} value={m}>{METRICS[m].label}</option>)}
              </select>
              <select aria-label="Condition" className={`${fieldBox} w-auto`} value={c.op} onChange={(e) => set("criteria", d.criteria.map((x, j) => (j === i ? { ...x, op: e.target.value as Op } : x)))}>
                <option value=">=">at least</option><option value="<=">at most</option>
              </select>
              <input aria-label="Threshold" className={`${fieldBox} w-24`} inputMode="decimal" value={c.value} onChange={(e) => set("criteria", d.criteria.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} placeholder={unitHint(c.metric)} />
              <span className="w-6 text-[11px] text-muted">{unitHint(c.metric)}</span>
              <button type="button" aria-label="Remove criterion" className="text-muted hover:text-neg" onClick={() => set("criteria", d.criteria.filter((_, j) => j !== i))}><Icon name="X" className="h-3.5 w-3.5" /></button>
              {c.note && <span className={`w-full pl-1 text-[10.5px] ${/^suggested/i.test(c.note) ? "text-accent" : "text-muted"}`}>{c.note}</span>}
            </div>
          ))}
          {d.criteria.length < 8 && <button type="button" className="text-[11.5px] text-accent" onClick={() => set("criteria", [...d.criteria, { metric: "gross_margin", op: ">=", value: "", note: "" }])}>+ Add a kill criterion</button>}
        </div>
      </div>
      <div>
        <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">Catalysts</h3>
        <div className="space-y-1.5">
          {d.catalysts.map((c, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <input aria-label="Catalyst" className={`${fieldBox} min-w-[10rem] flex-1`} value={c.label} onChange={(e) => set("catalysts", d.catalysts.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} placeholder="Q3 earnings" />
              <input aria-label="Date" type="date" className={`${fieldBox} w-40`} value={c.date} onChange={(e) => set("catalysts", d.catalysts.map((x, j) => (j === i ? { ...x, date: e.target.value } : x)))} />
              <button type="button" aria-label="Remove catalyst" className="text-muted hover:text-neg" onClick={() => set("catalysts", d.catalysts.filter((_, j) => j !== i))}><Icon name="X" className="h-3.5 w-3.5" /></button>
            </div>
          ))}
          {d.catalysts.length < 8 && <button type="button" className="text-[11.5px] text-accent" onClick={() => set("catalysts", [...d.catalysts, { label: "", date: "" }])}>+ Add a catalyst</button>}
        </div>
      </div>
      {proposal?.rationale && <p className="text-[11px] text-muted"><span className="font-semibold">{proposal.from}&apos;s reasoning</span> (kept in the journal in its name): {proposal.rationale}</p>}
      {(() => {
        if (!initial.id || (verdict !== "broken" && verdict !== "watch")) return null;
        // As the server reads them: a blank value is no line at all.
        const lines = (x: Draft) => ({ criteria: x.criteria.filter((c) => c.value.trim()).map((c) => ({ metric: c.metric, op: c.op, value: Number(c.value) })).filter((c) => Number.isFinite(c.value)) });
        if (d.direction !== initial.direction) return null;
        const xs = loosened(lines(initial), lines(d));
        return xs.length ? <p role="status" className="text-[11.5px] text-neg">The thesis reads {verdict === "broken" ? "broken" : "on watch"}, and this loosens its kill criteria ({xs.join("; ")}). That can be right, but it looks like moving the goalposts later: say why below.</p> : null;
      })()}
      <label className="block text-[11px] text-muted">Why? Optional, kept in the position&apos;s decision journal with today&apos;s date
        <input value={why} onChange={(e) => setWhy(e.target.value)} maxLength={500} placeholder="e.g. sizing up after the call: margins guided above 70%" className={field} />
      </label>
      {err && <p role="alert" className="text-[12px] text-neg">{err}</p>}
      <div className="flex gap-2">
        <button type="button" disabled={busy || !d.ticker.trim() || !d.thesis.trim()} onClick={save} className="ctl bg-accent px-3 py-1.5 text-[12px] font-semibold text-accent-fg disabled:opacity-50">{busy ? "Saving…" : "Save position"}</button>
        <button type="button" onClick={onCancel} className="ctl px-3 py-1.5 text-[12px] text-muted hover:text-fg">Cancel</button>
      </div>
    </section>
  );
}

/* ---------------- The decision journal ---------------- */

/** Passed catalysts not yet reviewed: did each play out as the thesis expected? Written to the journal by the server. */
function CatalystReviews({ position, onChanged }: { position: Position; onChanged?: () => void }) {
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const due = catalystsDue(position);
  if (!due.length) return null;
  const review = async (catalystId: string, outcome: CatalystOutcome) => {
    setBusy(catalystId); setErr("");
    try { await fetchJson("/api/book/catalyst", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: position.id, catalystId, outcome }) }); onChanged?.(); }
    catch (x) { setErr(errorMessage(x)); } finally { setBusy(""); }
  };
  return (
    <div className="rounded-md border border-accent/40 p-2.5" aria-label="Catalysts to review">
      <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">Did it play out?</h3>
      <ul className="space-y-1 text-[12px]">
        {due.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="min-w-0 flex-1"><span className="font-semibold">{c.label}</span> <span className="num text-muted">{c.date}</span><span className="text-muted"> ({c.daysAgo} day{c.daysAgo === 1 ? "" : "s"} ago)</span></span>
            {(["yes", "mixed", "no"] as CatalystOutcome[]).map((o) => (
              <button key={o} type="button" disabled={!!busy} onClick={() => review(c.id, o)} className="ctl border border-line px-2 py-0.5 text-[11.5px] text-muted hover:text-fg disabled:opacity-50">{o === "yes" ? "As expected" : o === "mixed" ? "Mixed" : "It didn't"}</button>
            ))}
          </li>
        ))}
      </ul>
      <p className="mt-1 text-[11px] text-muted">Your answer goes in the journal with today&apos;s date; the catalysts that played out become a hit rate in Process health.</p>
      {err && <p role="alert" className="mt-1 text-[11.5px] text-neg">{err}</p>}
    </div>
  );
}

function DecisionJournal({ log, id, readOnly, onChanged }: { log: LogEntry[]; id: string; readOnly: boolean; onChanged?: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [all, setAll] = useState(false);
  if (readOnly && !log.length) return null;
  const shown = all ? [...log].reverse() : [...log].reverse().slice(0, 4);
  // The newest entry is YouBank's record of a change, and the PM has not said why since: ask for it.
  const newest = log.filter(isPmChange).reduce<LogEntry | undefined>((a, x) => (!a || x.at >= a.at ? x : a), undefined);
  const unexplained = newest && !log.some((x) => !x.auto && x.at >= newest.at) ? newest : undefined;
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true); setErr("");
    try { await fetchJson("/api/book/note", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, text }) }); setText(""); onChanged?.(); }
    catch (x) { setErr(errorMessage(x)); } finally { setBusy(false); }
  };
  return (
    <div className="rounded-md border border-line p-2.5" aria-label="Decision journal">
      <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">Decision journal</h3>
      {log.length ? (
        <ul className="space-y-0.5 text-[11.5px]">
          {shown.map((x, i) => <li key={i} className="flex gap-2"><span className="num shrink-0 text-muted">{x.at.slice(0, 10)}</span><span className={x.auto ? "text-muted" : ""}>{x.text}</span></li>)}
        </ul>
      ) : <p className="text-[11.5px] text-muted">Changes to this position are written here as they happen. Add why you made them, so the record shows your reasons, not just your results.</p>}
      {log.length > 4 && <button type="button" onClick={() => setAll((v) => !v)} className="mt-0.5 text-[11px] text-muted hover:text-fg">{all ? "Show fewer" : `Show all ${log.length}`}</button>}
      {!readOnly && (
        <form onSubmit={add} className="mt-1.5 flex gap-1.5">
          <input aria-label="Note for the decision journal" value={text} onChange={(e) => setText(e.target.value)} maxLength={500} placeholder={unexplained ? `Why the ${unexplained.at.slice(0, 10)} change? It has no reason yet` : "Why: e.g. added after the call, margins guided up"} className="ctl min-w-0 flex-1 border border-line bg-bg px-2 py-1 text-[12px] focus:border-accent/60 focus:outline-none" />
          <button type="submit" disabled={busy || !text.trim()} className="ctl border border-line px-2 py-1 text-[11.5px] text-muted hover:text-fg disabled:opacity-50">{busy ? "Saving…" : "Add note"}</button>
        </form>
      )}
      {err && <p role="alert" className="mt-1 text-[11.5px] text-neg">{err}</p>}
    </div>
  );
}

/* ---------------- The AI investment committee ---------------- */

const DECISION_CLS: Record<Decision, string> = { add: "bg-pos/10 text-pos", hold: "bg-elevated text-fg", trim: "bg-accent-soft text-accent", exit: "bg-neg/10 text-neg" };

function CommitteePanel({ c, busy, onRun, direction }: { c: Committee | undefined; busy: string; /** Absent in the team view: read-only. */ onRun?: () => void; direction: "long" | "short" }) {
  const when = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return (
    <div className="rounded-md border border-line p-2.5" aria-label="AI investment committee">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <Icon name="Users" className="h-3.5 w-3.5 text-accent" />
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted">AI investment committee</h3>
        {c && <span className="text-[10.5px] text-muted">{when(c.at)}</span>}
        {onRun && <button type="button" disabled={!!busy} onClick={onRun} className="ml-auto ctl border border-line px-2 py-0.5 text-[11px] text-muted hover:text-fg disabled:opacity-50">{busy === "committee" ? "The committee is sitting… (two to three minutes; you can leave this page)" : c ? "Convene again" : "Convene the committee"}</button>}
      </div>
      {c ? (
        <div className="space-y-1.5 text-[12px]">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`ctl px-2 py-0.5 text-[11px] font-semibold uppercase ${DECISION_CLS[c.decision]}`}>{DECISIONS[c.decision]}</span>
            {c.forecast && <span className="text-[11.5px] text-muted">Chair&apos;s forecast: <span className="font-semibold text-fg">{Math.round(c.forecast.p * 100)}%</span> that no kill criterion fails before {c.forecast.by}{typeof c.baseRate === "number" ? `, starting from a ${Math.round(c.baseRate * 100)}% price base rate` : ""}. Scored in your track record beside your own.</span>}
          </div>
          {c.samples && c.samples.length > 1 && <p className="text-[11px] text-muted" title="Each chair read the same briefs and decided alone; the forecast is their mean in log-odds, the decision the majority">{c.samples.length} chairs sat independently: {c.samples.map((x) => `${DECISIONS[x.decision]} ${Math.round(x.p * 100)}%`).join(" · ")}{new Set(c.samples.map((x) => x.decision)).size > 1 ? ". They split, so treat the call as close." : "."}</p>}
          {c.rationale && <p>{c.rationale}</p>}
          {c.dissent && <p className="text-muted"><span className="font-semibold text-fg">Dissent:</span> {c.dissent}</p>}
          {c.watch.length > 0 && <div><span className="text-[10.5px] font-semibold uppercase tracking-wider text-muted">Watch</span><ul className="list-disc pl-5">{c.watch.map((w, i) => <li key={i}>{w}</li>)}</ul></div>}
          <details className="text-[11.5px]"><summary className="cursor-pointer text-muted hover:text-fg">The brief for ({c.bull.sources.length} source{c.bull.sources.length === 1 ? "" : "s"})</summary><div className="prose-sm mt-1 leading-relaxed"><Markdown text={c.bull.text} sources={c.bull.sources} /></div></details>
          <details className="text-[11.5px]"><summary className="cursor-pointer text-muted hover:text-fg">The brief against ({c.bear.sources.length} source{c.bear.sources.length === 1 ? "" : "s"})</summary><div className="prose-sm mt-1 leading-relaxed"><Markdown text={c.bear.text} sources={c.bear.sources} /></div></details>
          <p className="text-[10.5px] text-muted">Advice, not a trade: nothing in the Book changes. Kept in the research ledger.</p>
        </div>
      ) : <p className="text-[11.5px] text-muted">A {direction === "long" ? "bull" : "short seller"} and a skeptic each write a sourced brief alone, without seeing the other. A chair then weighs both against your kill criteria and recommends add, hold, trim or exit, with a 90-day forecast scored like yours.</p>}
    </div>
  );
}

/* ---------------- A position ---------------- */

function PositionCard({ ev, position, history = [], vol = null, focused, owner, onEdit, onChanged }: { ev: Evaluation; position: Position | undefined; history?: HistoryPoint[]; /** One-year volatility, %, for the price base rate. */ vol?: number | null; focused?: boolean; /** Set in the team view: whose position it is, and the card is read-only. */ owner?: string; onEdit?: () => void; onChanged?: () => void }) {
  const [open, setOpen] = useState(ev.verdict === "broken" || !!focused);
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => { if (focused) ref.current?.scrollIntoView({ block: "start", behavior: "smooth" }); }, [focused]);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const v = VERDICT[ev.verdict];
  const redTeam = async () => {
    setBusy("red"); setErr("");
    try { await fetchJson("/api/book/redteam", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: ev.positionId }) }); onChanged?.(); }
    catch (e) { setErr(errorMessage(e)); } finally { setBusy(""); }
  };
  // The committee sits in the background (two to three minutes): poll until it is done, so leaving the page
  // loses nothing, and pick up a sitting already running when the card opens.
  const watching = useRef(false);
  const follow = useCallback(async () => {
    if (watching.current) return;
    watching.current = true; setBusy("committee");
    try {
      for (let i = 0; i < 80; i++) {
        await new Promise((r) => setTimeout(r, 5000));
        const st = await fetchJson<{ state: string; error?: string }>(`/api/book/committee?id=${encodeURIComponent(ev.positionId)}`);
        if (st.state === "done") { onChanged?.(); return; }
        if (st.state === "failed") { setErr(st.error || "The committee could not finish just now."); return; }
        if (st.state !== "running") return;
      }
      setErr("The committee is still sitting. Its decision will appear here and in the bell when it is done.");
      onChanged?.();
    } catch (e) { setErr(errorMessage(e)); } finally { watching.current = false; setBusy(""); }
  }, [ev.positionId, onChanged]);
  const convene = async () => {
    setErr("");
    try { await fetchJson("/api/book/committee", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: ev.positionId }) }); void follow(); }
    catch (e) { setErr(errorMessage(e)); }
  };
  useEffect(() => {
    if (!open || owner) return;
    let live = true;
    fetchJson<{ state: string }>(`/api/book/committee?id=${encodeURIComponent(ev.positionId)}`).then((st) => { if (live && st.state === "running") void follow(); }).catch(() => {});
    return () => { live = false; };
  }, [open, owner, ev.positionId, follow]);
  // Closing records the position in the track record: exit (the price now unless given), reason and a note.
  const [closing, setClosing] = useState(false);
  const [exitPx, setExitPx] = useState(ev.price !== null ? String(ev.price) : "");
  const [reason, setReason] = useState<CloseReason>(ev.verdict === "broken" ? "thesis_broke" : "target");
  const [note, setNote] = useState("");
  const close = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy("del"); setErr("");
    const exit = Number(exitPx);
    try { await fetchJson("/api/book/journal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: ev.positionId, exit: exitPx.trim() && Number.isFinite(exit) && exit > 0 ? exit : undefined, reason, note }) }); onChanged?.(); }
    catch (x) { setErr(errorMessage(x)); setBusy(""); }
  };
  return (
    <li ref={ref} className={`panel scroll-mt-20 ${focused ? "ring-1 ring-accent/60" : ""}`}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 p-3 text-left">
        <span className="num w-16 text-[13px] font-semibold">{ev.ticker}</span>
        {owner && <span className="ctl bg-elevated px-1.5 py-0.5 text-[10.5px] text-muted">{owner}</span>}
        <span className={`ctl px-1.5 py-0.5 text-[10.5px] font-semibold uppercase ${ev.direction === "long" ? "bg-pos/10 text-pos" : "bg-neg/10 text-neg"}`}>{ev.direction}</span>
        <span className={`ctl px-1.5 py-0.5 text-[10.5px] font-semibold ${v.cls}`}>{v.label}</span>
        <span className="order-last w-full text-[12px] text-muted sm:order-none sm:w-auto sm:min-w-0 sm:flex-1 sm:truncate">{ev.summary}</span>
        <span className="num text-[11.5px] text-muted" title="Weight, % of NAV">{ev.weight !== null ? navPct(ev.weight) : "—"}</span>
        <span className="num w-20 text-right text-[11.5px]">{ev.price !== null ? `$${ev.price.toFixed(2)}` : "—"}</span>
        <span className={`num w-16 text-right text-[11.5px] ${ev.pnl === null ? "text-muted" : ev.pnl >= 0 ? "text-pos" : "text-neg"}`} title="Since entry, in the position's favour">{pctOf(ev.pnl)}</span>
        <span className="num w-10 text-right text-[11px] text-muted" title="Share of kill criteria holding with room">{ev.score ?? "—"}</span>
      </button>
      {open && (
        <div className="space-y-3 border-t border-line p-3 text-[12px]">
          <div>
            <div className="text-[11px] text-muted">{ev.name}</div>
            <p className="mt-0.5 text-[13px]">{position?.thesis}</p>
            {position?.conviction && <p className="mt-0.5 text-[11.5px] text-muted">Conviction: <span className="font-semibold text-fg">{Math.round(position.conviction.p * 100)}%</span> that no kill criterion fails before {position.conviction.by}, set {position.conviction.at}{position.conviction.source !== "You" ? ` (${position.conviction.source})` : ""}</p>}
            {(() => {
              const by = position?.conviction?.by ?? inDays(90);
              const base = position ? priceBaseRate(position, ev.price, vol, by, new Date()) : null;
              return base ? <p className="mt-0.5 text-[11.5px] text-muted" title="The chance the price never touches a price line in the kill criteria before the date, as a driftless random walk with the stock's one-year volatility. Fundamentals are not included.">Base rate from price alone: <span className="font-semibold text-fg">{Math.round(base.p * 100)}%</span> that the price line{base.lines === 1 ? " holds" : "s hold"} to {by} ({vol}% volatility, no drift; fundamentals not included).</p> : null;
            })()}
            {position && !position.conviction && !owner && onEdit && <p className="mt-0.5 text-[11.5px] text-muted">No forecast yet. <button type="button" onClick={onEdit} className="text-accent hover:underline">Add a forecast</button> (how sure you are its kill criteria hold, and until when) and YouBank scores it.</p>}
            {!!position?.pastForecasts?.length && <p className="mt-0.5 text-[11px] text-muted" title={position.pastForecasts.map((f) => `${Math.round(f.p * 100)}% to ${f.by}, set ${f.at} (${f.source})`).join("\n")}>{position.pastForecasts.length} earlier forecast{position.pastForecasts.length === 1 ? " was" : "s were"} changed and {position.pastForecasts.length === 1 ? "is" : "are"} still scored at {position.pastForecasts.length === 1 ? "its" : "their"} own date{position.pastForecasts.length === 1 ? "" : "s"}.</p>}
            {(() => {
              const st = streakOf(history, new Date());
              const scores = history.map((h) => h.s).filter((x): x is number => x !== null);
              if (!st) return null;
              const word = st.verdict === "intact" ? "Intact" : st.verdict === "watch" ? "On watch" : "Broken";
              return (
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[11.5px] text-muted">
                  <span>{st.days === 0 ? `${word} since today` : `${word} for ${st.days} day${st.days === 1 ? "" : "s"} (since ${st.since})`} · {history.length} daily check{history.length === 1 ? "" : "s"}</span>
                  {scores.length > 1 && <Sparkline values={scores} width={96} height={18} stroke={st.verdict === "broken" ? "var(--neg)" : st.verdict === "watch" ? "var(--accent)" : "var(--pos)"} />}
                  {(() => {
                    // Broken: has anything been done since (a resize or a change of side, from the journal)?
                    const b = position ? brokenNow([position], { [position.id]: history })[0] : undefined;
                    if (!b) return null;
                    return b.actedAfter === null
                      ? <span className="font-semibold text-neg">Nothing done since the break</span>
                      : <span>{actedText(b).replace(/^./, (c) => c.toUpperCase())}</span>;
                  })()}
                </div>
              );
            })()}
            {(() => {
              const st = position ? staleTheses([position])[0] : undefined;
              return st ? <p className="mt-1 text-[11.5px] text-accent">Not reviewed {owner ? `by ${owner} ` : ""}since {st.since} ({st.days} days).{owner ? "" : " A note saying the thesis still holds, or why it changed, keeps it owned."}</p> : null;
            })()}
            {!!position?.pillars.length && <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted">{position.pillars.map((p) => <li key={p}>{p}</li>)}</ul>}
          </div>
          {ev.checks.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-[11.5px]">
                <thead><tr className="text-left text-[10.5px] uppercase tracking-wider text-muted"><th className="py-1 font-medium">Kill criterion</th><th className="font-medium">Now</th><th className="font-medium">Needs</th><th className="font-medium" title="How far the figure is from breaking the criterion">Room</th><th className="font-medium">State</th><th className="hidden font-medium sm:table-cell">Evidence</th></tr></thead>
                <tbody>
                  {ev.checks.map((c) => (
                    <tr key={c.criterion.id} className="border-t border-line/60">
                      <td className="py-1 pr-2">{c.label}</td>
                      <td className="num pr-2">{c.evidence ? <a href={c.evidence.url} target="_blank" rel="noreferrer" title={`${c.evidence.source}, ${c.evidence.period}`} className="underline decoration-dotted underline-offset-2 sm:no-underline">{c.shown}</a> : c.shown}</td>
                      <td className="pr-2 text-muted">{c.target}</td>
                      <td className={`num pr-2 ${!c.headroom ? "text-muted" : c.headroom.value < 0 ? "text-neg" : c.state === "near" ? "text-accent" : "text-muted"}`}>{c.headroom?.shown ?? "—"}</td>
                      <td className={`pr-2 font-semibold ${STATE[c.state].cls}`}>{STATE[c.state].label}</td>
                      <td className="hidden text-muted sm:table-cell">{c.evidence ? <a href={c.evidence.url} target="_blank" rel="noreferrer" className="hover:text-fg hover:underline">{c.evidence.source}, {c.evidence.period}</a> : c.note ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {(() => {
            const loose = toothless(ev.checks);
            return loose.length ? <p className="text-[11.5px] text-muted"><span className="font-semibold text-accent">Unlikely ever to fire:</span> {loose.map((x) => `${x.label} (${x.room} of room)`).join("; ")}. A kill criterion that cannot fail does not test the thesis; {owner ? "its owner could tighten it" : "tighten it so it would catch the thesis going wrong"}.</p> : null;
          })()}
          {ev.filing && (
            <div className="ctl border border-line bg-bg/60 p-2.5 text-[12px]">
              <div className="flex flex-wrap items-baseline gap-x-2"><span className="font-semibold">New {ev.filing.form}, filed {ev.filing.filed}</span><a href={ev.filing.url} target="_blank" rel="noreferrer" className="text-[11.5px] text-muted hover:text-fg hover:underline">Open the filing</a></div>
              <p className="mt-0.5 text-muted">{filingLine(ev.filing)}</p>
              {ev.filing.summary.map((x, i) => <p key={i} className="mt-0.5 text-[11.5px] text-muted">{x}</p>)}
            </div>
          )}
          {!!ev.nextPrint?.length && (
            <div className="ctl border border-line p-2.5">
              <h3 className="mb-1 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted"><Icon name="Target" className="h-3.5 w-3.5" />What the next report must show{ev.earnings ? ` · ${ev.earnings.date}${ev.earnings.estimated ? " (est.)" : ""}` : ""}</h3>
              <ul className="space-y-0.5">{ev.nextPrint.map((b) => <li key={b.criterionId} className={b.settled ? "text-muted" : ""}>{b.line}</li>)}</ul>
              <p className="mt-1 text-[11px] text-muted">From the last eight quarters&apos; revenue on SEC XBRL: the quarter that enters the twelve months against the one that leaves.</p>
            </div>
          )}
          {(ev.catalysts.length > 0 || ev.news.length > 0 || !!ev.earnings) && (
            <div className="grid gap-3 sm:grid-cols-2">
              {(ev.catalysts.length > 0 || !!ev.earnings) && (
                <div>
                  <h3 className="mb-1 text-[10.5px] font-semibold uppercase tracking-wider text-muted">Catalysts</h3>
                  <ul className="space-y-0.5">
                    {ev.earnings && <li className="flex justify-between gap-2"><span>Earnings{ev.earnings.estimated ? " (estimated)" : ""}</span><span className="num text-muted">{ev.earnings.date} · {ev.earnings.inDays < 0 ? "yesterday" : ev.earnings.inDays === 0 ? "today" : `in ${ev.earnings.inDays}d`}</span></li>}
                    {ev.catalysts.map((c) => <li key={c.id} className="flex justify-between gap-2"><span>{c.label}</span><span className="num text-muted">{c.date} · {c.inDays < 0 ? `${-c.inDays}d ago` : c.inDays === 0 ? "today" : `in ${c.inDays}d`}</span></li>)}
                  </ul>
                </div>
              )}
              {ev.news.length > 0 && (
                <div>
                  <h3 className="mb-1 text-[10.5px] font-semibold uppercase tracking-wider text-muted">This week in the Newsroom</h3>
                  <ul className="space-y-0.5">{ev.news.map((n) => <li key={n.id} className="truncate"><Link href={`/app/news?story=${n.id}`} className="hover:underline">{n.headline}</Link></li>)}</ul>
                </div>
              )}
            </div>
          )}
          <div className="rounded-md border border-line p-2.5">
            <div className="mb-1 flex items-center gap-2">
              <Icon name="Shield" className="h-3.5 w-3.5 text-accent" />
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted">Red team</h3>
              {position?.redTeam && <span className="text-[10.5px] text-muted">{new Date(position.redTeam.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>}
              {!owner && <button type="button" disabled={!!busy} onClick={redTeam} className="ml-auto ctl border border-line px-2 py-0.5 text-[11px] text-muted hover:text-fg disabled:opacity-50">{busy === "red" ? "Arguing the other side… (about a minute)" : position?.redTeam ? "Run again" : "Argue the other side"}</button>}
            </div>
            {position?.redTeam
              ? <div className="prose-sm text-[12px] leading-relaxed"><Markdown text={position.redTeam.text} sources={position.redTeam.sources} /></div>
              : owner ? <p className="text-[11.5px] text-muted">No red team has been run on this position yet.</p> : <p className="text-[11.5px] text-muted">An agent briefed as a {ev.direction === "long" ? "short seller" : "bull"} makes the strongest sourced case against this thesis, names its weakest pillar, and lists the signals that would prove it wrong. It works alone, so it argues rather than agrees.</p>}
          </div>
          {position && !owner && <CatalystReviews position={position} onChanged={onChanged} />}
          <DecisionJournal log={position?.log ?? []} id={ev.positionId} readOnly={!!owner} onChanged={onChanged} />
          {!owner ? <CommitteePanel c={position?.committee} busy={busy} onRun={convene} direction={ev.direction} /> : position?.committee ? <CommitteePanel c={position.committee} busy="" direction={ev.direction} /> : null}
          {err && <p role="alert" className="text-neg">{err}</p>}
          <div className="flex flex-wrap gap-3 text-[11.5px]">
            {!owner && onEdit && <button type="button" onClick={onEdit} className="text-accent">Edit</button>}
            <Link href={`/app/terminal?ticker=${encodeURIComponent(ev.ticker)}`} className="text-muted hover:text-fg">Open in Terminal</Link>
            <Link href={`/app/edge?view=theses`} className="text-muted hover:text-fg">Investigate with an agent (Edge theses)</Link>
            {!owner && <button type="button" disabled={!!busy} aria-expanded={closing} onClick={() => { if (!closing && ev.price !== null) setExitPx(String(ev.price)); setClosing((c) => !c); }} className="ml-auto text-muted hover:text-neg">Close position</button>}
          </div>
          {closing && !owner && (
            <form onSubmit={close} aria-label={`Close ${ev.ticker}`} className="ctl space-y-2 border border-line p-2.5">
              <p className="text-[12px]">Close {ev.ticker} into the track record. Nothing is traded; the exit, the reason and how its thesis stood are kept for the scorecard.</p>
              <div className="flex flex-wrap items-center gap-1.5">
                <label className="flex items-center gap-1.5 text-[11.5px] text-muted">Exit price ($)<input value={exitPx} onChange={(x) => setExitPx(x.target.value)} inputMode="decimal" className={`${fieldBox} w-24`} placeholder="price" /></label>
                <label className="flex items-center gap-1.5 text-[11.5px] text-muted">Why<select value={reason} onChange={(x) => setReason(x.target.value as CloseReason)} className={`${fieldBox} w-auto`}>{(Object.keys(CLOSE_REASONS) as CloseReason[]).map((k) => <option key={k} value={k}>{CLOSE_REASONS[k]}</option>)}</select></label>
                <input aria-label="Note" value={note} onChange={(x) => setNote(x.target.value)} maxLength={280} placeholder="A line for the record (optional)" className={`${fieldBox} min-w-[12rem] flex-1`} />
              </div>
              <div className="flex gap-2">
                <button type="submit" disabled={!!busy} className="ctl bg-accent px-3 py-1 text-[12px] font-semibold text-accent-fg disabled:opacity-60">{busy === "del" ? "Closing…" : "Close and record"}</button>
                <button type="button" onClick={() => setClosing(false)} className="ctl border border-line px-3 py-1 text-[12px] text-muted hover:text-fg">Cancel</button>
              </div>
            </form>
          )}
        </div>
      )}
    </li>
  );
}

/* ---------------- Getting a book in ---------------- */

type ImportRes = { added: Position[]; skipped: string[]; problems: string[] };

function Importer({ onDone, onCancel }: { onDone: (r: ImportRes) => void; onCancel: () => void }) {
  const [text, setText] = useState("");
  const [template, setTemplate] = useState("auto");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const go = async () => {
    setBusy(true); setErr("");
    try { onDone(await fetchJson<ImportRes>("/api/book/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, template }) })); }
    catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <section className="panel space-y-2.5 p-4" aria-label="Import positions">
      <h2 className="text-[13px] font-semibold">Paste your positions</h2>
      <p className="text-[12px] text-muted">Copy rows from a spreadsheet or your OMS: a ticker, long or short, the weight (% of NAV), the entry price and a thesis, in any order. A header row is fine. Tickers already in the book are kept as they are.</p>
      <textarea value={text} onChange={(e) => setText(e.target.value)} aria-label="Positions" spellCheck={false} placeholder={"NVDA\tLong\t6%\t$118\tData-centre demand stays ahead of supply\nINTC\tShort\t3%\t$31\tFoundry capex burns cash"} className={`${field} num min-h-[120px]`} />
      <label className="flex flex-wrap items-center gap-2 text-[12px] text-muted">Kill criteria to start with
        <select value={template} onChange={(e) => setTemplate(e.target.value)} className={`${fieldBox} w-auto`}>
          <option value="auto">Suggested: growth for longs, deteriorating for shorts</option>
          {TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          <option value="none">None: I will write them</option>
        </select>
      </label>
      {err && <p role="alert" className="text-[12px] text-neg">{err}</p>}
      <div className="flex gap-2">
        <button type="button" disabled={busy || !text.trim()} onClick={go} className="ctl bg-accent px-3 py-1.5 text-[12px] font-semibold text-accent-fg disabled:opacity-50">{busy ? "Importing…" : "Import"}</button>
        <button type="button" onClick={onCancel} className="ctl px-3 py-1.5 text-[12px] text-muted hover:text-fg">Cancel</button>
      </div>
    </section>
  );
}

/* ---------------- Proposed by the person's AI apps ---------------- */

const ago = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  return m < 60 ? `${m || 1} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};

/** What a proposal would do to the book's risk, on request (weight as proposed, else 2% of NAV). */
function ProposalImpact({ p }: { p: Proposal }) {
  const [res, setRes] = useState<WhatIf | null>(null), [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const weight = p.position.weight || 2;
  const run = async () => {
    setBusy(true); setErr("");
    try { setRes(await fetchJson<WhatIf>(`/api/book/risk?add=${encodeURIComponent(p.position.ticker)}&side=${p.position.direction}&weight=${weight}`)); }
    catch (x) { setErr(errorMessage(x)); } finally { setBusy(false); }
  };
  if (res) return <div className="mt-2 ctl border border-line p-2"><WhatIfResult w={res} /></div>;
  return (
    <p className="mt-1 text-[11.5px]">
      <button type="button" onClick={run} disabled={busy} className="text-accent hover:underline disabled:opacity-60">{busy ? "Working out the risk…" : `What would it do to the book's risk${!p.position.weight ? " (at 2% of NAV)" : ""}?`}</button>
      {err && <span role="alert" className="ml-2 text-neg">{err}</span>}
    </p>
  );
}

/** Positions an AI app proposed over MCP: nothing is in the book until the person reviews one and saves it. */
function Proposals({ list, held, focus, onReview, onDismiss }: { list: Proposal[]; held: Set<string>; focus?: string; onReview: (p: Proposal) => void; onDismiss: (p: Proposal) => void }) {
  return (
    <section aria-label="Proposed by your AI apps" className="panel p-4">
      <h2 className="mb-1 flex items-center gap-1.5 text-[13px] font-semibold"><Icon name="Sparkles" className="h-4 w-4 text-accent" />Proposed by your AI apps <span className="font-normal text-muted">· {list.length}</span></h2>
      <p className="mb-2 text-[11.5px] text-muted">Sent from Claude, ChatGPT or another connected app. None of these are in your book: review one to edit and add it, or dismiss it.</p>
      <ul className="space-y-2">
        {list.map((x) => (
          <li key={x.id} className={`ctl border p-3 ${x.id === focus ? "border-accent/60" : "border-line"}`}>
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="text-[13px] font-semibold">{x.position.ticker}</span>
              <span className={`ctl px-1.5 py-0.5 text-[10.5px] font-semibold uppercase ${x.position.direction === "long" ? "bg-pos/15 text-pos" : "bg-neg/15 text-neg"}`}>{x.position.direction}</span>
              {x.position.weight !== null && <span className="num text-[11.5px] text-muted">{navPct(x.position.weight)} of NAV</span>}
              <span className="ml-auto text-[11px] text-muted">from {x.from} · {ago(x.at)}</span>
            </div>
            <p className="mt-1 text-[12.5px]">{x.position.thesis}</p>
            {x.rationale && <p className="mt-0.5 text-[11.5px] text-muted">Why: {x.rationale}</p>}
            {x.position.criteria.length > 0 && <p className="mt-1 text-[11.5px] text-muted">Kill criteria: {x.position.criteria.map((c) => `${METRICS[c.metric].label} ${c.op === ">=" ? "at least" : "at most"} ${c.value}${isPct(c.metric) ? "%" : ""}`).join("; ")}</p>}
            {held.has(x.position.ticker) && <p className="mt-1 text-[11.5px] text-accent">{x.position.ticker} is already in your book; adding this keeps both.</p>}
            <ProposalImpact p={x} />
            <div className="mt-2 flex gap-2">
              <button type="button" onClick={() => onReview(x)} className="ctl bg-accent px-3 py-1 text-[12px] font-semibold text-accent-fg">Review and add</button>
              <button type="button" onClick={() => onDismiss(x)} className="ctl border border-line px-3 py-1 text-[12px] text-muted hover:text-fg">Dismiss</button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ---------------- Risk and stress tests ---------------- */

const signed = (x: number, digits = 2) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x).toFixed(digits)}%`;

/** Before a trade: the book's risk now and with the position added, and what the new name moves with. */
function WhatIfResult({ w }: { w: WhatIf & { missingPrices?: string[] } }) {
  if (w.note) return <p className="text-[12px] text-muted">{w.note}</p>;
  // Red when risk grows: a larger figure, or for beta-adjusted net a larger exposure either way (net short too).
  const row = (label: string, a: number | null, b: number | null, digits = 2, size: (x: number) => number = (x) => x) => {
    const delta = a !== null && b !== null ? b - a : null;
    const grows = a !== null && b !== null ? size(b) - size(a) : 0;
    const tone = delta === null || Math.abs(grows) < 10 ** -digits ? "text-muted" : grows > 0 ? "text-neg" : "text-pos";
    return <tr key={label} className="border-t border-line"><td className="py-1 pr-3">{label}</td><td className="num py-1 pr-3 text-right text-muted">{a === null ? "n/a" : `${a.toFixed(digits)}%`}</td><td className="num py-1 pr-3 text-right font-semibold">{b === null ? "n/a" : `${b.toFixed(digits)}%`}</td><td className={`num py-1 text-right ${tone}`}>{delta === null ? "" : signed(delta, digits)}</td></tr>;
  };
  return (
    <div className="space-y-2 text-[12px]">
      <table className="w-full"><thead><tr className="text-left text-[10.5px] uppercase tracking-wider text-muted"><th className="py-1 font-medium">Adding {w.add.direction} {w.add.ticker} at {navPct(w.add.weight)}</th><th className="py-1 text-right font-medium">Now</th><th className="py-1 text-right font-medium">After</th><th className="py-1 text-right font-medium">Change</th></tr></thead>
        <tbody>
          {row("Beta-adjusted net", w.before.betaNet, w.after.betaNet, 1, Math.abs)}
          {row("1-day VaR (95%)", w.before.var95, w.after.var95)}
          {row("Expected shortfall", w.before.es95, w.after.es95)}
          {w.after.worst && row(`${w.after.worst.label} replay`, w.before.worst?.label === w.after.worst.label ? w.before.worst.pnl : null, w.after.worst.pnl, 2, (x) => -x)}
        </tbody>
      </table>
      {!!w.missingPrices?.length && <p className="text-accent">No prices just now for {w.missingPrices.join(", ")}: left out of these figures.</p>}
      <p className="text-muted">{w.add.ticker}: beta {w.beta?.toFixed(2) ?? "n/a"}, volatility {w.vol?.toFixed(0) ?? "n/a"}% a year. {w.movesWith.length ? <>Moves with {w.movesWith.map((m, i) => <span key={m.ticker}>{i ? ", " : ""}<span className="font-semibold text-fg">{m.ticker}</span> ({m.rho.toFixed(2)}, <span className={m.kind === "stacked" ? "text-accent" : "text-pos"}>{m.kind === "stacked" ? "more of the same bet" : "a hedge"}</span>)</span>)}.</> : "It does not move closely with anything held."}</p>
    </div>
  );
}

function TryAdding() {
  const [t, setT] = useState(""), [side, setSide] = useState<"long" | "short">("long"), [w, setW] = useState("3");
  const [res, setRes] = useState<WhatIf | null>(null), [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const run = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(""); setRes(null);
    try { setRes(await fetchJson<WhatIf>(`/api/book/risk?add=${encodeURIComponent(t.trim())}&side=${side}&weight=${encodeURIComponent(w)}`)); }
    catch (x) { setErr(errorMessage(x)); } finally { setBusy(false); }
  };
  return (
    <div>
      <h3 className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted">Before a trade: what would adding a name do?</h3>
      <form onSubmit={run} className="flex flex-wrap items-center gap-1.5">
        <input aria-label="Ticker" value={t} onChange={(e) => setT(e.target.value)} placeholder="Ticker" className={`${fieldBox} w-24 uppercase`} required maxLength={12} />
        <select aria-label="Side" value={side} onChange={(e) => setSide(e.target.value as "long" | "short")} className={`${fieldBox} w-auto`}><option value="long">Long</option><option value="short">Short</option></select>
        <input aria-label="Weight, % of NAV" value={w} onChange={(e) => setW(e.target.value)} inputMode="decimal" className={`${fieldBox} w-16`} required />
        <span className="text-[11px] text-muted">% of NAV</span>
        <button type="submit" disabled={busy || !t.trim()} className="ctl border border-line px-3 py-1.5 text-[12px] hover:border-accent/50 disabled:opacity-60">{busy ? "Checking…" : "Check"}</button>
      </form>
      {err && <p role="alert" className="mt-2 text-[12px] text-neg">{err}</p>}
      {res && <div className="mt-2"><WhatIfResult w={res} /></div>}
    </div>
  );
}

/** The book's risk from a year of daily closes, and today's book replayed through real sell-offs. Fetched when opened. */
function RiskPanel({ sig, initiallyOpen = false }: { sig: string; initiallyOpen?: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  // The answer for one book (its names, sides and weights): an edit to the book shows the loader again.
  const [res, setRes] = useState<{ sig: string; r?: SourcedRisk; err?: string } | null>(null);
  useEffect(() => {
    if (!open) return;
    let live = true;
    fetchJson<SourcedRisk>("/api/book/risk").then((r) => { if (live) setRes({ sig, r }); }).catch((e) => { if (live) setRes({ sig, err: errorMessage(e) }); });
    return () => { live = false; };
  }, [open, sig]);
  const r = res?.sig === sig ? res.r ?? null : null;
  const err = res?.sig === sig ? res.err ?? "" : "";
  return (
    <section aria-label="Risk and stress tests" className="panel p-4">
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 text-left">
        <Icon name="Activity" className="h-4 w-4 text-accent" />
        <span className="text-[13px] font-semibold">Risk and stress tests</span>
        <span className="min-w-0 flex-1 truncate text-[11.5px] text-muted">Beta, value at risk, bets that move together, and today&apos;s book through past sell-offs</span>
        <Icon name={open ? "ChevronUp" : "ChevronDown"} className="h-4 w-4 text-muted" />
      </button>
      {open && err && <p role="alert" className="mt-3 text-[12px] text-neg">{err}</p>}
      {open && !r && !err && <div className="shimmer mt-3 h-32 ctl" />}
      {open && r && (
        <div className="mt-3 space-y-4">
          {r.betaNet === null ? (
            <p className="text-[12px] text-muted">Not enough price history to measure the book&apos;s risk{r.excluded.length ? ` (${r.excluded.map((e) => `${e.ticker}: ${e.reason}`).join("; ")})` : ""}.</p>
          ) : (<>
            <div className="flex flex-wrap gap-x-6 gap-y-3">
              <Stat label="Beta-adjusted net" value={signed(r.betaNet, 1)} hint="Sum of each position's weight × its beta to the S&P 500 (SPY): how much of NAV moves with the market" />
              <Stat label="Volatility" value={`${r.vol?.toFixed(1)}%`} hint="Annualised, of the book's daily P&L over the last year with today's weights" />
              <Stat label="1-day VaR (95%)" value={`${r.var95?.toFixed(2)}%`} tone="text-neg" hint="A loss the book exceeded on 1 day in 20 over the last year (historical, today's weights), % of NAV" />
              <Stat label="Expected shortfall" value={`${r.es95?.toFixed(2)}%`} tone="text-neg" hint="The average loss on those worst days, % of NAV" />
            </div>
            <div>
              <h3 className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted">If the S&amp;P 500 moves (by beta)</h3>
              <div className="flex flex-wrap gap-1.5">
                {r.shocks.map((x) => <span key={x.move} className="ctl border border-line px-2 py-1 text-[11.5px]"><span className="text-muted">S&amp;P {x.move > 0 ? "+" : "−"}{Math.abs(x.move)}%</span> <span className={`num font-semibold ${x.pnl < 0 ? "text-neg" : "text-pos"}`}>{signed(x.pnl)}</span></span>)}
              </div>
            </div>
          </>)}
          <div>
            <h3 className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted">Today&apos;s book through past sell-offs</h3>
            <ul className="text-[12px]">
              <li className="grid grid-cols-[1fr_4.5rem_4.5rem] gap-2 pb-1 text-[10.5px] uppercase tracking-wider text-muted" aria-hidden><span>Episode</span><span className="text-right">Book</span><span className="text-right">S&amp;P 500</span></li>
              {r.scenarios.map((x) => (
                <li key={x.id} className="grid grid-cols-[1fr_4.5rem_4.5rem] gap-x-2 border-t border-line py-1.5">
                  <span className="min-w-0"><span className="font-medium">{x.label}</span> <span className="whitespace-nowrap text-[11px] text-muted">{x.from} to {x.to}</span></span>
                  <span className={`num text-right font-semibold ${x.pnl === null ? "text-muted" : x.pnl < 0 ? "text-neg" : "text-pos"}`}>{x.pnl === null ? "n/a" : signed(x.pnl)}</span>
                  <span className="num text-right text-muted">{x.market === null ? "n/a" : signed(x.market, 1)}</span>
                  {(x.worst.length > 0 || x.missing.length > 0) && (
                    <span className="col-span-3 text-[11.5px] text-muted">{x.worst.length ? `Hit hardest: ${x.worst.map((w) => `${w.ticker} ${signed(w.pnl)}`).join(", ")}` : ""}{x.missing.length ? <span className="text-muted">{x.worst.length ? " · " : ""}not trading then: {x.missing.join(", ")}</span> : null}</span>
                  )}
                </li>
              ))}
            </ul>
            <p className="mt-1 text-[11px] text-muted">Each name&apos;s own price move over the episode times today&apos;s weight; % of NAV. Names that were not trading then are left out, not counted as flat.</p>
          </div>
          {r.pairs.length > 0 && (
            <div>
              <h3 className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted">Names that move together</h3>
              <ul className="space-y-1 text-[12px]">
                {r.pairs.map((x) => (
                  <li key={`${x.a}-${x.b}`} className="flex flex-wrap gap-x-2">
                    <span className="font-semibold">{x.a} + {x.b}</span>
                    <span className="num text-muted">correlation {x.rho.toFixed(2)}</span>
                    <span className={x.kind === "stacked" ? "text-accent" : "text-pos"}>{x.kind === "stacked" ? `one bet in two tickets: ${navPct(x.weight)} of NAV` : x.rho > 0 ? `a hedge: the short offsets the long (${navPct(x.weight)} gross)` : `a hedge: they move opposite ways (${navPct(x.weight)} gross)`}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {r.positions.length > 0 && (
            <div>
              <h3 className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted">Where the risk is</h3>
              <ul className="space-y-1 text-[12px]">
                {r.positions.map((x) => {
                  const share = x.riskShare ?? 0;
                  return (
                    <li key={x.ticker} className="grid grid-cols-[4rem_1fr] items-center gap-x-3 sm:grid-cols-[4rem_1fr_auto]">
                      <span className="font-semibold">{x.ticker}</span>
                      <span className="h-2.5 rounded-sm bg-elevated" aria-hidden><span className={`block h-2.5 rounded-sm ${share < 0 ? "bg-pos/70" : "bg-accent/70"}`} style={{ width: `${Math.min(100, Math.abs(share))}%` }} /></span>
                      <span className="num col-span-2 text-[11.5px] text-muted sm:col-span-1 sm:whitespace-nowrap sm:text-right sm:text-[12px]">{x.riskShare === null ? "n/a" : `${share.toFixed(0)}% of risk`} · {x.direction} {navPct(x.weight)} · β {x.beta?.toFixed(2) ?? "n/a"} · vol {x.vol?.toFixed(0) ?? "n/a"}%</span>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-1 text-[11px] text-muted">Each name&apos;s share of the book&apos;s variance; a negative share is a position that lowers the book&apos;s risk.</p>
            </div>
          )}
          <TryAdding />
          <p className="text-[11px] text-muted">
            {r.window ? `Daily closes ${r.window.from} to ${r.window.to} (${r.window.days} days)` : "Daily closes"}{r.sources.length ? `, from ${r.sources.join(", ")}` : ""}.
            {r.excluded.length > 0 && ` Left out: ${r.excluded.map((e) => `${e.ticker} (${e.reason})`).join(", ")}.`}
            {" "}Historical figures with today&apos;s weights; not a forecast.
          </p>
        </div>
      )}
    </section>
  );
}

/** The Book's exports in one menu: the IC / LP report, the LP letter, the AI DDQ answers, CSV and the calendar. */
function ExportMenu() {
  const item = "flex items-center gap-2 ctl px-2.5 py-1.5 text-[12px] hover:bg-elevated";
  return (
    <details className="group relative">
      <summary className="ctl flex cursor-pointer list-none items-center gap-1.5 border border-line px-3 py-1.5 text-[12px] text-muted hover:text-fg [&::-webkit-details-marker]:hidden"><Icon name="Share2" className="h-3.5 w-3.5" />Share &amp; export<Icon name="ChevronDown" className="h-3.5 w-3.5 transition-transform group-open:rotate-180" /></summary>
      <div className="panel absolute left-0 z-20 mt-1 w-64 max-w-[calc(100vw-2rem)] p-1 shadow-lg sm:left-auto sm:right-0">
        <Link href="/report/book" className={item}><Icon name="FileText" className="h-3.5 w-3.5 text-muted" /><span><span className="block">IC / LP report</span><span className="block text-[11px] text-muted">Printable, with risk and the track record</span></span></Link>
        <Link href="/report/letter" className={item}><Icon name="Newspaper" className="h-3.5 w-3.5 text-muted" /><span><span className="block">LP letter</span><span className="block text-[11px] text-muted">A draft, with a compliance pass</span></span></Link>
        <Link href="/report/week" className={item}><Icon name="Calendar" className="h-3.5 w-3.5 text-muted" /><span><span className="block">The week in your book</span><span className="block text-[11px] text-muted">What changed, resolved and is coming</span></span></Link>
        <Link href="/report/ddq" className={item}><Icon name="Shield" className="h-3.5 w-3.5 text-muted" /><span><span className="block">AI due-diligence answers</span><span className="block text-[11px] text-muted">The AI questions LPs ask, from your record</span></span></Link>
        <a href="/api/book/export" download className={item}><Icon name="Download" className="h-3.5 w-3.5 text-muted" /><span><span className="block">CSV</span><span className="block text-[11px] text-muted">One row per kill criterion</span></span></a>
        <a href="/api/book/calendar" download className={item}><Icon name="Calendar" className="h-3.5 w-3.5 text-muted" /><span><span className="block">Calendar (.ics)</span><span className="block text-[11px] text-muted">Earnings dates and catalysts</span></span></a>
      </div>
    </details>
  );
}

/* ---------------- The track record ---------------- */

type JournalData = { closed: ClosedPosition[]; scorecard: Scorecard; calibration?: Calibration };
const pctS = (x: number | null, d = 1) => (x === null ? "n/a" : `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(d)}%`);

/** Closed positions and the scorecard over them: hit rate, payoff, and how fast a broken thesis was exited. */
function TrackRecord({ sig, open: held = [], history = {} }: { sig: string; /** The positions held now and their daily history, for process health. */ open?: Position[]; history?: BookHistory }) {
  const [open, setOpen] = useState(false);
  const [res, setRes] = useState<{ sig: string; d?: JournalData; err?: string } | null>(null);
  useEffect(() => {
    if (!open) return;
    let live = true;
    fetchJson<JournalData>("/api/book/journal").then((d) => { if (live) setRes({ sig, d }); }).catch((e) => { if (live) setRes({ sig, err: errorMessage(e) }); });
    return () => { live = false; };
  }, [open, sig]);
  const d = res?.sig === sig ? res.d ?? null : null;
  const err = res?.sig === sig ? res.err ?? "" : "";
  const s = d?.scorecard;
  return (
    <section aria-label="Track record" className="panel p-4">
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 text-left">
        <Icon name="ClipboardList" className="h-4 w-4 text-accent" />
        <span className="text-[13px] font-semibold">Track record</span>
        <span className="min-w-0 flex-1 truncate text-[11.5px] text-muted">Process health, closed positions, hit rate, payoff, and how fast a broken thesis was exited</span>
        <Icon name={open ? "ChevronUp" : "ChevronDown"} className="h-4 w-4 text-muted" />
      </button>
      {open && err && <p role="alert" className="mt-3 text-[12px] text-neg">{err}</p>}
      {open && !d && !err && <div className="shimmer mt-3 h-24 ctl" />}
      {open && d && s && (
        <div className="mt-3 space-y-3">
          <div className="ctl border border-line p-2.5 text-[12px] [&_section]:mt-0"><ProcessHealth items={processHealth({ open: held, closed: d.closed, history, calibration: d.calibration ?? null })} heading={false} /></div>
          {d.calibration && (d.calibration.n > 0 || d.calibration.open > 0) && (
            <div className="ctl border border-line p-2.5 text-[12px]">
              <div className="font-semibold">Calibration</div>
              <p className="text-muted">{calibrationLine(d.calibration)}</p>
              {d.calibration.buckets.length > 0 && <p className="mt-0.5">{d.calibration.buckets.map((b) => `forecasts of ${b.label}: ${Math.round(b.held * 100)}% held (${b.n})`).join(" · ")}</p>}
              {d.calibration.bySource.length > 1 && <p className="mt-0.5 text-muted">Brier by who forecast (lower is better): {d.calibration.bySource.map((x) => `${x.source} ${x.brier.toFixed(3)} on ${x.n}`).join(" · ")}</p>}
              {d.calibration.bySource.some((x) => x.meant) && <p className="mt-0.5 text-muted" title="Platt scaling fitted on each forecaster's resolved forecasts, shrunk toward no correction">What a stated chance has meant so far: {d.calibration.bySource.filter((x) => x.meant).map((x) => `${x.source === "You" ? "your" : `${x.source}'s`} ${Math.round(x.meant!.said * 100)}% has behaved like ${Math.round(x.meant!.means * 100)}%`).join("; ")}.</p>}
            </div>
          )}
          {!s.closed ? <p className="text-[12px] text-muted">Nothing closed yet. &ldquo;Close position&rdquo; on any card records it here with its exit, the reason and how its thesis stood, so the record builds itself.</p> : (<>
            <div className="flex flex-wrap gap-x-6 gap-y-3">
              <Stat label="Closed" value={String(s.closed)} />
              <Stat label="Winners" value={s.hitRate === null ? "n/a" : `${Math.round(s.hitRate * 100)}%`} hint="Share of closed positions with a gain in their favour (entry and exit known)" />
              <Stat label="Average" value={pctS(s.avgReturn)} tone={s.avgReturn !== null && s.avgReturn < 0 ? "text-neg" : ""} />
              <Stat label="Payoff" value={s.payoff === null ? "n/a" : `${s.payoff.toFixed(2)}x`} hint="Average win over average loss" />
              <Stat label="Exited on the break" value={s.broke ? `${s.exitedOnBreak} of ${s.broke}` : "n/a"} hint="Of the theses still broken when closed, those closed within five days of that break" />
              <Stat label="Median days to exit" value={s.medianDaysToExit === null ? "n/a" : String(s.medianDaysToExit)} hint="From the start of the break still in force at the close, to the close" />
            </div>
            {s.counterfactual && (
              <p className="text-[12px]">Had the {s.counterfactual.n} broken {s.counterfactual.n === 1 ? "thesis" : "theses"} been closed on the day {s.counterfactual.n === 1 ? "it" : "they"} broke: <span className="font-semibold">{pctS(s.counterfactual.onBreak)}</span> on average, against <span className="font-semibold">{pctS(s.counterfactual.taken)}</span> taken. <span className="text-muted">{s.counterfactual.onBreak > s.counterfactual.taken ? "The kill criteria would have helped." : "Holding past the break paid this time."}</span></p>
            )}
            {s.process && (s.process.earned.length + s.process.unlucky.length + s.process.lucky.length + s.process.deserved.length) > 0 && (
              <div aria-label="Process against outcome" className="text-[12px]">
                <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wider text-muted">Process against outcome</div>
                <div className="grid max-w-xl grid-cols-[auto_1fr_1fr] gap-px overflow-hidden rounded-md border border-line bg-line text-[11.5px]">
                  <span className="bg-panel p-1.5" /><span className="bg-panel p-1.5 font-semibold text-pos">Won</span><span className="bg-panel p-1.5 font-semibold text-neg">Lost</span>
                  <span className="bg-panel p-1.5 text-muted" title="Not held more than five days past a broken thesis">Sound process</span>
                  <span className="bg-panel p-1.5"><b>{s.process.earned.length}</b> earned{s.process.earned.length ? `: ${s.process.earned.slice(0, 5).join(", ")}` : ""}</span>
                  <span className="bg-panel p-1.5"><b>{s.process.unlucky.length}</b> bad luck{s.process.unlucky.length ? `: ${s.process.unlucky.slice(0, 5).join(", ")}` : ""}</span>
                  <span className="bg-panel p-1.5 text-muted" title="Held more than five days after its thesis broke">Held past the break</span>
                  <span className="bg-panel p-1.5"><b>{s.process.lucky.length}</b> lucky{s.process.lucky.length ? `: ${s.process.lucky.slice(0, 5).join(", ")}` : ""}</span>
                  <span className="bg-panel p-1.5"><b>{s.process.deserved.length}</b> deserved{s.process.deserved.length ? `: ${s.process.deserved.slice(0, 5).join(", ")}` : ""}</span>
                </div>
                <p className="mt-1 text-[11px] text-muted">Judge the decisions, not just the results: a win taken after ignoring a broken thesis is luck to not repeat.</p>
              </div>
            )}
            {s.byCommittee.length > 0 && <p className="text-[12px] text-muted" title="Closed positions grouped by the AI committee's last call before the close">By the AI committee&apos;s last call: {s.byCommittee.map((x) => `${DECISIONS[x.decision]} ${x.n}${x.avgReturn !== null ? ` (${pctS(x.avgReturn)})` : ""}`).join(" · ")}. If its exit and trim calls sit on the losers, it is earning its keep.</p>}
            {s.byReason.length > 0 && <p className="text-[12px] text-muted">By reason: {s.byReason.map((r) => `${r.label} ${r.n}${r.avgReturn !== null ? ` (${pctS(r.avgReturn)})` : ""}`).join(" · ")}</p>}
            <ul className="text-[12px]">
              {d.closed.slice(0, 30).map((c) => {
                const r = closedReturn(c);
                return (
                  <li key={c.id} className="grid grid-cols-[4rem_1fr_auto] gap-x-3 border-t border-line py-1.5">
                    <span className="font-semibold">{c.ticker}</span>
                    <span className="min-w-0 text-muted"><span className="text-fg">{c.direction} · {CLOSE_REASONS[c.reason]}</span> · {c.openedAt.slice(0, 10)} to {c.closedAt.slice(0, 10)}{c.brokeOn ? ` · broke ${c.brokeOn}` : ""}{c.note ? ` · ${c.note}` : ""}</span>
                    <span className={`num text-right font-semibold ${r === null ? "text-muted" : r < 0 ? "text-neg" : "text-pos"}`}>{pctS(r)}</span>
                  </li>
                );
              })}
            </ul>
            <p className="text-[11px] text-muted">{scorecardLine(s)} Returns are price moves in the position&apos;s favour from entry to exit, unweighted; nothing here is audited performance.</p>
          </>)}
        </div>
      )}
    </section>
  );
}

/* ---------------- The team's books (read-only) ---------------- */

type TeamList = { teams: { id: number; name: string; members: number }[]; sharing: number[] };
type TeamData = { members: { userId: string; name: string; positions: number; summary: BookSummary }[]; evaluations: (Evaluation & { owner: string; ownerName: string; thesis: string; redTeam?: Position["redTeam"]; committee?: Position["committee"]; conviction?: Position["conviction"]; log?: Position["log"] })[]; conflicts: { ticker: string; long: string[]; short: string[] }[]; memberCount: number };

function TeamBook({ team, sharing, onShare }: { team: { id: number; name: string }; sharing: boolean; onShare: (on: boolean) => Promise<void> }) {
  const [d, setD] = useState<TeamData | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  // Each member's own risk, for one request (the latest): an older answer arriving late is dropped.
  const [risk, setRisk] = useState<{ req: number; map: Record<string, RiskHeadline> | null; err: string }>({ req: 0, map: null, err: "" });
  const reqRef = useRef(0);
  const [latest, setLatest] = useState(0);
  const load = useCallback(() => {
    fetchJson<TeamData>(`/api/book/team?team=${team.id}`).then((x) => { setD(x); setErr(""); }).catch((e) => setErr(errorMessage(e)));
    // The risk follows (prices can take a moment the first time today); the table shows meanwhile.
    const req = ++reqRef.current;
    setLatest(req);
    fetchJson<{ risk: Record<string, RiskHeadline> }>(`/api/book/team?team=${team.id}&risk=1`)
      .then((x) => { if (req === reqRef.current) setRisk({ req, map: x.risk, err: "" }); })
      .catch((e) => { if (req === reqRef.current) setRisk({ req, map: {}, err: errorMessage(e) }); });
  }, [team.id]);
  const riskMap = risk.req === latest ? risk.map : null;
  useEffect(() => { load(); }, [load]);
  const toggle = async () => { setBusy(true); try { await onShare(!sharing); load(); } finally { setBusy(false); } };
  return (
    <div className="space-y-3">
      <section className="panel flex flex-wrap items-center gap-3 p-3 text-[12.5px]">
        <span className="min-w-0 basis-full text-muted sm:basis-0 sm:flex-1">{team.name}: the books its members chose to share, read-only. {d ? `${d.members.length} of ${d.memberCount} member${d.memberCount === 1 ? "" : "s"} share.` : ""} Sharing shows your positions, theses and kill criteria, your forecasts, your decision journal, and your red team and AI committee write-ups.</span>
        <label className="flex items-center gap-2"><input type="checkbox" checked={sharing} disabled={busy} onChange={() => void toggle()} />Share my book with {team.name}</label>
      </section>
      {err && <div role="alert" className="panel p-3 text-[12px] text-neg">{err}</div>}
      {!d && !err && <div className="shimmer h-32 ctl" />}
      {d && d.conflicts.length > 0 && (
        <section role="status" className="panel border-accent/50 p-3 text-[12.5px]">
          <div className="font-semibold">Opposite sides of the same name</div>
          <ul className="mt-1 space-y-0.5 text-muted">{d.conflicts.map((c) => <li key={c.ticker}><span className="num font-semibold text-fg">{c.ticker}</span>: long {c.long.join(", ")} · short {c.short.join(", ")}</li>)}</ul>
        </section>
      )}
      {d && d.members.length > 0 && (
        <section className="panel overflow-x-auto p-3">
          <table className="w-full text-[12px]">
            <thead><tr className="text-left text-[10.5px] uppercase tracking-wider text-muted"><th className="py-1 font-medium">Member</th><th className="font-medium">Positions</th><th className="font-medium">Gross</th><th className="font-medium">Net</th><th className="font-medium">At risk</th><th className="font-medium">Broken / watch</th><th className="font-medium" title="Each member's own book: beta-adjusted net, % of their NAV">Beta-adj. net</th><th className="font-medium" title="Each member's own book: historical one-day 95% VaR, % of their NAV">1-day VaR</th><th className="font-medium">Worst replay</th></tr></thead>
            <tbody>{d.members.map((m) => (
              <tr key={m.userId} className="border-t border-line/60"><td className="py-1">{m.name}</td><td className="num">{m.positions}</td><td className="num">{navPct(m.summary.gross)}</td><td className="num">{navPct(m.summary.net)}</td><td className={`num ${m.summary.atRiskWeight > 0 ? "text-neg" : ""}`}>{navPct(m.summary.atRiskWeight)}</td><td className="num">{m.summary.verdicts.broken} / {m.summary.verdicts.watch}</td>{(() => { const r = riskMap?.[m.userId]; return riskMap === null ? <td colSpan={3} className="text-muted">working out…</td> : <><td className="num">{r?.betaNet != null ? signed(r.betaNet, 1) : "n/a"}</td><td className="num">{r?.var95 != null ? `${r.var95.toFixed(2)}%` : "n/a"}</td><td className="whitespace-nowrap">{r?.worst ? <span title={r.worst.label}><span className={`num ${r.worst.pnl < 0 ? "text-neg" : "text-pos"}`}>{signed(r.worst.pnl)}</span> <span className="text-muted">{r.worst.label}</span></span> : "n/a"}</td></>; })()}</tr>
            ))}</tbody>
          </table>
          {risk.err && riskMap !== null && <p role="alert" className="mt-2 text-[11.5px] text-neg">The members&apos; risk could not be worked out just now: {risk.err}</p>}
        </section>
      )}
      {d && d.members.length === 0 && <p className="panel p-4 text-[12.5px] text-muted">Nobody on {team.name} shares a book yet. Share yours with the switch above; each member chooses for themselves.</p>}
      {d && d.evaluations.length > 0 && (
        <ul className="space-y-2">{d.evaluations.map((e) => <PositionCard key={`${e.owner}:${e.positionId}`} ev={e} owner={e.ownerName} position={{ id: e.positionId, ticker: e.ticker, direction: e.direction, weight: e.weight, entry: null, thesis: e.thesis, pillars: [], criteria: [], catalysts: [], createdAt: "", updatedAt: "", ...(e.redTeam ? { redTeam: e.redTeam } : {}), ...(e.committee ? { committee: e.committee } : {}), ...(e.conviction ? { conviction: e.conviction } : {}), ...(e.log ? { log: e.log } : {}) }} />)}</ul>
      )}
    </div>
  );
}

/* ---------------- The page ---------------- */

function Stat({ label, value, tone, hint }: { label: string; value: string; tone?: string; hint?: string }) {
  return (
    <div title={hint} className="min-w-[96px]">
      <div className="text-[10.5px] uppercase tracking-wider text-muted">{label}</div>
      <div className={`num text-[16px] font-semibold ${tone ?? ""}`}>{value}</div>
    </div>
  );
}

export function BookClient({ focus, riskOpen, proposal }: { focus?: string; riskOpen?: boolean; proposal?: string }) {
  const [data, setData] = useState<BookData | null>(null);
  const [err, setErr] = useState("");
  const [editing, setEditing] = useState<Draft | null>(null);
  const [importing, setImporting] = useState(false);
  const [note, setNote] = useState<ImportRes | null>(null);
  const [sampling, setSampling] = useState(false);
  const [teams, setTeams] = useState<TeamList | null>(null);
  const [view, setView] = useState<number | "mine">("mine");
  const [pick, setOnly] = useState<Verdict | null>(null);
  // The proposal being reviewed in the editor: saving the position clears it.
  const [reviewing, setReviewing] = useState<{ id: string; heading: string; from?: string; rationale?: string } | null>(null);
  useEffect(() => { fetchJson<TeamList>("/api/book/team").then(setTeams).catch(() => setTeams(null)); }, []);
  const share = async (teamId: number, on: boolean) => {
    const r = await fetchJson<{ sharing: number[] }>("/api/book/team", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ team: teamId, share: on }) });
    setTeams((t) => (t ? { ...t, sharing: r.sharing } : t));
  };
  const load = useCallback(() => {
    fetchJson<BookData>("/api/book").then((d) => { setData(d); setErr(""); }).catch((e) => setErr(errorMessage(e)));
  }, []);
  useEffect(() => { load(); }, [load]);
  const sample = async () => {
    setSampling(true); setErr("");
    try { setNote(await fetchJson<ImportRes>("/api/book/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sample: true }) })); load(); }
    catch (e) { setErr(errorMessage(e)); } finally { setSampling(false); }
  };
  const byId = useMemo(() => new Map((data?.positions ?? []).map((p) => [p.id, p])), [data]);
  const s = data?.summary;
  const sizing = useMemo(() => (data ? sizingCheck(data.positions.map((p) => ({ ticker: p.ticker, weight: p.weight, p: p.conviction?.p ?? null }))) : null), [data]);
  // "Since you last looked": each position's verdict as this browser last saw it, against now, and committee
  // sittings since then. A snapshot, not a date, so a change recorded later on the day of a visit is not lost.
  const [since, setSince] = useState<{ on: string; lines: string[] } | null>(null);
  useEffect(() => {
    if (!data || !data.positions.length) return;
    const KEY = "yb-book-seen-v2";
    let prev: { at: string; v: Record<string, string> } | null = null;
    try { prev = JSON.parse(localStorage.getItem(KEY) ?? "null"); } catch { prev = null; }
    const now: Record<string, string> = Object.fromEntries(data.evaluations.map((e) => [e.positionId, e.verdict]));
    try { localStorage.setItem(KEY, JSON.stringify({ at: new Date().toISOString(), v: now })); } catch { /* no storage */ }
    if (!prev || typeof prev.at !== "string" || !prev.v) return;
    const word: Record<string, string> = { intact: "intact", watch: "on watch", broken: "broken", unknown: "no data" };
    const lines = data.evaluations.filter((e) => prev!.v[e.positionId] && prev!.v[e.positionId] !== e.verdict && e.verdict !== "unknown").map((e) => `${e.ticker} ${word[prev!.v[e.positionId]] ?? prev!.v[e.positionId]} → ${word[e.verdict]}`);
    for (const p of data.positions) if (p.committee && p.committee.at > prev.at) lines.push(`the AI committee sat on ${p.ticker} (${DECISIONS[p.committee.decision].toLowerCase()})`);
    if (lines.length) setTimeout(() => setSince({ on: prev!.at.slice(0, 10), lines }), 0);
  }, [data]);
  // A filter whose last position left (edited, deleted or recovered) shows everything again rather than an empty list.
  const only = pick && s?.verdicts[pick] ? pick : null;
  return (
    <div className="scroll-touch h-full overflow-auto">
    <div data-book-top className="mx-auto max-w-5xl space-y-4 p-4">
      <header className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 basis-full sm:basis-0 sm:flex-1">
          <h1 className="text-[18px] font-semibold">The Book</h1>
          <p className="text-[12.5px] text-muted">Every position with a thesis that can be proved wrong. Each kill criterion is checked against SEC filings and the market on every load, with the figure, its period and a link to the source.</p>
        </div>
        <div className="flex gap-2">
          {!!data?.evaluations.length && <ExportMenu />}
          <button type="button" onClick={() => { setImporting((v) => !v); setEditing(null); setReviewing(null); }} className="ctl flex items-center gap-1.5 border border-line px-3 py-1.5 text-[12px] text-muted hover:text-fg"><Icon name="Upload" className="h-3.5 w-3.5" />Import</button>
          <button type="button" onClick={() => { setEditing(emptyDraft()); setImporting(false); setReviewing(null); }} className="ctl flex items-center gap-1.5 bg-accent px-3 py-1.5 text-[12px] font-semibold text-accent-fg"><Icon name="Plus" className="h-3.5 w-3.5" />Add a position</button>
        </div>
      </header>

      {!!teams?.teams.length && (
        <div role="tablist" aria-label="Whose book" className="flex flex-wrap gap-1">
          {[{ id: "mine" as const, label: "My book" }, ...teams.teams.map((t) => ({ id: t.id, label: `${t.name} (team)` }))].map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={view === t.id} onClick={() => setView(t.id)} className={`ctl px-3 py-1.5 text-[12px] ${view === t.id ? "bg-accent-soft text-accent" : "text-muted hover:text-fg"}`}>{t.label}</button>
          ))}
        </div>
      )}
      {view !== "mine" && teams && (() => { const t = teams.teams.find((x) => x.id === view); return t ? <TeamBook key={t.id} team={t} sharing={teams.sharing.includes(t.id)} onShare={(on) => share(t.id, on)} /> : null; })()}
      {view === "mine" && (<>

      {importing && <Importer onCancel={() => setImporting(false)} onDone={(r) => { setImporting(false); setNote(r); load(); }} />}
      {note && (
        <div role="status" className="panel flex flex-wrap items-start gap-2 p-3 text-[12px]">
          <span className="min-w-0 flex-1">
            Added {note.added.length} position{note.added.length === 1 ? "" : "s"}{note.added.length ? `: ${note.added.map((p) => p.ticker).join(", ")}` : ""}.
            {[...note.skipped, ...note.problems].length > 0 && <span className="text-muted"> {[...note.skipped, ...note.problems].join(" · ")}</span>}
          </span>
          <button type="button" aria-label="Dismiss" onClick={() => setNote(null)} className="text-muted hover:text-fg"><Icon name="X" className="h-3.5 w-3.5" /></button>
        </div>
      )}

      {!!data?.proposals?.length && !editing && (
        <Proposals list={data.proposals} held={new Set(data.positions.map((p) => p.ticker))} focus={proposal}
          onReview={(x) => { setReviewing({ id: x.id, heading: `Review ${x.position.ticker}, proposed by ${x.from}`, from: x.from, rationale: x.rationale }); setImporting(false); setEditing({ ...draftOf(x.position), id: undefined }); document.querySelector("[data-book-top]")?.scrollIntoView({ behavior: "smooth" }); }}
          onDismiss={async (x) => { try { await fetchJson(`/api/book/proposals?id=${x.id}`, { method: "DELETE" }); load(); } catch (e) { setErr(errorMessage(e)); } }} />
      )}

      {editing && <Editor key={editing.id ?? reviewing?.id ?? "new"} initial={editing} verdict={editing.id ? recentVerdict(data?.history?.[editing.id]) : undefined} heading={reviewing?.heading} proposal={reviewing ? { id: reviewing.id, from: reviewing.from ?? "An AI app", rationale: reviewing.rationale ?? "" } : undefined} market={(() => { const e = data?.evaluations.find((x) => x.ticker === editing.ticker.trim().toUpperCase()); return e ? { price: e.price, vol: data?.vols?.[e.ticker] ?? null } : undefined; })()} onCancel={() => { setEditing(null); setReviewing(null); }} onSaved={async () => {
        const done = reviewing?.id;
        setEditing(null); setReviewing(null);
        if (done) await fetchJson(`/api/book/proposals?id=${done}`, { method: "DELETE" }).catch(() => setErr("The position was added, but its proposal could not be cleared. Dismiss it so it is not added twice."));
        load();
      }} />}

      {err && <div role="alert" className="panel p-3 text-[12px] text-neg">{err} <button type="button" onClick={load} className="ml-2 text-accent">Try again</button></div>}
      {!data && !err && <div className="shimmer h-40 ctl" />}

      {s && s.positions > 0 && (
        <section aria-label="Exposure" className="panel flex flex-wrap gap-x-6 gap-y-3 p-4">
          <Stat label="Positions" value={String(s.positions)} />
          <Stat label="Gross" value={navPct(s.gross)} hint="Long plus short weight, % of NAV" />
          <Stat label="Net" value={navPct(s.net)} hint="Long minus short weight, % of NAV" />
          <Stat label="Long / short" value={`${navPct(s.long)} / ${navPct(s.short)}`} />
          <Stat label="At risk" value={navPct(s.atRiskWeight)} tone={s.atRiskWeight > 0 ? "text-neg" : ""} hint="Weight in positions whose thesis is broken or on watch" />
          <Stat label="P&L since entry" value={s.pnlContribution === null ? "n/a" : `${s.pnlContribution >= 0 ? "+" : ""}${s.pnlContribution.toFixed(2)}% NAV`} tone={s.pnlContribution === null ? "" : s.pnlContribution >= 0 ? "text-pos" : "text-neg"} hint="Weight times return since entry, over positions with both" />
          <div className="ml-auto flex items-end gap-1.5">
            {(Object.keys(VERDICT) as Verdict[]).filter((k) => s.verdicts[k]).map((k) => (
              <button key={k} type="button" aria-pressed={only === k} title={only === k ? "Show every position" : `Show only positions ${VERDICT[k].label.toLowerCase()}`} onClick={() => setOnly(only === k ? null : k)}
                className={`ctl px-2 py-1 text-[11px] font-semibold ${VERDICT[k].cls} ${only && only !== k ? "opacity-40" : ""} ${only === k ? "ring-1 ring-current" : ""}`}>{s.verdicts[k]} {VERDICT[k].label.toLowerCase()}</button>
            ))}
          </div>
        </section>
      )}

      {since && (
        <section role="status" aria-label="Since you last looked" className="panel flex items-start gap-2 border-accent/40 p-3 text-[12px]">
          <Icon name="Clock" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
          <div className="min-w-0 flex-1"><span className="font-semibold">Since you last looked ({since.on}):</span> {since.lines.join("; ")}. <Link href="/report/week" className="text-accent hover:underline">The week in your book</Link></div>
          <button type="button" aria-label="Dismiss" onClick={() => setSince(null)} className="text-muted hover:text-fg"><Icon name="X" className="h-3.5 w-3.5" /></button>
        </section>
      )}

      {sizing && sizing.notes.length > 0 && (
        <section aria-label="Sizing against conviction" className="panel flex items-start gap-2 p-3 text-[12px]">
          <Icon name="Scale" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
          <div><span className="font-semibold">Sizing against conviction.</span> {sizing.notes.join(" ")}</div>
        </section>
      )}

      {s && s.gross > 0 && data && <RiskPanel initiallyOpen={riskOpen} sig={data.positions.map((p) => `${p.ticker}:${p.direction}:${p.weight ?? ""}`).sort().join(",")} />}

      {data && <TrackRecord sig={data.positions.map((p) => p.id).sort().join(",")} open={data.positions} history={data.history ?? {}} />}

      {s && s.byIndustry.length > 1 && s.gross > 0 && (
        <section aria-label="Exposure by industry" className="panel p-4">
          <h2 className="mb-2 text-[10.5px] font-semibold uppercase tracking-wider text-muted">By industry (% of NAV)</h2>
          <ul className="space-y-1.5 text-[12px]">
            {s.byIndustry.filter((x) => x.gross > 0).map((x) => {
              const max = Math.max(...s.byIndustry.map((y) => Math.max(y.long, y.short)), 0.01);
              return (
                <li key={x.industry} className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-3">
                  <span className="truncate" title={x.industry}>{x.industry} <span className="text-muted">· {x.positions}</span></span>
                  <span className="grid grid-cols-2 gap-px" aria-hidden>
                    <span className="flex justify-end"><span className="h-2.5 rounded-l-sm bg-neg/70" style={{ width: `${(x.short / max) * 100}%` }} /></span>
                    <span className="flex"><span className="h-2.5 rounded-r-sm bg-pos/70" style={{ width: `${(x.long / max) * 100}%` }} /></span>
                  </span>
                  <span className="num whitespace-nowrap text-right text-muted">{[x.long ? `+${navPct(x.long)}` : "", x.short ? `−${navPct(x.short)}` : ""].filter(Boolean).join(" / ")} <span className={x.net >= 0 ? "text-fg" : "text-neg"}>net {x.net < 0 ? "−" : ""}{navPct(Math.abs(x.net))}</span></span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {data && data.evaluations.length === 0 && !editing && !importing && (
        <section className="panel p-6 text-center">
          <Icon name="Briefcase" className="mx-auto h-6 w-6 text-accent" />
          <h2 className="mt-2 text-[14px] font-semibold">Put your book in, and YouBank watches every thesis</h2>
          <p className="mx-auto mt-1 max-w-xl text-[12.5px] text-muted">Write each position&apos;s thesis with the numbers that would prove it wrong: growth at least 20%, gross margin at least 70%, a price stop. YouBank checks them against the company&apos;s filings and price, flags the ones close to breaking, and can run a red team that argues the other side with sources.</p>
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            <button type="button" onClick={() => { setEditing(emptyDraft()); setReviewing(null); }} className="ctl bg-accent px-3 py-1.5 text-[12px] font-semibold text-accent-fg">Add your first position</button>
            <button type="button" onClick={() => setImporting(true)} className="ctl border border-line px-3 py-1.5 text-[12px] text-muted hover:text-fg">Paste from a spreadsheet</button>
            <button type="button" disabled={sampling} onClick={sample} className="ctl border border-line px-3 py-1.5 text-[12px] text-muted hover:text-fg disabled:opacity-50">{sampling ? "Loading…" : "Try a sample book"}</button>
          </div>
          <p className="mt-2 text-[11px] text-muted">The sample book holds five well-known names with illustrative weights. Close any position to remove it.</p>
        </section>
      )}

      {data && data.evaluations.length > 0 && (
        <ul className="space-y-2">
          {data.evaluations.filter((ev) => !only || ev.verdict === only).map((ev) => {
            const p = byId.get(ev.positionId);
            return <PositionCard key={ev.positionId} ev={ev} position={p} history={data.history?.[ev.positionId]} vol={data.vols?.[ev.ticker] ?? null} focused={ev.positionId === focus} onChanged={load} onEdit={() => { if (p) { setEditing(draftOf(p)); setReviewing(null); document.querySelector("[data-book-top]")?.scrollIntoView({ behavior: "smooth" }); } }} />;
          })}
        </ul>
      )}
      </>)}
      {data && data.evaluations.length > 0 && (
        <label className="flex items-center gap-2 text-[12px] text-muted">
          <input type="checkbox" checked={data.alerts !== false} onChange={async (e) => {
            const on = e.target.checked;
            setData((d) => (d ? { ...d, alerts: on } : d));
            try { await fetchJson("/api/book", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ alerts: on }) }); }
            catch (x) { setErr(errorMessage(x)); setData((d) => (d ? { ...d, alerts: !on } : d)); }
          }} />
          Alert me after each US close when a thesis breaks, comes close to a kill criterion or holds again, and the day before earnings (bell, plus your channels in Settings → News and alerts)
        </label>
      )}
      <p className="text-[11px] text-muted">Nothing here places trades. Filings refresh every six hours, prices on every load. Percentages are entered as percent (20 means 20%).</p>
    </div>
    </div>
  );
}
