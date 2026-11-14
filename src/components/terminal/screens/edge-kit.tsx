"use client";

/**
 * The kit the Terminal's Edge monitors share (MARB, SAT, FLR, ALT, EVTS): a live query that polls while
 * the panel is visible and keeps the last good answer when a refresh fails; a dense, sortable table driven
 * from the keyboard (↑ ↓ or j k to move, Enter to drill in, 1–9 to sort by a column, Esc to close a
 * drill-down); sparklines, z-score and percentile cells; and the source strip every screen ends with
 * (each source's state, as of when, and the fallback in words when one is down).
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useApi } from "@/components/news/client";
import { useClock } from "@/components/edge/client";
import { sparkPoints } from "@/lib/terminal/edge-math";
import type { SourceState } from "@/lib/terminal/edge/common";
import type { Command } from "@/lib/functions";

export type Run = (c: Command) => void;
const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
export const DASH = "—";

/* ---------------- Data ---------------- */

/** A monitor's data, polled every `pollMs` while the tab is visible (the last good answer stays on screen when a poll fails). */
export function useEdgeTerminal<T>(fn: string, params: Record<string, string | number | null | undefined> = {}, pollMs = 60_000, enabled = true) {
  const qs = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&");
  const url = enabled ? `/api/terminal/edge/${fn}${qs ? `?${qs}` : ""}` : null;
  return useApi<T>(url, pollMs);
}

/* ---------------- Formatting ---------------- */

export const money = (v: number | null | undefined, dp = 2) => (fin(v) ? `$${v.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp })}` : DASH);
export const pct = (v: number | null | undefined, dp = 1, signed = false) => (fin(v) ? `${signed && v >= 0 ? "+" : ""}${(v * 100).toFixed(dp)}%` : DASH);
export const num = (v: number | null | undefined, dp = 0) => (fin(v) ? v.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp }) : DASH);
export const big = (v: number | null | undefined) => (!fin(v) ? DASH : Math.abs(v) >= 1e9 ? `${(v / 1e9).toFixed(1)}B` : Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : Math.abs(v) >= 1e4 ? `${(v / 1e3).toFixed(0)}K` : v.toLocaleString("en-US", { maximumFractionDigits: v < 10 ? 2 : 0 }));
export const signTone = (v: number | null | undefined) => (!fin(v) ? "text-faint" : v > 0 ? "text-pos" : v < 0 ? "text-neg" : "text-muted");

/** "4m", "3h", "2d", or the date beyond a week. */
export function shortAgo(iso: string | null | undefined, now: number): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t) || !now) return iso ? iso.slice(0, 10) : DASH;
  const m = Math.max(0, Math.round((now - t) / 60_000));
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  if (m < 48 * 60) return `${Math.round(m / 60)}h`;
  if (m < 8 * 1440) return `${Math.round(m / 1440)}d`;
  return iso!.slice(0, 10);
}

/** New York time, "14:05" today, "Nov 12 14:05" before. */
export function etTime(iso: string, now: number): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return DASH;
  const day = (x: Date) => x.toLocaleDateString("en-US", { timeZone: "America/New_York" });
  const hm = d.toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false });
  return now && day(d) === day(new Date(now)) ? hm : `${d.toLocaleDateString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" })} ${hm}`;
}

/* ---------------- Cells and charts ---------------- */

export function Spark({ values, w = 72, h = 16, tone = "accent", label }: { values: (number | null)[]; w?: number; h?: number; tone?: "accent" | "pos" | "neg" | "muted" | "warn"; label?: string }) {
  const pts = sparkPoints(values, w, h, 1.5);
  if (!pts) return <span className="inline-block text-center text-[10px] text-faint" style={{ width: w }}>{DASH}</span>;
  const color = { accent: "var(--accent)", pos: "var(--pos)", neg: "var(--neg)", muted: "var(--muted)", warn: "var(--chart-emphasis)" }[tone];
  const last = pts.split(" ").pop()!.split(",").map(Number);
  return (
    <svg width={w} height={h} className="inline-block align-middle" role="img" aria-label={label ? `${label}: trend` : "Trend"}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.25} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r={1.8} fill={color} />
    </svg>
  );
}

