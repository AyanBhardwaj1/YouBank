"use client";

/**
 * Algo trading's charts, in SVG with the theme's tokens (copy trading's line chart is reused for equity
 * curves): the drawdown area, risk-limit gauges and the metric tiles with their intervals.
 * Colour jobs: losses and limits near breach in the negative token, headroom in the de-emphasis grey,
 * everything else in the foreground; no colour carries meaning alone (each gauge has its numbers).
 */
import { useMemo, useRef, useState } from "react";

type P = { date: string; value: number };
const pct = (v: number, dp = 1) => `${(v * 100).toFixed(dp)}%`;

/** Drawdown below the running peak, as a filled area under zero, with a crosshair readout. */
export function DrawdownChart({ points, title, height = 140 }: { points: P[]; title: string; height?: number }) {
  const ref = useRef<SVGSVGElement>(null);
  const [hi, setHi] = useState<number | null>(null);
  const W = 720, padL = 44, padR = 12, padT = 8, padB = 20;
  const min = useMemo(() => Math.min(-0.01, ...points.map((p) => p.value)), [points]);
  if (points.length < 2) return <p className="text-[11.5px] text-muted">Not enough data to draw this.</p>;
  const X = (i: number) => padL + (i / (points.length - 1)) * (W - padL - padR);
  const Y = (v: number) => padT + (v / min) * (height - padT - padB);
  const d = `M${X(0)},${Y(0)} ${points.map((p, i) => `L${X(i).toFixed(1)},${Y(p.value).toFixed(1)}`).join(" ")} L${X(points.length - 1)},${Y(0)} Z`;
  const worst = points.reduce((a, p, i) => (p.value < points[a].value ? i : a), 0);
  const move = (e: React.PointerEvent) => { const r = ref.current?.getBoundingClientRect(); if (!r) return; const x = ((e.clientX - r.left) / r.width) * W; setHi(Math.max(0, Math.min(points.length - 1, Math.round(((x - padL) / (W - padL - padR)) * (points.length - 1))))); };
  return (
    <figure className="m-0">
      <figcaption className="mb-1 flex justify-between text-[11px] text-muted"><span>{title}</span><span className="num">worst {pct(points[worst].value)} on {points[worst].date}</span></figcaption>
      <div className="relative">
        <svg ref={ref} viewBox={`0 0 ${W} ${height}`} width="100%" role="img" aria-label={title} className="block touch-none" onPointerMove={move} onPointerDown={move} onPointerLeave={() => setHi(null)}>
          {[0, 0.5, 1].map((k) => <g key={k}><line x1={padL} x2={W - padR} y1={Y(min * k)} y2={Y(min * k)} stroke="var(--line)" /><text x={padL - 6} y={Y(min * k) + 3} textAnchor="end" fontSize={9.5} fill="var(--muted)" className="num">{pct(min * k, 0)}</text></g>)}
          <path d={d} fill="var(--neg)" opacity={0.25} stroke="var(--neg)" strokeWidth={1.2} />
          {hi !== null && <line x1={X(hi)} x2={X(hi)} y1={padT} y2={height - padB} stroke="var(--line-strong)" />}
          <text x={padL} y={height - 5} fontSize={9.5} fill="var(--muted)">{points[0].date}</text>
          <text x={W - padR} y={height - 5} fontSize={9.5} fill="var(--muted)" textAnchor="end">{points.at(-1)!.date}</text>
        </svg>
        {hi !== null && <div className="pointer-events-none absolute right-1 top-1 rounded-md border border-line bg-elevated px-2 py-1 text-[11px] shadow-lg"><span className="text-muted">{points[hi].date}</span> <span className="num text-fg">{pct(points[hi].value)}</span></div>}
      </div>
    </figure>
  );
}

export type Gauge = { key: string; label: string; used: number; limit: number; unit: "usd" | "pct" | "count" };

const fmt = (v: number, u: Gauge["unit"]) => (u === "usd" ? `$${Math.round(v).toLocaleString("en-US")}` : u === "pct" ? pct(v) : String(Math.round(v)));

/** How much of each risk limit is used: a bar per limit with both numbers; past 80% the bar turns to the negative token. */
export function RiskGauges({ gauges }: { gauges: Gauge[] }) {
  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {gauges.map((g) => {
        const share = g.limit > 0 ? Math.min(1, g.used / g.limit) : 0;
        return (
          <li key={g.key} className="rounded-md border border-line p-2">
            <div className="flex items-baseline justify-between gap-2 text-[11.5px]"><span className="text-muted">{g.label}</span><span className="num text-fg">{fmt(g.used, g.unit)} <span className="text-muted">of {fmt(g.limit, g.unit)}</span></span></div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-elevated" role="meter" aria-label={g.label} aria-valuemin={0} aria-valuemax={g.limit} aria-valuenow={g.used}>
              <div className="h-full rounded-full" style={{ width: `${share * 100}%`, background: share >= 0.8 ? "var(--neg)" : "var(--chart-emphasis, var(--accent))" }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** A metric tile, with its 90% bootstrap interval when there is one. */
export function Stat({ label, value, interval, hint }: { label: string; value: string; interval?: string | null; hint?: string }) {
  return (
    <div className="rounded-md border border-line p-2" title={hint}>
      <div className="text-[10.5px] uppercase tracking-wide text-muted">{label}</div>
      <div className="num mt-0.5 text-[15px] font-semibold text-fg">{value}</div>
      {interval && <div className="num text-[10.5px] text-muted">{interval}</div>}
    </div>
  );
}
