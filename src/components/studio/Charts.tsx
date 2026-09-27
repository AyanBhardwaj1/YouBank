"use client";

import { formatValue } from "@/lib/studio/format";
import type { ChartData, ChartKind } from "@/lib/studio/types";

/**
 * Slide charts as SVG, drawn the way the .pptx export draws them: native-looking column, bar, line,
 * stacked and pie charts, and banker football fields and waterfalls. Coordinates are in a 1000-wide box.
 */
const SERIES = ["#0B2545", "#C8963E", "#5B7DB1", "#8DA9C4", "#A15C38", "#6B8F71"];
const f = (v: number, nf?: string) => formatValue(v, nf ?? (Math.abs(v) >= 100 ? "#,##0" : "#,##0.0")).text.trim();

export function Chart({ kind, data, title, nf, marker, primary, accent, w, h }: {
  kind: ChartKind; data: ChartData | null; title?: string; nf?: string; marker?: { label: string; value: number } | null;
  primary: string; accent: string; w: number; h: number;
}) {
  const W = 1000, H = Math.max(200, Math.round((1000 * h) / Math.max(w, 0.1)));
  if (!data || !data.series.length || !data.labels.length) {
    return <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full"><rect x={1} y={1} width={W - 2} height={H - 2} fill="#F7F8FA" stroke="#D9DEE6" strokeDasharray="8 6" /><text x={W / 2} y={H / 2} textAnchor="middle" fontSize={28} fill="#8A94A3">No data from the link</text></svg>;
  }
  const top = title ? 56 : 16;
  const head = title ? <text x={0} y={34} fontSize={26} fontWeight={700} fill={primary}>{title}</text> : null;
  const colors = [primary, accent, ...SERIES.slice(2)];

  if (kind === "football") {
    const lows = data.series[0].values, highs = data.series[1]?.values ?? [];
    const vals = [...lows, ...highs, marker?.value ?? null].filter((x): x is number => x !== null);
    const lo = Math.min(...vals), hi = Math.max(...vals), pad = (hi - lo) * 0.1 || 1;
    const a = lo - pad, b = hi + pad, L = 330, R = W - 110;
    const X = (v: number) => L + ((v - a) / (b - a)) * (R - L);
    const rowH = Math.min(90, (H - top - 50) / data.labels.length);
    return (
      <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full" fontFamily="Arial, sans-serif">
        {head}
        {data.labels.map((label, i) => {
          const y = top + i * rowH, l = lows[i], r = highs[i];
          return (
            <g key={i}>
              <text x={0} y={y + rowH / 2 + 7} fontSize={19} fill="#1F1F1F">{label.length > 36 ? `${label.slice(0, 35)}…` : label}</text>
              {l !== null && r !== null && l !== undefined && r !== undefined && <>
                <rect x={X(Math.min(l, r))} y={y + rowH * 0.22} width={Math.max(3, X(Math.max(l, r)) - X(Math.min(l, r)))} height={rowH * 0.56} fill={primary} rx={2} />
                <text x={X(Math.min(l, r)) - 8} y={y + rowH / 2 + 7} fontSize={19} fill="#6B7280" textAnchor="end">{f(Math.min(l, r), nf)}</text>
                <text x={X(Math.max(l, r)) + 8} y={y + rowH / 2 + 7} fontSize={19} fill="#6B7280">{f(Math.max(l, r), nf)}</text>
              </>}
            </g>
          );
        })}
        {marker && <g>
          <line x1={X(marker.value)} x2={X(marker.value)} y1={top - 6} y2={top + rowH * data.labels.length + 6} stroke={accent} strokeWidth={3} strokeDasharray="10 7" />
          <text x={X(marker.value)} y={top + rowH * data.labels.length + 34} fontSize={20} fontWeight={700} fill={accent} textAnchor="middle">{marker.label}: {f(marker.value, nf)}</text>
        </g>}
      </svg>
    );
  }

  if (kind === "waterfall") {
    const bars = waterfallBars(data);
    const all = bars.flatMap((x) => [x.from, x.to]);
    const lo = Math.min(0, ...all), hi = Math.max(0, ...all), span = hi - lo || 1;
    const ph = H - top - 70, Y = (v: number) => top + 30 + ((hi - v) / span) * ph, bw = W / bars.length;
    return (
      <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full" fontFamily="Arial, sans-serif">
        {head}
        {bars.map((x, i) => {
          const y1 = Y(Math.max(x.from, x.to)), y2 = Y(Math.min(x.from, x.to));
          const color = x.total ? primary : x.to >= x.from ? "#4E8F5A" : "#B24C3E";
          return (
            <g key={i}>
              <rect x={i * bw + bw * 0.15} y={y1} width={bw * 0.7} height={Math.max(2, y2 - y1)} fill={color} />
              <text x={i * bw + bw / 2} y={y1 - 8} fontSize={19} textAnchor="middle" fill="#1F1F1F">{f(x.total ? x.to : x.to - x.from, nf)}</text>
              <text x={i * bw + bw / 2} y={H - 18} fontSize={18} textAnchor="middle" fill="#6B7280">{data.labels[i].slice(0, 16)}</text>
            </g>
          );
        })}
      </svg>
    );
  }

  if (kind === "pie") {
    const vals = data.series[0].values.map((v) => Math.max(0, v ?? 0));
    const total = vals.reduce((a, b) => a + b, 0) || 1;
    const cx = H / 2 + 10, cy = top + (H - top) / 2, rad = (H - top) / 2 - 16;
    const paths = pieSlices(vals, total, cx, cy, rad);
    return (
      <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full" fontFamily="Arial, sans-serif">
        {head}
        {paths.map((d, i) => <path key={i} d={d} fill={SERIES[i % SERIES.length]} stroke="#fff" strokeWidth={3} />)}
        {data.labels.map((l, i) => (
          <g key={l + i}><rect x={cx + rad + 40} y={top + 10 + i * 38} width={22} height={22} fill={SERIES[i % SERIES.length]} /><text x={cx + rad + 72} y={top + 28 + i * 38} fontSize={20} fill="#1F1F1F">{l} · {f((vals[i] / total) * 100, "0.0")}%</text></g>
        ))}
      </svg>
    );
  }

  // Column, bar, stacked and line charts share one plot area.
  const n = data.labels.length, s = data.series.length;
  const stacked = kind === "stacked";
  const totals = data.labels.map((_, i) => data.series.reduce((acc, se) => acc + Math.max(0, se.values[i] ?? 0), 0));
  const flat = stacked ? [...totals, ...data.labels.map((_, i) => data.series.reduce((acc, se) => acc + Math.min(0, se.values[i] ?? 0), 0))] : data.series.flatMap((se) => se.values.map((v) => v ?? 0));
  const lo = Math.min(0, ...flat), hi = Math.max(0, ...flat), span = hi - lo || 1;
  const legend = s > 1 ? 40 : 0;
  if (kind === "bar") {
    const L = 170, R = W - 90, rowH = (H - top - legend - 10) / n;
    const X = (v: number) => L + ((v - lo) / span) * (R - L);
    return (
      <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full" fontFamily="Arial, sans-serif">
        {head}
        {data.labels.map((label, i) => (
          <g key={i}>
            <text x={L - 10} y={top + i * rowH + rowH / 2 + 7} fontSize={19} textAnchor="end" fill="#1F1F1F">{label.slice(0, 18)}</text>
            {data.series.map((se, j) => { const v = se.values[i] ?? 0; const bh = (rowH * 0.7) / s; const y = top + i * rowH + rowH * 0.15 + j * bh; return <g key={j}><rect x={Math.min(X(0), X(v))} y={y} width={Math.max(2, Math.abs(X(v) - X(0)))} height={bh - 2} fill={colors[j % colors.length]} /><text x={Math.max(X(0), X(v)) + 6} y={y + bh / 2 + 6} fontSize={17} fill="#374151">{f(v, nf)}</text></g>; })}
          </g>
        ))}
        <line x1={X(0)} x2={X(0)} y1={top} y2={H - legend - 10} stroke="#9CA3AF" />
      </svg>
    );
  }
  // Room under the lowest negative bar for its value label, above the category labels.
  const B = H - 46 - legend - (lo < 0 ? 28 : 0), T = top + 26, bw = W / n;
  const Y = (v: number) => T + ((hi - v) / span) * (B - T);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full" fontFamily="Arial, sans-serif">
      {head}
      <line x1={0} x2={W} y1={Y(0)} y2={Y(0)} stroke="#9CA3AF" />
      {kind === "line"
        ? data.series.map((se, j) => {
          const pts = se.values.map((v, i) => `${i * bw + bw / 2},${Y(v ?? 0)}`).join(" ");
          return <g key={j}><polyline points={pts} fill="none" stroke={colors[j % colors.length]} strokeWidth={4} />{se.values.map((v, i) => <circle key={i} cx={i * bw + bw / 2} cy={Y(v ?? 0)} r={6} fill={colors[j % colors.length]} />)}</g>;
        })
        : stacked
          ? stackSegments(data).map((seg) => <rect key={`${seg.i}-${seg.j}`} x={seg.i * bw + bw * 0.2} y={Y(Math.max(seg.from, seg.to))} width={bw * 0.6} height={Math.max(1, Math.abs(Y(seg.from) - Y(seg.to)))} fill={colors[seg.j % colors.length]} />)
          : data.labels.map((_, i) => data.series.map((se, j) => {
            const v = se.values[i] ?? 0;
            const cw = (bw * 0.7) / s, x = i * bw + bw * 0.15 + j * cw;
            return <g key={`${i}-${j}`}><rect x={x} y={Math.min(Y(0), Y(v))} width={cw - 3} height={Math.max(2, Math.abs(Y(v) - Y(0)))} fill={colors[j % colors.length]} />{s <= 2 && <text x={x + cw / 2} y={v >= 0 ? Y(v) - 8 : Y(v) + 22} fontSize={18} textAnchor="middle" fill="#374151">{f(v, nf)}</text>}</g>;
          }))}
      {data.labels.map((l, i) => <text key={i} x={i * bw + bw / 2} y={H - 16 - legend} fontSize={18} textAnchor="middle" fill="#6B7280">{l.slice(0, 14)}</text>)}
      {s > 1 && data.series.map((se, j) => <g key={j}><rect x={j * 220} y={H - 28} width={20} height={20} fill={colors[j % colors.length]} /><text x={j * 220 + 28} y={H - 12} fontSize={18} fill="#374151">{se.name.slice(0, 18)}</text></g>)}
    </svg>
  );
}