/** Bars for a short window (the seven days of a flare), zero days as ticks. */
export function SparkBars({ values, w = 56, h = 16, label }: { values: number[]; w?: number; h?: number; label?: string }) {
  const max = Math.max(...values, 0);
  const bw = values.length ? w / values.length : w;
  return (
    <svg width={w} height={h} className="inline-block align-middle" role="img" aria-label={label ?? "Daily values"}>
      {values.map((v, i) => {
        const bh = max > 0 && v > 0 ? Math.max(2, (v / max) * (h - 1)) : 1;
        return <rect key={i} x={i * bw + 0.5} y={h - bh} width={Math.max(1, bw - 1.5)} height={bh} rx={0.5} fill={v > 0 ? "var(--chart-emphasis)" : "var(--line-strong)"}><title>{`${v.toFixed(1)} MW`}</title></rect>;
      })}
    </svg>
  );
}

/** A z-score, coloured past one and bold past two standard deviations. */
export function Z({ z }: { z: number | null | undefined }) {
  if (!fin(z)) return <span className="text-faint">{DASH}</span>;
  const strong = Math.abs(z) >= 2;
  return <span className={`${Math.abs(z) >= 1 ? (z > 0 ? "text-pos" : "text-neg") : "text-muted"} ${strong ? "font-semibold" : ""}`} title="Standard deviations from its own history">{z >= 0 ? "+" : ""}{z.toFixed(1)}σ</span>;
}

/** A percentile against the company's own history: a bar and the number. */
export function Pctile({ p }: { p: number | null | undefined }) {
  if (!fin(p)) return <span className="text-faint">{DASH}</span>;
  const tone = p >= 0.9 ? "bg-pos" : p <= 0.1 ? "bg-neg" : "bg-accent";
  return (
    <span className="inline-flex items-center gap-1" title={`Higher than ${Math.round(p * 100)}% of its own history`}>
      <span className="relative h-1.5 w-10 overflow-hidden rounded-full bg-line"><span className={`absolute inset-y-0 left-0 ${tone}`} style={{ width: `${Math.max(4, p * 100)}%` }} /></span>
      <span className="w-7 text-right">{Math.round(p * 100)}</span>
    </span>
  );
}

const SEV_CLS: Record<string, string> = { high: "bg-neg text-white", medium: "bg-chart-emphasis/80 text-bg", low: "bg-line-strong text-muted" };
export function Sev({ s, short = false }: { s: "high" | "medium" | "low"; short?: boolean }) {
  return <span className={`inline-block rounded-sm px-1 text-[9.5px] font-bold uppercase tracking-wider ${SEV_CLS[s]}`}>{short ? s[0] : s === "medium" ? "med" : s}</span>;
}

export function Chip({ active, onClick, children, title, k }: { active?: boolean; onClick: () => void; children: ReactNode; title?: string; k?: string }) {
  return (
    <button type="button" onClick={onClick} title={title} aria-pressed={!!active}
      className={`num ctl shrink-0 border px-1.5 py-0.5 text-[10.5px] ${active ? "border-accent/60 bg-accent-soft text-accent" : "border-line text-muted hover:border-accent/40 hover:text-fg"}`}>
      {k && <span className="mr-1 text-faint">{k}</span>}{children}
    </button>
  );
}

/** A key cap and what it does, for the hint line. */
export const Keys = ({ items }: { items: [string, string][] }) => (
  <span className="hidden items-center gap-2 text-[10px] text-faint @2xl:inline-flex">{items.map(([k, v]) => <span key={k}><kbd className="rounded border border-line bg-elevated px-1 font-sans text-[9.5px] text-muted">{k}</kbd> {v}</span>)}</span>
);

