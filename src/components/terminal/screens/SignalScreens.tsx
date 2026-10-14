"use client";

/**
 * Edge's next signals in the Terminal, with the beta on. PULSE: a company's alternative data (hiring,
 * attention, federal awards, layoffs, patents) with each series' change probability and the tells. ODDS:
 * the Deal Radar's model probability of a sale announcement within 12 months, with its interval, the
 * sector base rate and the reasons; ODDS alone is the board of watched companies and the week's movers.
 * CALL: Call Desk on the company's latest read call and its promises ledger. LBO: the LBO Stress Lab's
 * 1,000-path preview on the company, run when the person presses Run (free), with a link to the full lab.
 */
import { useState } from "react";
import { post } from "@/components/news/client";
import { errorMessage } from "@/lib/client/errors";
import { useApi } from "@/components/news/client";
import { ProbBar, Sparkline } from "@/components/edge/next/charts";
import type { Command } from "@/lib/functions";

type Run = (c: Command) => void;
const fmt = (v: number) => (Math.abs(v) >= 1e9 ? `${(v / 1e9).toFixed(1)}bn` : Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(1)}m` : Math.abs(v) >= 1e4 ? `${Math.round(v / 1e3)}k` : v.toLocaleString("en-US", { maximumFractionDigits: 1 }));
const pct = (v: number | null | undefined, dp = 0) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : `${(v * 100).toFixed(dp)}%`);

function Wait({ error, what }: { error: string | null; what: string }) {
  if (error) return <div className="p-4 text-[11.5px] text-muted">{/beta/i.test(error) ? "This is part of Edge (beta). Switch Edge on in Settings, under Labs." : error}</div>;
  return <div className="flex flex-col gap-2 p-3" aria-busy="true" aria-label={`Loading ${what}`}>{[1, 2, 3, 4].map((i) => <div key={i} className="shimmer h-5 ctl" />)}</div>;
}

type PulseSeries = { metric: string; label: string; unit: string; points: { period: string; value: number }[]; verdict: { prob: number; move: number; alarm: boolean } | null; falseAlarms: string };
type PulseData = { name: string; coverageText: string; refreshedAt: string | null; series: PulseSeries[]; tells: { tell: string; title: string; location: string; firstSeen: string; url: string }[] };

export function PulseScreen({ ticker }: { ticker: string; onRun?: Run }) {
  const q = useApi<PulseData>(ticker ? `/api/edge/pulse?ticker=${ticker}` : null);
  if (!q.data) return <Wait error={q.error} what={`the Pulse of ${ticker}`} />;
  const d = q.data;
  const rows = d.series.filter((s) => s.points.length && !s.metric.startsWith("jobs.tell."));
  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-baseline gap-2 border-b border-line px-3 py-1.5 text-[11px]"><span className="font-semibold text-fg">{d.name}</span><span className="text-muted">{d.coverageText}</span><span className="ml-auto text-faint">{d.refreshedAt ? `read ${d.refreshedAt.slice(0, 10)}` : "not read yet"}</span></div>
      <div className="table-scroll min-h-0 flex-1 overflow-auto">
        <table className="w-full whitespace-nowrap text-[11.5px]">
          <thead className="sticky top-0 bg-panel text-[10px] uppercase tracking-wider text-muted"><tr className="border-b border-line-strong"><th className="py-1.5 pl-3 text-left font-normal">Signal</th><th className="py-1.5 text-right font-normal">Latest</th><th className="py-1.5 text-right font-normal">6 periods</th><th className="py-1.5 text-right font-normal">Change prob.</th><th className="py-1.5 pl-3 pr-3 text-left font-normal">Trend</th></tr></thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.metric} className={`border-b border-line/50 ${s.verdict?.alarm ? "bg-accent-soft/40" : ""}`} title={s.falseAlarms}>
                <td className="py-1 pl-3">{s.label}</td>
                <td className="num py-1 text-right">{fmt(s.points[s.points.length - 1].value)}</td>
                <td className="num py-1 text-right">{s.verdict && Number.isFinite(s.verdict.move) ? `${s.verdict.move >= 0 ? "+" : ""}${Math.round(s.verdict.move * 100)}%` : "—"}</td>
                <td className="num py-1 text-right">{s.verdict ? s.verdict.prob.toFixed(2) : "—"}</td>
                <td className="py-1 pl-3 pr-3"><Sparkline values={s.points.slice(-26).map((p) => p.value)} width={90} height={18} label={s.label} tone={s.verdict?.alarm ? "accent" : "muted"} /></td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={5} className="p-3 text-muted">No signals stored yet; open the Pulse in Edge and read the sources.</td></tr>}
          </tbody>
        </table>
        {d.tells.length > 0 && <div className="border-t border-line p-3 text-[11.5px]"><div className="mb-1 text-[10px] uppercase tracking-wider text-muted">Tells</div>{d.tells.slice(0, 8).map((t, i) => <div key={i} className="flex justify-between gap-2"><a href={t.url} target="_blank" rel="noreferrer" className="truncate hover:text-info">{t.title}</a><span className="num text-muted">{t.tell} · {t.firstSeen}</span></div>)}</div>}
      </div>
      <div className="border-t border-line px-3 py-1 text-[10px] text-muted">Free public sources: job boards, Wikimedia, USAspending, state WARN notices, PatentsView. A change is flagged at probability 0.9 with a large move.</div>
    </div>
  );
}

type OddsRow = { ticker: string; name: string; p: number; low: number | null; high: number | null; base: number | null; rise: number | null; reasons: { label: string; direction: "up" | "down" }[]; history: number[] };
type OddsCompany = (OddsRow & { covered: true; version: string; scorecard: string; calibration: string; disclaimer: string; moves: { label: string; to: number }[]; buyers: { name: string; ticker: string }[] }) | { covered: false; error: string };
type OddsBoard = { rows: OddsRow[]; disclaimer: string; version: string | null };

function Row({ r, onRun }: { r: OddsRow; onRun?: Run }) {
  return (
    <tr className="border-b border-line/50 hover:bg-elevated/70">
      <td className="py-1 pl-3"><button type="button" onClick={() => onRun?.({ ticker: r.ticker, fn: "ODDS" })} className="font-semibold hover:text-info">{r.ticker}</button> <span className="text-muted">{r.name}</span></td>
      <td className="num py-1 text-right">{pct(r.p, 1)}</td>
      <td className="w-40 py-1 pl-3"><ProbBar p={r.p} low={r.low} high={r.high} base={r.base} max={0.4} /></td>
      <td className="num py-1 text-right">{r.rise !== null ? `${r.rise >= 0 ? "+" : ""}${(r.rise * 100).toFixed(1)}` : "—"}</td>
      <td className="max-w-[280px] truncate py-1 pl-3 pr-3 text-muted">{r.reasons.slice(0, 3).map((x) => `${x.direction === "up" ? "▲" : "▼"} ${x.label}`).join(" · ")}</td>
    </tr>
  );
}

export function OddsScreen({ ticker, onRun }: { ticker: string; onRun?: Run }) {
  const one = useApi<OddsCompany>(ticker ? `/api/edge/odds?ticker=${ticker}` : null);
  const board = useApi<OddsBoard>(ticker ? null : "/api/edge/odds/board?scope=watched");
  const movers = useApi<OddsBoard>(ticker ? null : "/api/edge/odds/board?scope=movers");
  if (ticker) {
    if (!one.data) return <Wait error={one.error} what={`Deal Radar on ${ticker}`} />;
    const d = one.data;
    if (!d.covered) return <div className="p-4 text-[11.5px] text-muted">{d.error}</div>;
    return (
      <div className="space-y-2 overflow-auto p-3 text-[11.5px]">
        <div className="flex items-baseline gap-2"><span className="text-[13px] font-semibold">{d.name}</span><span className="num text-[18px] font-semibold">{pct(d.p, 1)}</span><span className="text-muted">model probability of a sale announcement within 12 months · interval {pct(d.low, 1)} to {pct(d.high, 1)} · base rate {pct(d.base, 1)}</span></div>
        <ProbBar p={d.p} low={d.low} high={d.high} base={d.base} max={Math.max(0.3, (d.high ?? d.p) * 1.3)} />
        <div className="flex flex-wrap gap-1">{d.reasons.map((r) => <span key={r.label} className="rounded-full border border-line px-1.5">{r.direction === "up" ? "▲" : "▼"} {r.label}</span>)}</div>
        {d.moves.length > 0 && <p className="text-muted">What would move it: {d.moves.map((m) => `${m.label} (to ${pct(m.to, 1)})`).join("; ")}.</p>}
        {d.buyers.length > 0 && <p className="text-muted">Likely buyers (deal model): {d.buyers.map((b) => b.ticker || b.name).join(", ")}.</p>}
        <p className="text-muted">{d.calibration} {d.scorecard}</p>
        <p className="text-faint">{d.disclaimer} Model {d.version}.</p>
      </div>
    );
  }
  if (!board.data) return <Wait error={board.error} what="the Deal Radar board" />;
  const b = board.data;
  const table = (rows: OddsRow[], title: string) => (
    <>
      <div className="px-3 pt-2 text-[10px] uppercase tracking-wider text-muted">{title}</div>
      <table className="w-full whitespace-nowrap text-[11.5px]"><tbody>{rows.map((r) => <Row key={r.ticker} r={r} onRun={onRun} />)}{!rows.length && <tr><td className="p-3 text-muted">None yet.</td></tr>}</tbody></table>
    </>
  );
  return (
    <div className="flex h-full flex-col">
      <div className="table-scroll min-h-0 flex-1 overflow-auto">{table(b.rows, "Your watches")}{table(movers.data?.rows ?? [], "The week's movers")}</div>
      <div className="border-t border-line px-3 py-1 text-[10px] text-muted">{b.disclaimer}{b.version ? ` Model ${b.version}.` : ""}</div>
    </div>
  );
}

type CallList = { calls: { id: number; title: string; filed: string; createdAt: string; summary: { mean: number; low: number; high: number; scored: number } | null; read: boolean }[] };
type CallRead = { read: boolean; title?: string; said?: string; summary?: { mean: number; low: number; high: number; scored: number } | null; comparison?: { sentence: string } | null; avoided?: { topic: string; n: number }[]; pairs?: { n: number; analyst: string; firm: string; cls?: string; p?: { evasive: number }; question: string }[]; disclaimer?: string };
type Promises = { name: string; rows: { label: string; period: { fy: number; q?: number } | null; status: string; low: number | null; high: number | null; unit: string }[]; hitRate: { text: string; n: number } };

/** The company's promises and their hit rate, compact (for CALL and the EE screen). Shows nothing without Edge. */
export function PromisesKept({ ticker, compact = false }: { ticker: string; compact?: boolean }) {
  const q = useApi<Promises>(ticker ? `/api/edge/commitments?ticker=${ticker}` : null);
  if (!q.data) return compact ? null : <Wait error={q.error} what={`${ticker}'s promises`} />;
  const d = q.data;
  if (compact && !d.rows.length) return null;
  return (
    <div className="text-[11.5px]">
      <div className="text-[10px] uppercase tracking-wider text-muted">Promises kept (Call Desk)</div>
      <p className="mt-0.5">{d.hitRate.text}</p>
      <ul className="mt-1 space-y-0.5">{d.rows.slice(0, compact ? 4 : 12).map((r, i) => <li key={i} className="flex justify-between gap-2"><span className="truncate">{r.label}{r.period ? ` ${r.period.q ? `Q${r.period.q} ` : ""}FY${r.period.fy}` : ""}</span><span className={r.status === "hit" ? "text-pos" : r.status.startsWith("missed") ? "text-neg" : "text-muted"}>{r.status.replace("_", " ")}</span></li>)}</ul>
    </div>
  );
}

