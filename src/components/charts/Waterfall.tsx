"use client";

import { useState } from "react";

export type WaterfallStep = { label: string; value: number; total?: boolean };

/** Bridge chart: floating bars for deltas, grounded bars for totals. Positive steps in chart-1, negatives in neg, totals in emphasis. */
export function Waterfall({ steps, format, title, height = 200 }: { steps: WaterfallStep[]; format: (v: number) => string; title?: string; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const width = 480, padL = 44, padR = 10, padT = 18, padB = 34;
  const plotW = width - padL - padR, plotH = height - padT - padB;
  const bars = steps.reduce<{ start: number; end: number; total: boolean; label: string; value: number }[]>((acc, s) => {
    const running = acc.length ? acc[acc.length - 1].end : 0;
    acc.push(s.total ? { start: 0, end: s.value, total: true, label: s.label, value: s.value } : { start: running, end: running + s.value, total: false, label: s.label, value: s.value });
    return acc;
  }, []);
  const lo = Math.min(0, ...bars.map((b) => Math.min(b.start, b.end)));
  const hi = Math.max(0, ...bars.map((b) => Math.max(b.start, b.end)));
  const span = hi - lo || 1;
  const y = (v: number) => padT + plotH - ((v - lo) / span) * plotH;
  const slot = plotW / bars.length;
  const barW = Math.min(46, slot * 0.7);
  return (
    <figure className="m-0">
      {title && <figcaption className="mb-1 text-[11px] text-muted">{title}</figcaption>}
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" role="img" aria-label={title ?? "Bridge"} className="block max-w-[640px]" onPointerLeave={() => setHover(null)}>
        <line x1={padL} x2={width - padR} y1={y(0)} y2={y(0)} stroke="var(--line-strong)" strokeWidth={1} />
        {bars.map((b, i) => {
          const x = padL + slot * i + (slot - barW) / 2;
          const top = y(Math.max(b.start, b.end)), bottom = y(Math.min(b.start, b.end));
          const fill = b.total ? "var(--chart-emphasis)" : b.value >= 0 ? "var(--chart-1)" : "var(--neg)";
          const next = bars[i + 1];
          return (
            <g key={i} onPointerEnter={() => setHover(i)} className="outline-none">
              <rect x={padL + slot * i} y={padT} width={slot} height={plotH} fill="transparent" />
              <rect x={x} y={top} width={barW} height={Math.max(bottom - top, 1)} fill={fill} opacity={hover === null || hover === i ? 0.95 : 0.5} rx={2} className="grow-y" style={{ animationDelay: `${i * 70}ms`, transformOrigin: `${x + barW / 2}px ${b.value >= 0 || b.total ? bottom : top}px` }} />
              {next && !next.total && <line x1={x + barW} x2={padL + slot * (i + 1) + (slot - barW) / 2} y1={y(b.end)} y2={y(b.end)} stroke="var(--muted)" strokeDasharray="2 3" strokeWidth={1} />}
              <text x={x + barW / 2} y={top - 4} textAnchor="middle" fontSize={9.5} fill="var(--fg)">{format(b.value)}</text>
              <text x={x + barW / 2} y={height - 18} textAnchor="middle" fontSize={9} fill={b.total ? "var(--fg)" : "var(--muted)"} fontWeight={b.total ? 600 : 400}>
                {b.label.length > 14 ? b.label.slice(0, 13) + "…" : b.label}
              </text>
            </g>
          );
        })}
        {hover !== null && <text x={width - padR} y={padT - 4} textAnchor="end" fontSize={10} fill="var(--fg)">{bars[hover].label}: {format(bars[hover].value)}</text>}
      </svg>
    </figure>
  );
}