/** Headline numbers across the top: a dense strip of label and value. */
export function Stats({ items }: { items: { label: string; value: ReactNode; tone?: string; title?: string }[] }) {
  return (
    <div className="grid grid-cols-3 gap-px border-b border-line bg-line @2xl:grid-cols-6">
      {items.map((s) => (
        <div key={s.label} className="min-w-0 bg-panel px-2.5 py-1.5" title={s.title}>
          <div className="truncate text-[9.5px] uppercase tracking-wider text-muted">{s.label}</div>
          <div className={`num truncate text-[14px] font-semibold leading-tight ${s.tone ?? "text-fg"}`}>{s.value}</div>
        </div>
      ))}
    </div>
  );
}

/* ---------------- Sources ---------------- */

const DOT: Record<string, string> = { ok: "bg-pos", empty: "bg-faint", stale: "bg-chart-emphasis", down: "bg-neg" };
const WORD: Record<string, string> = { ok: "live", empty: "nothing yet", stale: "stale", down: "not answering" };

/** Sources that are down or stale, in words, for the banner at the top. Null when all is well. */
export function Fallback({ sources, error, asOf }: { sources?: SourceState[]; error?: string | null; asOf?: string | null }) {
  const now = useClock();
  const bad = (sources ?? []).filter((s) => s.status === "down" || s.status === "stale");
  if (!bad.length && !error) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 border-b border-chart-emphasis/40 bg-chart-emphasis/10 px-3 py-1 text-[10.5px] text-fg/90" role="status">
      {error && <span><span className="font-semibold text-chart-emphasis">Refresh failed.</span> Showing the answer from {asOf ? `${etTime(asOf, now)} ET` : "earlier"}; it retries on its own.</span>}
      {bad.map((s) => <span key={s.id}><span className={`mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle ${DOT[s.status]}`} /><span className="font-semibold">{s.name}</span> {s.status === "down" ? "is not answering" : `is stale (as of ${shortAgo(s.asOf, now)} ago)`}{s.note ? `: ${s.note}` : ""}.</span>)}
    </div>
  );
}

/** The strip every monitor ends with: each source's state and as-of, when this answer was made, and that it is live. */
export function SourceStrip({ sources, asOf, pollMs, children }: { sources?: SourceState[]; asOf?: string; pollMs?: number; children?: ReactNode }) {
  const now = useClock();
  return (
    <footer className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-0.5 border-t border-line bg-panel/80 px-3 py-1 text-[10px] text-muted">
      {pollMs ? <span className="flex items-center gap-1 text-fg/80" title={`Refreshes every ${Math.round(pollMs / 1000)} seconds while open`}><span className="pulse-ring h-1.5 w-1.5 rounded-full bg-pos" />LIVE</span> : null}
      {asOf && <span title={asOf}>as of {etTime(asOf, now)} ET</span>}
      {(sources ?? []).map((s) => (
        <span key={s.id} className="inline-flex items-center gap-1" title={`${s.name}: ${WORD[s.status]}${s.asOf ? `, as of ${s.asOf.slice(0, 16).replace("T", " ")} UTC` : ""}${s.note ? `. ${s.note}` : ""}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${DOT[s.status]}`} />
          {s.url ? <a href={s.url} target="_blank" rel="noreferrer" className="hover:text-fg hover:underline">{s.name}</a> : s.name}
          {s.asOf && s.status !== "down" ? <span className="text-faint">{shortAgo(s.asOf, now)}</span> : null}
        </span>
      ))}
      {children}
    </footer>
  );
}

