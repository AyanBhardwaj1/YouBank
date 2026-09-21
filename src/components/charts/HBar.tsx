"use client";

import { useState } from "react";

export type HBarDatum = { key: string; label: string; value: number | null; emphasis?: boolean; note?: string };

/**
 * Horizontal bars, one series. Emphasis form: highlighted items in the accent hue, the rest in the
 * de-emphasis gray. Bars <= 14px thick, 4px rounded data-end, square at the baseline, 2px gap.
 * Values labeled at the tip (few bars, so every tip gets a label). Hover tooltip per bar.
 */
export function HBar({
  data, format, title, maxBars = 12, referenceLine,
}: {
  data: HBarDatum[];
  format: (v: number | null) => string;
  title: string;
  maxBars?: number;
  referenceLine?: { value: number; label: string };
}) {
  const [hover, setHover] = useState<string | null>(null);
  const rows = data.slice(0, maxBars);
  const vals = rows.map((r) => r.value).filter((v): v is number => v !== null);
  const max = Math.max(...vals, referenceLine?.value ?? 0, 0) || 1;
  const rowH = 18, barH = 12, labelW = 48, valueW = 52, padR = 8;
  const width = 320, height = rows.length * rowH + 16;
  const plotW = width - labelW - valueW - padR;
  const x = (v: number) => labelW + (Math.max(v, 0) / max) * plotW;
  const anyEmphasis = rows.some((r) => r.emphasis);

  return (
    <figure className="m-0">
      <figcaption className="mb-1 text-[11px] text-muted">{title}</figcaption>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" role="img" aria-label={title} className="block max-w-[420px]">
        <line x1={labelW} x2={labelW} y1={0} y2={height} stroke="var(--line)" strokeWidth={1} />
        {referenceLine && referenceLine.value > 0 && (
          <g>
            <line x1={x(referenceLine.value)} x2={x(referenceLine.value)} y1={10} y2={height - 2} stroke="var(--muted)" strokeWidth={1} />
            <text x={x(referenceLine.value) + 3} y={8} fontSize={9} fill="var(--muted)">{referenceLine.label}</text>
          </g>
        )}
        {rows.map((r, i) => {
          const y = i * rowH + 13;
          const w = r.value === null ? 0 : Math.max(x(r.value) - labelW, 0);
          const fill = r.emphasis ? "var(--chart-emphasis)" : anyEmphasis ? "var(--chart-dim)" : "var(--chart-1)";
          const isHover = hover === r.key;
          return (
            <g
              key={r.key}
              onPointerEnter={() => setHover(r.key)}
              onPointerLeave={() => setHover(null)}
              tabIndex={0}
              onFocus={() => setHover(r.key)}
              onBlur={() => setHover(null)}
              className="outline-none"
            >
              <rect x={0} y={y - 3} width={width} height={rowH} fill="transparent" />
              <text x={labelW - 6} y={y + barH - 2} textAnchor="end" fontSize={10} fill={r.emphasis ? "var(--fg)" : "var(--muted)"} fontWeight={r.emphasis ? 600 : 400}>
                {r.label}
              </text>
              {w > 0 && (
                <path
                  d={`M${labelW},${y} H${labelW + Math.max(w - 4, 0)} a4,4 0 0 1 4,4 v${barH - 8} a4,4 0 0 1 -4,4 H${labelW} Z`}
                  fill={fill}
                  opacity={isHover ? 1 : 0.9}
                />
              )}
              <text x={labelW + w + 5} y={y + barH - 2} fontSize={10} fill="var(--fg)">{format(r.value)}</text>
              {isHover && r.note && (
                <text x={width - padR} y={y + barH - 2} textAnchor="end" fontSize={9} fill="var(--muted)">{r.note}</text>
              )}
            </g>
          );
        })}
      </svg>
    </figure>
  );
}