/** Bars of a waterfall: the first row and any total-like row stand on zero; the rest float on the running total. */
function waterfallBars(data: ChartData): { from: number; to: number; total: boolean }[] {
  const out: { from: number; to: number; total: boolean }[] = [];
  let run = 0;
  data.series[0].values.forEach((raw, i) => {
    const v = raw ?? 0;
    if (i === 0 || /total|value|ending|net|equity|enterprise/i.test(data.labels[i])) { run = v; out.push({ from: 0, to: v, total: true }); }
    else { out.push({ from: run, to: run + v, total: false }); run += v; }
  });
  return out;
}

function pieSlices(vals: number[], total: number, cx: number, cy: number, rad: number): string[] {
  const out: string[] = [];
  let ang = -Math.PI / 2;
  for (const v of vals) {
    const a2 = ang + (v / total) * Math.PI * 2;
    const large = a2 - ang > Math.PI ? 1 : 0;
    out.push(`M${cx},${cy} L${cx + rad * Math.cos(ang)},${cy + rad * Math.sin(ang)} A${rad},${rad} 0 ${large} 1 ${cx + rad * Math.cos(a2)},${cy + rad * Math.sin(a2)} Z`);
    ang = a2;
  }
  return out;
}

function stackSegments(data: ChartData): { i: number; j: number; from: number; to: number }[] {
  const out: { i: number; j: number; from: number; to: number }[] = [];
  data.labels.forEach((_, i) => {
    let pos = 0, neg = 0;
    data.series.forEach((se, j) => {
      const v = se.values[i] ?? 0;
      const from = v >= 0 ? pos : neg, to = from + v;
      if (v >= 0) pos = to; else neg = to;
      out.push({ i, j, from, to });
    });
  });
  return out;
}
