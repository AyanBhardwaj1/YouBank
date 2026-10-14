"use client";

/**
 * Edge's next signals in the Terminal, with the beta on. PULSE: a company's alternative data (hiring,
 * attention, federal awards, layoffs, patents) with each series' change probability and the tells. ODDS:
 * the Deal Radar's model probability of a sale announcement within 12 months, with its interval, the
 * sector base rate and the reasons; ODDS alone is the board of watched companies and the week's movers.
 */
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