/** Loading and first-load failure for a monitor; once data has arrived the screen keeps it. */
export function Waiting({ error, what }: { error: string | null; what: string }) {
  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1.5 p-6 text-center">
        <div className="text-[13px] text-neg">Could not load {what}</div>
        <p className="max-w-[440px] text-[11.5px] text-muted">{error}</p>
        <p className="text-[10.5px] text-faint">It tries again on its own.</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2 p-3" aria-busy="true">
      <div className="flex items-center gap-2 text-[11px] text-muted"><span className="h-2 w-2 animate-pulse rounded-full bg-accent" /> Loading {what}…</div>
      {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="shimmer h-5 ctl" style={{ animationDelay: `${i * 50}ms` }} />)}
    </div>
  );
}

/** An honest empty screen: what was looked for, why there is nothing, and where to go instead. */
export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-1.5 p-4 text-[11.5px]">
      <div className="text-[13px] font-semibold text-fg">{title}</div>
      <div className="max-w-[640px] leading-relaxed text-muted">{children}</div>
    </div>
  );
}

/* ---------------- The keyboard table ---------------- */

export type Col<R> = { key: string; label: string; align?: "left" | "right" | "center"; value?: (r: R) => number | string | null; render: (r: R) => ReactNode; title?: string; className?: string; sortable?: boolean };

/**
 * A dense table driven from the keyboard. Focus it (click or Tab), then ↑ ↓ or j k move the cursor,
 * PgUp PgDn and Home End jump, Enter (or a click) opens the row's drill-down under it, Esc closes it, and
 * 1–9 sort by the n-th sortable column (again to flip). `onOpen` instead of a drill-down runs a command.
 */
