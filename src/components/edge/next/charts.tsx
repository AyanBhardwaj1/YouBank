"use client";

/**
 * Small charts for Edge's next features, drawn in SVG with the app's own colour tokens so every theme
 * works: the reliability diagram (Track record, scorecards), a probability bar with its interval and the
 * base rate (Deal Radar), a sparkline (boards, Pulse on a phone) and a weekly line with its change points
 * shaded (Pulse). Each has a hover readout bigger than its marks, and each says in text what a colour says.
 */
import { useId, useState } from "react";

export const pct = (v: number | null | undefined, dp = 0) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : `${(v * 100).toFixed(dp)}%`);

type Bin = { lo: number; hi: number; n: number; meanP: number; rate: number; low: number; high: number };

/**
 * Stated probability (across) against what happened (up), one dot per bin sized by how many forecasts it
 * holds, with the 90% interval on each bin's rate. On the diagonal is perfectly calibrated.
 */
export function ReliabilityDiagram({ bins, size = 220, label = "Reliability diagram" }: { bins: Bin[]; size?: number; label?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const pad = 26, w = size, h = size, iw = w - pad - 8, ih = h - pad - 8;
  const x = (p: number) => pad + p * iw, y = (p: number) => 8 + (1 - p) * ih;
  const maxN = Math.max(1, ...bins.map((b) => b.n));
  const b = hover !== null ? bins[hover] : null;
  return (
    <figure className="relative" style={{ width: w }}>
      <svg width={w} height={h} role="img" aria-label={`${label}: ${bins.map((b) => `${pct(b.meanP)} stated, ${pct(b.rate)} happened (${b.n})`).join("; ") || "no resolved forecasts"}`}>
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={y(0)} y2={y(1)} stroke="var(--line)" strokeWidth={1} />
            <line x1={x(0)} x2={x(1)} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth={1} />
            <text x={x(t)} y={h - 8} fontSize={9} textAnchor="middle" fill="var(--muted)">{t * 100}</text>
            <text x={pad - 4} y={y(t) + 3} fontSize={9} textAnchor="end" fill="var(--muted)">{t * 100}</text>
          </g>
        ))}
        <line x1={x(0)} y1={y(0)} x2={x(1)} y2={y(1)} stroke="var(--faint)" strokeDasharray="4 3" strokeWidth={1} />
        {bins.map((bin, i) => (
          <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} tabIndex={0}>
            <line x1={x(bin.meanP)} x2={x(bin.meanP)} y1={y(bin.low)} y2={y(bin.high)} stroke="var(--accent)" strokeWidth={2} opacity={0.55} strokeLinecap="round" />
            <circle cx={x(bin.meanP)} cy={y(bin.rate)} r={4 + 4 * Math.sqrt(bin.n / maxN)} fill="var(--accent)" stroke="var(--panel)" strokeWidth={2} />
            <rect x={x(bin.lo)} y={y(1)} width={Math.max(8, x(bin.hi) - x(bin.lo))} height={ih} fill="transparent" />
          </g>
        ))}
        {!bins.length && <text x={x(0.5)} y={y(0.5)} fontSize={11} textAnchor="middle" fill="var(--muted)">Nothing resolved yet</text>}
      </svg>
      <figcaption className="mt-0.5 text-center text-[10px] text-muted">Stated probability (%) against what happened (%)</figcaption>
      {b && (
        <div className="pointer-events-none absolute left-2 top-2 rounded-md border border-line bg-elevated px-2 py-1 text-[11px] shadow-float">
          <div className="text-fg">Stated {pct(b.lo)}–{pct(b.hi)}: {b.n} forecast{b.n === 1 ? "" : "s"}</div>
          <div className="text-muted">Happened {pct(b.rate)} (90% interval {pct(b.low)}–{pct(b.high)}); stated on average {pct(b.meanP)}</div>
        </div>
      )}
    </figure>
  );
}

/** A probability as a bar from 0 to `max`, its interval as a whisker and the base rate as a tick. */
export function ProbBar({ p, low, high, base, max = 0.5, label }: { p: number; low?: number | null; high?: number | null; base?: number | null; max?: number; label?: string }) {
  const s = (v: number) => `${Math.min(100, (Math.max(0, v) / max) * 100)}%`;
  return (
    <div className="relative h-3 w-full" role="img" aria-label={`${label ?? "Probability"} ${pct(p)}${low != null && high != null ? `, interval ${pct(low)} to ${pct(high)}` : ""}${base != null ? `, base rate ${pct(base, 1)}` : ""}`}
      title={`${pct(p, 1)}${low != null && high != null ? ` (${pct(low, 1)}–${pct(high, 1)})` : ""}${base != null ? ` · base rate ${pct(base, 1)}` : ""}`}>
      <span className="absolute inset-y-1 left-0 right-0 rounded-full bg-line" />
      <span className="absolute inset-y-1 left-0 rounded-full bg-accent" style={{ width: s(p) }} />
      {low != null && high != null && <span className="absolute top-1/2 h-px -translate-y-1/2 bg-fg/70" style={{ left: s(low), width: `calc(${s(high)} - ${s(low)})` }} />}
      {low != null && <span className="absolute inset-y-0.5 w-px bg-fg/70" style={{ left: s(low) }} />}
      {high != null && <span className="absolute inset-y-0.5 w-px bg-fg/70" style={{ left: s(high) }} />}
      {base != null && <span className="absolute -inset-y-0.5 w-[2px] rounded bg-info" style={{ left: s(base) }} />}
    </div>
  );
}