export function CallScreen({ ticker }: { ticker: string; onRun?: Run }) {
  const list = useApi<CallList>(ticker ? `/api/edge/calls?ticker=${ticker}` : null);
  const latest = list.data?.calls.find((c) => c.read && c.summary) ?? null;
  const call = useApi<CallRead>(latest ? `/api/edge/calls/${latest.id}` : null);
  if (!list.data) return <Wait error={list.error} what={`${ticker}'s calls`} />;
  return (
    <div className="space-y-3 overflow-auto p-3 text-[11.5px]">
      {!latest ? <p className="text-muted">No call of {ticker} has been read yet. Open Edge, Call Desk, to read a filed transcript or an uploaded recording. <a href={`/app/edge?view=calls&ticker=${ticker}`} className="text-info hover:underline">Call Desk</a></p> : !call.data ? <Wait error={call.error} what="the call" /> : (
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-baseline gap-2"><span className="text-[13px] font-semibold">{call.data.title}</span>{call.data.summary && <span className="num text-[18px] font-semibold">{pct(call.data.summary.mean)}</span>}<span className="text-muted">of answers did not address the question{call.data.summary ? ` (80% interval ${pct(call.data.summary.low)} to ${pct(call.data.summary.high)}, ${call.data.summary.scored} scored)` : ""}</span></div>
          {call.data.comparison && <p className="text-muted">{call.data.comparison.sentence}</p>}
          {call.data.avoided?.length ? <p>Most avoided: {call.data.avoided.map((a) => `${a.topic} (${a.n})`).join(", ")}.</p> : null}
          <table className="w-full text-[11px]"><tbody>{(call.data.pairs ?? []).slice(0, 12).map((p) => <tr key={p.n} className="border-b border-line/50"><td className="py-0.5 pr-2 text-muted">Q{p.n}</td><td className="truncate pr-2">{p.analyst}{p.firm ? `, ${p.firm}` : ""}</td><td className="num pr-2 text-right">{p.p ? pct(p.p.evasive) : "—"}</td><td className="text-muted">{p.cls ?? "not scored"}</td></tr>)}</tbody></table>
          <p className="text-faint">{call.data.disclaimer}</p>
        </div>
      )}
      <PromisesKept ticker={ticker} />
      <a href={`/app/edge?view=calls&ticker=${ticker}`} className="text-info hover:underline">Open Call Desk</a>
    </div>
  );
}