export function NavTable<R>({ rows, cols, rowKey, initialSort, detail, onOpen, onCursor, rowClass, empty, autoFocus = true, label }: {
  rows: R[]; cols: Col<R>[]; rowKey: (r: R) => string; initialSort?: { key: string; desc: boolean };
  detail?: (r: R) => ReactNode; onOpen?: (r: R) => void; /** Told which row the cursor is on (a map rings it). */ onCursor?: (r: R | null) => void;
  rowClass?: (r: R) => string; empty?: ReactNode; autoFocus?: boolean; label: string;
}) {
  const [sort, setSort] = useState(initialSort ?? null);
  const [cursor, setCursor] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const sortable = cols.filter((c) => c.sortable !== false && c.value);
  const sorted = useMemo(() => {
    const c = sort ? cols.find((x) => x.key === sort.key) : null;
    if (!c?.value) return rows;
    const val = c.value;
    return [...rows].sort((a, b) => {
      const x = val(a), y = val(b);
      if (x === null || x === undefined || (typeof x === "number" && !Number.isFinite(x))) return 1;
      if (y === null || y === undefined || (typeof y === "number" && !Number.isFinite(y))) return -1;
      const d = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
      return sort!.desc ? -d : d;
    });
  }, [rows, cols, sort]);
  const at = Math.min(cursor, Math.max(0, sorted.length - 1));

  // A panel opened by a command takes the keyboard when nothing else has it (the command bar keeps it while typing).
  useEffect(() => {
    if (!autoFocus) return;
    const t = window.setTimeout(() => { const a = document.activeElement; if (!a || a === document.body) ref.current?.focus({ preventScroll: true }); }, 50);
    return () => window.clearTimeout(t);
  }, [autoFocus]);
  // Keep the cursor row in view, and say which it is.
  const current = sorted[at] ?? null;
  useEffect(() => { ref.current?.querySelector<HTMLElement>(`[data-row="${at}"]`)?.scrollIntoView({ block: "nearest" }); }, [at]);
  useEffect(() => { onCursor?.(current); }, [current, onCursor]);

  const toggleSort = (key: string) => setSort((s) => (s?.key === key ? { key, desc: !s.desc } : { key, desc: true }));
  const activate = (r: R) => { if (detail) setOpen((o) => (o === rowKey(r) ? null : rowKey(r))); else onOpen?.(r); };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.metaKey || e.ctrlKey || e.altKey) return;
    const page = 10;
    const move = (n: number) => { e.preventDefault(); setCursor(Math.max(0, Math.min(sorted.length - 1, n))); };
    if (e.key === "ArrowDown" || e.key === "j") move(at + 1);
    else if (e.key === "ArrowUp" || e.key === "k") move(at - 1);
    else if (e.key === "PageDown") move(at + page);
    else if (e.key === "PageUp") move(at - page);
    else if (e.key === "Home") move(0);
    else if (e.key === "End") move(sorted.length - 1);
    else if (e.key === "Enter" && sorted[at]) { e.preventDefault(); activate(sorted[at]); }
    else if (e.key === "Escape" && open) { e.preventDefault(); e.stopPropagation(); setOpen(null); }
    else if (/^[1-9]$/.test(e.key) && sortable[Number(e.key) - 1]) { e.preventDefault(); toggleSort(sortable[Number(e.key) - 1].key); }
  };
  if (!rows.length) return <div className="min-h-0 flex-1 overflow-auto">{empty ?? <div className="p-3 text-[11px] text-muted">Nothing to show.</div>}</div>;
  return (
    <div ref={ref} tabIndex={0} onKeyDown={onKey} role="grid" aria-label={label} aria-rowcount={sorted.length}
      className="table-scroll min-h-0 min-w-0 flex-1 overflow-auto outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent/50">
      <table className="num w-full whitespace-nowrap text-[11px]">
        <thead className="sticky top-0 z-10 bg-panel text-[9.5px] uppercase tracking-wider text-muted">
          <tr className="border-b border-line-strong">
            {cols.map((c) => {
              const n = sortable.indexOf(c);
              const align = c.align === "left" ? "text-left" : c.align === "center" ? "text-center" : "text-right";
              return (
                <th key={c.key} title={c.title} className={`px-1.5 py-1 font-normal first:pl-3 last:pr-3 ${align}`}>
                  {n >= 0 ? (
                    <button type="button" tabIndex={-1} onClick={() => toggleSort(c.key)} className={`uppercase tracking-wider hover:text-fg ${sort?.key === c.key ? "text-accent" : ""}`} title={`${c.title ?? c.label}. Sort: ${n + 1}`}>
                      {c.label}{sort?.key === c.key ? (sort.desc ? "▼" : "▲") : ""}
                    </button>
                  ) : c.label}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => {
            const key = rowKey(r);
            const isOpen = open === key;
            return [
              <tr key={key} data-row={i} aria-selected={i === at} onClick={() => { setCursor(i); activate(r); }}
                className={`cursor-pointer border-b border-line/40 ${i === at ? "bg-accent-soft/60 shadow-[inset_2px_0_0_var(--accent)]" : "hover:bg-elevated/60"} ${rowClass?.(r) ?? ""}`}>
                {cols.map((c) => <td key={c.key} className={`px-1.5 py-[3px] first:pl-3 last:pr-3 ${c.align === "left" ? "text-left font-sans" : c.align === "center" ? "text-center" : "text-right"} ${c.className ?? ""}`}>{c.render(r)}</td>)}
              </tr>,
              isOpen && detail ? <tr key={`${key}-d`} className="border-b border-line bg-elevated/30"><td colSpan={cols.length} className="whitespace-normal p-0">{detail(r)}</td></tr> : null,
            ];
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Buttons that run Terminal functions on a company (DES, SAT, ALT…), for drill-downs. */
export function FnLinks({ ticker, fns, onRun }: { ticker: string; fns: Command["fn"][]; onRun: Run }) {
  if (!ticker) return null;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {fns.map((fn) => <button key={fn} type="button" onClick={(e) => { e.stopPropagation(); onRun({ ticker, fn, via: "click" }); }} className="num ctl border border-line px-1.5 py-px text-[10px] text-accent hover:border-accent/50" title={`${ticker} ${fn}`}>{ticker} {fn}</button>)}
    </span>
  );
}