/** A small line of values, latest point marked. */
export function Sparkline({ values, width = 96, height = 24, tone = "accent", label }: { values: number[]; width?: number; height?: number; tone?: "accent" | "info" | "muted"; label?: string }) {
  const v = values.filter((x) => Number.isFinite(x));
  if (v.length < 2) return <span className="inline-block text-[10px] text-faint" style={{ width }}>—</span>;
  const lo = Math.min(...v), hi = Math.max(...v), span = hi - lo || 1;
  const pts = v.map((x, i) => [(i / (v.length - 1)) * (width - 4) + 2, height - 3 - ((x - lo) / span) * (height - 6)]);
  const color = tone === "info" ? "var(--info)" : tone === "muted" ? "var(--muted)" : "var(--accent)";
  return (
    <svg width={width} height={height} role="img" aria-label={`${label ?? "Trend"}: from ${v[0]} to ${v[v.length - 1]}`}>
      <polyline points={pts.map((p) => p.join(",")).join(" ")} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r={2.5} fill={color} />
    </svg>
  );
}

/**
 * A weekly series with the weeks a change point was flagged shaded, and a crosshair readout. `marks`
 * are dated events drawn as ticks on the axis (a WARN notice, an award, a Form D raise).
 */
export function SeriesChart({ points, flagged = [], marks = [], height = 120, unit = "", label }: { points: { period: string; value: number }[]; flagged?: string[]; marks?: { date: string; label: string }[]; height?: number; unit?: string; label: string }) {
  const id = useId();
  const [hover, setHover] = useState<number | null>(null);
  const w = 320, pad = 4, h = height;
  if (points.length < 2) return <div className="flex items-center justify-center rounded-md border border-dashed border-line text-[11px] text-muted" style={{ height }}>Not enough weeks yet</div>;
  const vals = points.map((p) => p.value), lo = Math.min(0, ...vals), hi = Math.max(...vals) || 1;
  const x = (i: number) => pad + (i / (points.length - 1)) * (w - 2 * pad), y = (v: number) => h - 14 - ((v - lo) / (hi - lo || 1)) * (h - 24);
  const t0 = Date.parse(points[0].period), t1 = Date.parse(points[points.length - 1].period);
  const xt = (d: string) => pad + ((Date.parse(d) - t0) / Math.max(1, t1 - t0)) * (w - 2 * pad);
  const flag = new Set(flagged);
  const p = hover !== null ? points[hover] : null;
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ height }} role="img" aria-label={`${label}: ${points.length} weeks, latest ${vals[vals.length - 1]}${unit ? ` ${unit}` : ""}${flagged.length ? `; change flagged in ${flagged.length} week${flagged.length === 1 ? "" : "s"}` : ""}`}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); const fx = ((e.clientX - r.left) / r.width) * w; setHover(Math.max(0, Math.min(points.length - 1, Math.round(((fx - pad) / (w - 2 * pad)) * (points.length - 1))))); }}>
        {points.map((pt, i) => flag.has(pt.period) ? <rect key={`f${i}`} x={x(Math.max(0, i - 0.5))} width={Math.max(2, x(1) - x(0))} y={4} height={h - 18} fill="var(--accent-soft)" /> : null)}
        <line x1={pad} x2={w - pad} y1={y(lo)} y2={y(lo)} stroke="var(--line)" />
        <defs><linearGradient id={`g${id}`} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="var(--accent)" stopOpacity="0.25" /><stop offset="1" stopColor="var(--accent)" stopOpacity="0" /></linearGradient></defs>
        <path d={`M${x(0)},${y(lo)} ${points.map((pt, i) => `L${x(i)},${y(pt.value)}`).join(" ")} L${x(points.length - 1)},${y(lo)} Z`} fill={`url(#g${id})`} />
        <polyline points={points.map((pt, i) => `${x(i)},${y(pt.value)}`).join(" ")} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        {marks.filter((m) => Date.parse(m.date) >= t0).map((m, i) => <line key={`m${i}`} x1={xt(m.date)} x2={xt(m.date)} y1={h - 12} y2={h - 4} stroke="var(--info)" strokeWidth={2}><title>{`${m.date}: ${m.label}`}</title></line>)}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={4} y2={h - 14} stroke="var(--muted)" strokeDasharray="2 2" />}
        {hover !== null && <circle cx={x(hover)} cy={y(points[hover].value)} r={4} fill="var(--accent)" stroke="var(--panel)" strokeWidth={2} />}
      </svg>
      {p && <div className="pointer-events-none absolute right-1 top-1 rounded border border-line bg-elevated px-1.5 py-0.5 text-[10.5px]"><span className="num text-muted">{p.period}</span> <span className="num text-fg">{p.value.toLocaleString("en-US", { maximumFractionDigits: 2 })}</span>{flag.has(p.period) ? <span className="text-accent"> · change flagged</span> : null}</div>}
    </div>
  );
}
