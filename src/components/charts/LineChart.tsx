"use client";

import { useState } from "react";

export type LineSeries = { name: string; points: { x: string; y: number | null }[] };

const PALETTE = ["var(--chart-1)", "var(--chart-emphasis)", "var(--pos)", "var(--info)", "var(--neg)", "var(--muted)"];

/** Multi-series line chart with drawn-in strokes, hover readout, and direct labels at the end of each line. */
export function LineChart({ series, format, title, height = 200 }: { series: LineSeries[]; format: (v: number) => string; title?: string; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const width = 520, padL = 48, padR = 70, padT = 14, padB = 26;
  const plotW = width - padL - padR, plotH = height - padT - padB;
  const xs = series[0]?.points.map((p) => p.x) ?? [];
  const ys = series.flatMap((s) => s.points.map((p) => p.y)).filter((v): v is number => v !== null);
  if (!xs.length || !ys.length) return <div className="text-[11px] text-muted">No data</div>;
  const lo = Math.min(0, ...ys), hi = Math.max(...ys) * 1.08 || 1;
  const X = (i: number) => padL + (xs.length === 1 ? plotW / 2 : (i / (xs.length - 1)) * plotW);
  const Y = (v: number) => padT + plotH - ((v - lo) / (hi - lo || 1)) * plotH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => lo + f * (hi - lo));
  return (
    <figure className="m-0">
      {title && <figcaption className="mb-1 text-[11px] text-muted">{title}</figcaption>}
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" role="img" aria-label={title ?? "Line chart"} className="block max-w-[680px]" onPointerLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={width - padR} y1={Y(t)} y2={Y(t)} stroke="var(--line)" strokeWidth={1} />
            <text x={padL - 5} y={Y(t) + 3} textAnchor="end" fontSize={9} fill="var(--muted)">{format(t)}</text>
          </g>
        ))}
        {xs.map((x, i) => (i % Math.ceil(xs.length / 8) === 0 || i === xs.length - 1) && <text key={x} x={X(i)} y={height - 8} textAnchor="middle" fontSize={9} fill="var(--muted)">{x}</text>)}
        {series.map((s, si) => {
          const pts = s.points.map((p, i) => (p.y === null ? null : `${X(i).toFixed(1)},${Y(p.y).toFixed(1)}`));
          const d = pts.map((p, i) => (p === null ? "" : `${i === 0 || pts[i - 1] === null ? "M" : "L"}${p}`)).join(" ");
          const lastIdx = s.points.map((p) => p.y).lastIndexOf(s.points.filter((p) => p.y !== null).slice(-1)[0]?.y ?? null);
          const color = PALETTE[si % PALETTE.length];
          return (
            <g key={s.name}>
              <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" className="draw" style={{ animationDelay: `${si * 200}ms` }} />
              {lastIdx >= 0 && s.points[lastIdx].y !== null && (
                <>
                  <circle cx={X(lastIdx)} cy={Y(s.points[lastIdx].y!)} r={4} fill={color} stroke="var(--panel)" strokeWidth={2} />
                  <text x={X(lastIdx) + 7} y={Y(s.points[lastIdx].y!) + 3} fontSize={9.5} fill="var(--fg)">{s.name}</text>
                </>
              )}
            </g>
          );
        })}
        {xs.map((_, i) => <rect key={i} x={X(i) - plotW / xs.length / 2} y={padT} width={plotW / Math.max(xs.length, 1)} height={plotH} fill="transparent" onPointerEnter={() => setHover(i)} />)}
        {hover !== null && (
          <g>
            <line x1={X(hover)} x2={X(hover)} y1={padT} y2={padT + plotH} stroke="var(--muted)" strokeDasharray="2 3" />
            <rect x={Math.min(X(hover) + 6, width - padR - 150)} y={padT + 2} width={148} height={12 + series.length * 12} rx={2} fill="var(--elevated)" stroke="var(--line)" />
            <text x={Math.min(X(hover) + 11, width - padR - 145)} y={padT + 12} fontSize={9.5} fill="var(--muted)">{xs[hover]}</text>
            {series.map((s, si) => (
              <text key={s.name} x={Math.min(X(hover) + 11, width - padR - 145)} y={padT + 24 + si * 12} fontSize={9.5} fill="var(--fg)">
                <tspan fill={PALETTE[si % PALETTE.length]}>●</tspan> {s.name}: {s.points[hover]?.y === null || s.points[hover] === undefined ? "n/a" : format(s.points[hover].y as number)}
              </text>
            ))}
          </g>
        )}
      </svg>
    </figure>
  );
}
