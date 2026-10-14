"use client";

/**
 * Charts for fund pages and copies, drawn in SVG with the theme's tokens (so every theme, light or dark,
 * gets its own colours): a holdings treemap, diverging change bars, and the backtest's lines.
 *
 * Colour jobs: the treemap's area is the weight and its colour the quarter's change (new in the accent,
 * added and trimmed in the positive and negative tokens, unchanged in the de-emphasis grey), with a legend
 * and a label on every tile big enough to hold one. Change bars diverge from zero in the same two
 * tokens. The backtest's three lines carry identity by colour and by dash (the no-lag line is dashed),
 * are labelled at their ends and listed in a legend, and share one axis indexed to 100.
 */
import { useMemo, useRef, useState } from "react";

const pct = (v: number, dp = 1) => `${(v * 100).toFixed(dp)}%`;

/* ---------------- Treemap ---------------- */

export type TreemapItem = { key: string; label: string; sub?: string; value: number; kind?: "new" | "added" | "trimmed" | "exited" | "unchanged" | null };
type Rect = { x: number; y: number; w: number; h: number };

/** Squarified treemap layout (Bruls, Huizing and van Wijk): rows that keep tiles close to square. Pure. */
export function squarify<T extends { value: number }>(items: T[], box: Rect): (T & Rect)[] {
  const total = items.reduce((s, i) => s + Math.max(0, i.value), 0);
  if (!total || box.w <= 0 || box.h <= 0) return [];
  const scale = (box.w * box.h) / total;
  const rest = items.filter((i) => i.value > 0).map((i) => ({ item: i, area: i.value * scale })).sort((a, b) => b.area - a.area);
  const out: (T & Rect)[] = [];
  let { x, y, w, h } = box;
  const worst = (row: number[], side: number) => { const s = row.reduce((a, b) => a + b, 0); const mx = Math.max(...row), mn = Math.min(...row); return Math.max((side * side * mx) / (s * s), (s * s) / (side * side * mn)); };
  while (rest.length) {
    const side = Math.min(w, h);
    const row = [rest.shift()!];
    while (rest.length && worst([...row.map((r) => r.area), rest[0].area], side) <= worst(row.map((r) => r.area), side)) row.push(rest.shift()!);
    const sum = row.reduce((s, r) => s + r.area, 0);
    if (w >= h) {
      const rw = sum / h; let cy = y;
      for (const r of row) { const rh = r.area / rw; out.push({ ...r.item, x, y: cy, w: rw, h: rh }); cy += rh; }
      x += rw; w -= rw;
    } else {
      const rh = sum / w; let cx = x;
      for (const r of row) { const rw = r.area / rh; out.push({ ...r.item, x: cx, y, w: rw, h: rh }); cx += rw; }
      y += rh; h -= rh;
    }
  }
  return out;
}

const KIND_FILL: Record<string, string> = { new: "var(--accent)", added: "var(--pos)", trimmed: "var(--neg)", unchanged: "var(--chart-dim)", exited: "var(--chart-dim)" };
const KIND_LABEL: Record<string, string> = { new: "New", added: "Added", trimmed: "Trimmed", unchanged: "Unchanged" };

