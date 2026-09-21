"use client";

import { useState } from "react";

export type ColumnDatum = { label: string; value: number };

/**
 * Single-series column chart with a crosshair-style hover readout. Columns <= 24px, 4px rounded
 * cap, square baseline, 2px gaps. Hairline solid gridlines, clean-rounded ticks, last value labeled.
 */
export function Columns({
  data, format, title, height = 120,
}: { data: ColumnDatum[]; format: (v: number) => string; title: string; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const width = 360, padL = 36, padR = 8, padT = 14, padB = 18;
  const plotW = width - padL - padR, plotH = height - padT - padB;
  const max = Math.max(...data.map((d) => d.value), 0);
  const step = niceStep(max);
  const top = Math.ceil(max / step) * step || 1;
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const slot = plotW / data.length;
  const barW = Math.min(24, slot - 2);
  const y = (v: number) => padT + plotH - (v / top) * plotH;

  return (
    <figure className="m-0">
      <figcaption className="mb-1 text-[11px] text-muted">{title}</figcaption>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" role="img" aria-label={title} className="block max-w-[520px]"
        onPointerLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={width - padR} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth={1} />
            <text x={padL - 4} y={y(t) + 3} textAnchor="end" fontSize={9} fill="var(--muted)">{compact(t)}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const cx = padL + slot * i + slot / 2;
          const h = Math.max(y(0) - y(d.value), 0);
          const x0 = cx - barW / 2;
          const isHover = hover === i;
          const isLast = i === data.length - 1;
          return (
            <g key={d.label} onPointerEnter={() => setHover(i)} tabIndex={0} onFocus={() => setHover(i)} className="outline-none">
              <rect x={padL + slot * i} y={padT} width={slot} height={plotH} fill="transparent" />
              {h > 0 && (
                <path
                  d={`M${x0},${y(0)} V${y(d.value) + 4} a4,4 0 0 1 4,-4 h${barW - 8} a4,4 0 0 1 4,4 V${y(0)} Z`}
                  fill={isLast ? "var(--chart-emphasis)" : "var(--chart-1)"}
                  opacity={hover === null || isHover ? 1 : 0.55}
                />
              )}
              <text x={cx} y={height - 5} textAnchor="middle" fontSize={9} fill="var(--muted)">{d.label}</text>
              {(isLast || isHover) && (
                <text x={cx} y={y(d.value) - 4} textAnchor="middle" fontSize={10} fill="var(--fg)">{format(d.value)}</text>
              )}
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

function niceStep(max: number): number {
  if (max <= 0) return 1;
  const raw = max / 4;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / pow;
  const nice = m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10;
  return nice * pow;
}

function compact(v: number): string {
  if (v >= 1000) return `${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}B`;
  return v.toLocaleString("en-US");
}