type LboQuick = { result: { title: string; recipe: string; seed: number; result: { paths: number; irr: { p10: number; p50: number; p90: number }; odds: { moicBelowOne: number; breachAny: number }; breachByYear: number[]; maxPrice: { multiple: number | null; hurdle: number; confidence: number }; reverse: { sentence: string } }; entry: { multiple: number; source: string } } };

export function LboScreen({ ticker }: { ticker: string; onRun?: Run }) {
  const [busy, setBusy] = useState(false), [err, setErr] = useState(""), [res, setRes] = useState<LboQuick["result"] | null>(null);
  const run = async () => { setBusy(true); setErr(""); try { setRes((await post<LboQuick>("/api/edge/scenarios", { kind: "lbo", ticker })).result); } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); } };
  return (
    <div className="space-y-2 overflow-auto p-3 text-[11.5px]">
      <p className="text-muted">The LBO Stress Lab runs {ticker}&apos;s buyout (default structure: a 4.0x term loan, 1.5x notes, a revolver; entry from similar sponsor deals) over 1,000 SYNTHETIC macro and operating paths. Free.</p>
      <div className="flex gap-2"><button type="button" onClick={run} disabled={busy} className="ctl border border-line px-2.5 py-1 hover:border-accent/50 disabled:opacity-50">{busy ? "Running…" : "Run 1,000 paths"}</button><a href={`/app/edge?view=scenarios&tab=lbo&ticker=${ticker}`} className="ctl border border-line px-2.5 py-1 text-info">Open the lab</a></div>
      {err && <p className="text-neg">{err}</p>}
      {res && (
        <div className="space-y-1">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-accent">Synthetic · seed {res.seed} · {res.result.paths.toLocaleString("en-US")} paths · entry {res.entry.multiple.toFixed(1)}x</p>
          <p>Median IRR <span className="num font-semibold">{pct(res.result.irr.p50, 1)}</span> (10th to 90th: {pct(res.result.irr.p10)} to {pct(res.result.irr.p90)}); chance of MOIC under 1x {pct(res.result.odds.moicBelowOne)}.</p>
          <p>Covenant breach by year: {res.result.breachByYear.map((b, k) => `Y${k + 1} ${pct(b)}`).join(" · ")}.</p>
          <p>Most a sponsor can pay for {pct(res.result.maxPrice.hurdle)} IRR with {pct(res.result.maxPrice.confidence)} probability: {res.result.maxPrice.multiple ? `${res.result.maxPrice.multiple.toFixed(1)}x EBITDA` : "no price clears it"}.</p>
          <p className="text-muted">Gentlest scenario that breaks it: {res.result.reverse.sentence}</p>
        </div>
      )}
    </div>
  );
}