export function Treemap({ items, title, height = 300 }: { items: TreemapItem[]; title: string; height?: number }) {
  const W = 720;
  const tiles = useMemo(() => squarify(items.slice(0, 40), { x: 0, y: 0, w: W, h: height }), [items, height]);
  const [hover, setHover] = useState<string | null>(null);
  const h = tiles.find((t) => t.key === hover);
  const total = items.reduce((s, i) => s + i.value, 0) || 1;
  const kinds = [...new Set(items.map((i) => i.kind ?? "unchanged"))].filter((k) => KIND_LABEL[k]);
  return (
    <figure className="m-0">
      <figcaption className="mb-1.5 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted">
        <span>{title}</span>
        <span className="flex flex-wrap gap-3">{kinds.map((k) => <span key={k} className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: KIND_FILL[k], opacity: k === "unchanged" ? 0.9 : 0.75 }} />{KIND_LABEL[k]}</span>)}</span>
      </figcaption>
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${height}`} width="100%" role="img" aria-label={title} className="block" onPointerLeave={() => setHover(null)}>
          {tiles.map((t) => {
            const big = t.w > 54 && t.h > 30;
            return (
              <g key={t.key} onPointerEnter={() => setHover(t.key)} className="cursor-default">
                <rect x={t.x + 1} y={t.y + 1} width={Math.max(0, t.w - 2)} height={Math.max(0, t.h - 2)} rx={4} fill={KIND_FILL[t.kind ?? "unchanged"]} opacity={hover === t.key ? 1 : (t.kind ?? "unchanged") === "unchanged" ? 0.9 : 0.75} />
                {big && <text x={t.x + 7} y={t.y + 17} fontSize={Math.min(15, Math.max(10, t.w / 7))} fontWeight={600} fill="var(--fg)">{t.label}</text>}
                {big && t.h > 46 && <text x={t.x + 7} y={t.y + 32} fontSize={10} fill="var(--fg)" opacity={0.8}>{pct(t.value / total)}</text>}
              </g>
            );
          })}
        </svg>
        {h && (
          <div className="pointer-events-none absolute z-10 rounded-md border border-line bg-elevated px-2.5 py-1.5 text-[11px] shadow-lg" style={{ left: `${Math.min(70, ((h.x + h.w / 2) / W) * 100)}%`, top: `${Math.min(80, ((h.y + h.h / 2) / height) * 100)}%` }}>
            <div className="font-semibold text-fg">{h.label}</div>
            {h.sub && <div className="text-muted">{h.sub}</div>}
            <div className="num text-fg">{pct(h.value / total)} of the portfolio · {KIND_LABEL[h.kind ?? "unchanged"] ?? "Unchanged"}</div>
          </div>
        )}
      </div>
    </figure>
  );
}

/* ---------------- Diverging change bars ---------------- */

export type ChangeBar = { key: string; label: string; before: number; after: number; note?: string };

/** Weight change per position (after − before), diverging from zero: gains right in the positive token, cuts left in the negative. */
export function ChangeBars({ rows, title }: { rows: ChangeBar[]; title: string }) {
  const [hover, setHover] = useState<string | null>(null);
  const data = rows.map((r) => ({ ...r, d: r.after - r.before })).sort((a, b) => b.d - a.d).slice(0, 16);
  const max = Math.max(...data.map((r) => Math.abs(r.d)), 0.0001);
  const rowH = 20, labelW = 74, W = 520, mid = labelW + (W - labelW - 56) / 2, half = (W - labelW - 56) / 2;
  const H = data.length * rowH + 8;
  if (!data.length) return <p className="text-[11.5px] text-muted">No positions changed weight.</p>;
  return (
    <figure className="m-0">
      <figcaption className="mb-1 text-[11px] text-muted">{title}</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={title} className="block max-w-[640px]" onPointerLeave={() => setHover(null)}>
        <line x1={mid} x2={mid} y1={0} y2={H} stroke="var(--line-strong)" />
        {data.map((r, i) => {
          const y = 4 + i * rowH, len = (Math.abs(r.d) / max) * half, pos = r.d >= 0;
          return (
            <g key={r.key} onPointerEnter={() => setHover(r.key)}>
              <rect x={0} y={y} width={W} height={rowH} fill={hover === r.key ? "var(--elevated)" : "transparent"} />
              <text x={labelW - 6} y={y + 13.5} textAnchor="end" fontSize={10.5} fill="var(--fg)">{r.label}</text>
              <rect x={pos ? mid + 1 : mid - 1 - len} y={y + 4} width={Math.max(1.5, len)} height={12} rx={3} fill={pos ? "var(--pos)" : "var(--neg)"} opacity={0.85} />
              <text x={pos ? mid + len + 5 : mid - len - 5} y={y + 13.5} textAnchor={pos ? "start" : "end"} fontSize={10} fill="var(--muted)" className="num">{pos ? "+" : "−"}{(Math.abs(r.d) * 100).toFixed(1)} pt</text>
              {hover === r.key && <title>{`${r.label}: ${pct(r.before)} → ${pct(r.after)}${r.note ? ` (${r.note})` : ""}`}</title>}
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

/* ---------------- Backtest lines ---------------- */

export type Line = { name: string; points: { date: string; value: number }[]; color: string; dashed?: boolean };

/** Lines on one axis indexed to 100, with a crosshair readout, a legend and labels at the ends. */
export function LinesChart({ lines, title, height = 260, format = (v: number) => v.toFixed(0) }: { lines: Line[]; title: string; height?: number; format?: (v: number) => string }) {
  const ref = useRef<SVGSVGElement>(null);
  const [hi, setHi] = useState<number | null>(null);
  const dates = useMemo(() => [...new Set(lines.flatMap((l) => l.points.map((p) => p.date)))].sort(), [lines]);
  const maps = useMemo(() => lines.map((l) => new Map(l.points.map((p) => [p.date, p.value]))), [lines]);
  const W = 720, padL = 44, padR = 92, padT = 12, padB = 24;
  const vals = lines.flatMap((l) => l.points.map((p) => p.value));
  if (dates.length < 2 || !vals.length) return <p className="text-[11.5px] text-muted">Not enough data to draw this.</p>;
  const lo = Math.min(...vals) * 0.97, hiV = Math.max(...vals) * 1.03;
  const X = (i: number) => padL + (i / (dates.length - 1)) * (W - padL - padR);
  const Y = (v: number) => padT + (1 - (v - lo) / (hiV - lo || 1)) * (height - padT - padB);
  const ticks = Array.from({ length: 5 }, (_, k) => lo + ((hiV - lo) * k) / 4);
  const years = dates.map((d, i) => [d, i] as const).filter(([d], i) => i === 0 || d.slice(0, 4) !== dates[i - 1].slice(0, 4));
  const move = (e: React.PointerEvent) => {
    const r = ref.current?.getBoundingClientRect(); if (!r) return;
    const x = ((e.clientX - r.left) / r.width) * W;
    setHi(Math.max(0, Math.min(dates.length - 1, Math.round(((x - padL) / (W - padL - padR)) * (dates.length - 1)))));
  };
  const ends = lines.map((l, k) => { const last = l.points.at(-1); return last ? { k, y: Y(last.value), v: last.value } : null; }).filter(Boolean) as { k: number; y: number; v: number }[];
  ends.sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 13) ends[i].y = ends[i - 1].y + 13;
  return (
    <figure className="m-0">
      <figcaption className="mb-1.5 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted">
        <span>{title}</span>
        <span className="flex flex-wrap gap-3">{lines.map((l) => <span key={l.name} className="inline-flex items-center gap-1.5"><svg width="18" height="6" aria-hidden><line x1="0" x2="18" y1="3" y2="3" stroke={l.color} strokeWidth="2" strokeDasharray={l.dashed ? "4 3" : undefined} /></svg>{l.name}</span>)}</span>
      </figcaption>
      <div className="relative">
        <svg ref={ref} viewBox={`0 0 ${W} ${height}`} width="100%" role="img" aria-label={title} className="block touch-none" onPointerMove={move} onPointerDown={move} onPointerLeave={() => setHi(null)}>
          {ticks.map((t) => <g key={t}><line x1={padL} x2={W - padR} y1={Y(t)} y2={Y(t)} stroke="var(--line)" /><text x={padL - 6} y={Y(t) + 3} textAnchor="end" fontSize={9.5} fill="var(--muted)" className="num">{format(t)}</text></g>)}
          {years.map(([d, i]) => <text key={d} x={X(i)} y={height - 7} fontSize={9.5} fill="var(--muted)" textAnchor={i === 0 ? "start" : "middle"}>{d.slice(0, 4)}</text>)}
          <line x1={padL} x2={W - padR} y1={Y(100)} y2={Y(100)} stroke="var(--line-strong)" strokeDasharray="2 3" />
          {lines.map((l) => {
            const d = l.points.map((p, i) => `${i ? "L" : "M"}${X(dates.indexOf(p.date)).toFixed(1)},${Y(p.value).toFixed(1)}`).join(" ");
            return <path key={l.name} d={d} fill="none" stroke={l.color} strokeWidth={2} strokeLinejoin="round" strokeDasharray={l.dashed ? "5 4" : undefined} />;
          })}
          {ends.map((e) => <text key={e.k} x={W - padR + 6} y={e.y + 3} fontSize={10} fill="var(--fg)">{lines[e.k].name.split(" ")[0]} <tspan className="num" fill="var(--muted)">{format(e.v)}</tspan></text>)}
          {hi !== null && <line x1={X(hi)} x2={X(hi)} y1={padT} y2={height - padB} stroke="var(--line-strong)" />}
          {hi !== null && lines.map((l, k) => { const v = maps[k].get(dates[hi]); return v === undefined ? null : <circle key={l.name} cx={X(hi)} cy={Y(v)} r={4} fill={l.color} stroke="var(--panel)" strokeWidth={2} />; })}
        </svg>
        {hi !== null && (
          <div className="pointer-events-none absolute top-1 z-10 rounded-md border border-line bg-elevated px-2.5 py-1.5 text-[11px] shadow-lg" style={{ left: X(hi) / W > 0.6 ? undefined : `${(X(hi) / W) * 100 + 2}%`, right: X(hi) / W > 0.6 ? `${100 - (X(hi) / W) * 100 + 2}%` : undefined }}>
            <div className="mb-0.5 text-muted">{dates[hi]}</div>
            {lines.map((l, k) => { const v = maps[k].get(dates[hi]); return v === undefined ? null : <div key={l.name} className="flex items-center gap-2"><span className="inline-block h-2 w-2 rounded-full" style={{ background: l.color }} /><span className="text-fg">{l.name}</span><span className="num ml-auto text-fg">{format(v)}</span></div>; })}
          </div>
        )}
      </div>
    </figure>
  );
}
