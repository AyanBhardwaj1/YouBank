"use client";

import { useState } from "react";

export type ScatterDatum = { key: string; label: string; x: number | null; y: number | null; emphasis?: boolean };

/**
 * Scatter with emphasis: the target in the accent hue, peers in the de-emphasis gray. Markers r=5
 * with a 2px surface ring, 24px hit areas, nearest-point hover readout. Every point direct-labeled
 * (peer sets are small) with the emphasis point bold.
 */
export function Scatter({
  data, xLabel, yLabel, fx, fy, title, height = 190,
}: {
  data: ScatterDatum[]; xLabel: string; yLabel: string;
  fx: (v: number) => string; fy: (v: number) => string; title: string; height?: number;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const pts = data.filter((d): d is ScatterDatum & { x: number; y: number } => d.x !== null && d.y !== null);
  const width = 360, padL = 40, padR = 16, padT = 12, padB = 26;
  const plotW = width - padL - padR, plotH = height - padT - padB;
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const sortedY = [...ys].sort((a, b) => a - b);
  const medY = sortedY.length ? sortedY[Math.floor(sortedY.length / 2)] : 0;
  const rawYMax = Math.max(...ys, 0.01);
  const yCap = medY > 0 ? Math.max(medY * 3, 0.01) : rawYMax; // outliers beyond 3x the median pin to the top edge
  const xMin = Math.min(0, ...xs), xMax = Math.max(...xs, 0.01) * 1.15;
  const yMin = Math.min(0, ...ys), yMax = Math.min(rawYMax, yCap) * 1.15;
  const X = (v: number) => padL + ((v - xMin) / (xMax - xMin)) * plotW;
  const Y = (v: number) => padT + plotH - ((Math.min(v, yMax) - yMin) / (yMax - yMin)) * plotH;
  const offScale = (v: number) => v > yMax;
  const xt = [0, 0.25, 0.5, 0.75, 1].map((f) => xMin + f * (xMax - xMin));
  const yt = [0, 0.25, 0.5, 0.75, 1].map((f) => yMin + f * (yMax - yMin));
  const h = pts.find((p) => p.key === hover);

  return (
    <figure className="m-0">
      <figcaption className="mb-1 text-[11px] text-muted">{title}</figcaption>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" role="img" aria-label={title} className="block max-w-[520px]"
        onPointerLeave={() => setHover(null)}>
        {yt.map((t) => <line key={`y${t}`} x1={padL} x2={width - padR} y1={Y(t)} y2={Y(t)} stroke="var(--line)" strokeWidth={1} />)}
        {xt.map((t) => <line key={`x${t}`} y1={padT} y2={padT + plotH} x1={X(t)} x2={X(t)} stroke="var(--line)" strokeWidth={1} />)}
        {yt.map((t) => <text key={`yl${t}`} x={padL - 4} y={Y(t) + 3} textAnchor="end" fontSize={9} fill="var(--muted)">{fy(t)}</text>)}
        {xt.map((t) => <text key={`xl${t}`} x={X(t)} y={height - 12} textAnchor="middle" fontSize={9} fill="var(--muted)">{fx(t)}</text>)}
        <text x={width - padR} y={height - 2} textAnchor="end" fontSize={9} fill="var(--muted)">{xLabel} →</text>
        <text x={padL + 2} y={padT - 3} fontSize={9} fill="var(--muted)">{yLabel} ↑</text>
        {pts.map((p) => {
          const isH = hover === p.key;
          return (
            <g key={p.key} onPointerEnter={() => setHover(p.key)} tabIndex={0} onFocus={() => setHover(p.key)} onBlur={() => setHover(null)} className="outline-none">
              <circle cx={X(p.x)} cy={Y(p.y)} r={12} fill="transparent" />
              <circle cx={X(p.x)} cy={Y(p.y)} r={p.emphasis ? 6 : 5} fill={p.emphasis ? "var(--chart-emphasis)" : "var(--chart-dim)"} stroke="var(--panel)" strokeWidth={2} opacity={hover && !isH && !p.emphasis ? 0.5 : 1} />
              <text x={X(p.x) + 8} y={Y(p.y) + 3} fontSize={10} fill={p.emphasis ? "var(--fg)" : "var(--muted)"} fontWeight={p.emphasis ? 600 : 400}>
                {p.label}{offScale(p.y) ? ` ↑ ${fy(p.y)}` : ""}
              </text>
            </g>
          );
        })}
        {h && (
          <g>
            <rect x={padL + 4} y={padT + 2} width={150} height={16} rx={2} fill="var(--elevated)" stroke="var(--line)" />
            <text x={padL + 9} y={padT + 14} fontSize={10} fill="var(--fg)">
              <tspan fontWeight={600}>{h.label}</tspan> {fx(h.x)} · {fy(h.y)}
            </text>
          </g>
        )}
      </svg>
    </figure>
  );
}
