"use client";

/**
 * Interactive charts inside stories, drawn from the story's own data and drawn in as they scroll into
 * view (instantly when motion is off):
 * - the price reaction: the company's last 30 closes with the moment the story broke marked, the move
 *   since then, and a crosshair that reads any day;
 * - the deal: its value on a log scale from $10M to $100B with the premium beside it;
 * - the key figures as bars, when two or more share a unit;
 * - coverage: how fast outlets picked the story up, as a step line of sources over time.
 * One series per chart, so no legend; the title says what it is; values in text tokens; every mark
 * answers hover with its value.
 */
import { motion, useInView } from "motion/react";
import { useId, useMemo, useRef, useState } from "react";
import { eventIndex } from "@/lib/news/storyviz";
import { fmtPct, fmtUsd, useMotionLevel } from "./client";

/** Draw when on screen: true once the element has scrolled into view (always true with motion off). */
export function useDrawIn<T extends Element>() {
  const ref = useRef<T | null>(null);
  const seen = useInView(ref, { once: true, margin: "0px 0px -12% 0px" });
  const level = useMotionLevel();
  return { ref, on: seen || level === "off", animate: level !== "off" };
}

const W = 600;

/** The price line with the story's moment marked. `firstSeenAt` places the marker; `now` keeps renders pure. */
export function PriceReaction({ ticker, closes, firstSeenAt, now, height = 170, compact = false }: { ticker: string; closes: number[]; firstSeenAt: string; now: number; height?: number; compact?: boolean }) {
  const uid = useId().replace(/:/g, "");
  const { ref, on, animate } = useDrawIn<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const pad = { t: 14, r: 10, b: compact ? 6 : 20, l: 10 };
  const geo = useMemo(() => {
    const min = Math.min(...closes), max = Math.max(...closes), span = max - min || 1;
    const x = (i: number) => pad.l + (i / Math.max(1, closes.length - 1)) * (W - pad.l - pad.r);
    const y = (v: number) => pad.t + (1 - (v - min) / span) * (height - pad.t - pad.b);
    const d = closes.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
    return { x, y, d, min, max };
  }, [closes, height, pad.b, pad.l, pad.r, pad.t]);
  if (closes.length < 2) return null;
  const ev = now ? eventIndex(closes.length, firstSeenAt, now) : null;
  const last = closes[closes.length - 1];
  const since = ev !== null && closes[ev] ? last / closes[ev] - 1 : null;
  const up = (since ?? last / closes[0] - 1) >= 0;
  const color = up ? "var(--pos)" : "var(--neg)";
  const hi = hover ?? null;
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const fx = ((e.clientX - r.left) / r.width) * W;
    const i = Math.round(((fx - pad.l) / (W - pad.l - pad.r)) * (closes.length - 1));
    setHover(Math.max(0, Math.min(closes.length - 1, i)));
  };
  const daysAgo = (i: number) => closes.length - 1 - i;
  return (
    <div ref={ref}>
      {!compact && (
        <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-[11px] text-muted"><span className="num font-semibold text-fg">{ticker}</span> · last 30 trading days</span>
          {since !== null
            ? <span className="num text-[12px] text-fg">{fmtPct(since, 1)} <span className="text-muted">since the news</span></span>
            : <span className="num text-[12px] text-fg">{fmtPct(last / closes[0] - 1, 1)} <span className="text-muted">over 30 days</span></span>}
        </div>
      )}
      <div className="relative">
      <svg viewBox={`0 0 ${W} ${height}`} width="100%" height={height} preserveAspectRatio="none" className="block touch-none overflow-visible" onPointerMove={onMove} onPointerLeave={() => setHover(null)} role="img" aria-label={`${ticker} closing prices over 30 trading days${since !== null ? `, ${fmtPct(since, 1)} since the story` : ""}`}>
        <defs>
          <linearGradient id={`pr${uid}`} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity="0.22" /><stop offset="100%" stopColor={color} stopOpacity="0" /></linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((k) => <line key={k} x1={pad.l} x2={W - pad.r} y1={pad.t + k * (height - pad.t - pad.b)} y2={pad.t + k * (height - pad.t - pad.b)} stroke="var(--line)" strokeWidth="1" vectorEffect="non-scaling-stroke" />)}
        {ev !== null && (
          <>
            <rect x={geo.x(ev)} y={pad.t} width={W - pad.r - geo.x(ev)} height={height - pad.t - pad.b} fill="var(--accent)" opacity={0.06} />
            <line x1={geo.x(ev)} x2={geo.x(ev)} y1={pad.t - 6} y2={height - pad.b} stroke="var(--accent)" strokeDasharray="3 3" strokeWidth="1.25" vectorEffect="non-scaling-stroke" />
          </>
        )}
        {/* Drawn in left to right by a widening clip (a dash animation breaks on a stretched, non-scaling stroke). */}
        <clipPath id={`rc${uid}`}><motion.rect x="0" y="-20" height={height + 40} initial={animate ? { width: 0 } : false} animate={on ? { width: W } : undefined} style={animate ? undefined : { width: W }} transition={{ duration: 1.1, ease: [0.2, 0.8, 0.2, 1] }} /></clipPath>
        <g clipPath={`url(#rc${uid})`}>
          <path d={`${geo.d} L${geo.x(closes.length - 1)},${height - pad.b} L${geo.x(0)},${height - pad.b} Z`} fill={`url(#pr${uid})`} />
          <path d={geo.d} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        </g>
        {hi !== null && <line x1={geo.x(hi)} x2={geo.x(hi)} y1={pad.t} y2={height - pad.b} stroke="var(--line-strong)" strokeWidth="1" vectorEffect="non-scaling-stroke" />}
      </svg>
      {/* Markers in HTML so the stretched SVG never squashes them into ovals. */}
      <span className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2" style={{ left: `${(geo.x(closes.length - 1) / W) * 100}%`, top: geo.y(last), background: color, borderColor: "var(--bg)" }} />
      {ev !== null && !compact && <span className="pointer-events-none absolute -translate-x-1/2 rounded-full bg-accent px-1.5 text-[9.5px] font-semibold uppercase tracking-wider text-accent-fg" style={{ left: `${(geo.x(ev) / W) * 100}%`, top: -8 }}>News</span>}
      {hi !== null && (
        <span className="num pointer-events-none absolute z-10 -translate-x-1/2 whitespace-nowrap rounded-md border border-line-strong bg-raised px-2 py-1 text-[11px] text-fg shadow-float"
          style={{ left: `${Math.min(88, Math.max(12, (geo.x(hi) / W) * 100))}%`, top: Math.max(-30, geo.y(closes[hi]) - 40) }}>
          {closes[hi].toLocaleString("en-US", { maximumFractionDigits: 2 })} <span className="text-muted">{daysAgo(hi) === 0 ? "last close" : `${daysAgo(hi)}d ago`}{ev !== null && hi > ev && closes[ev] ? ` · ${fmtPct(closes[hi] / closes[ev] - 1, 1)} vs news` : ""}</span>
        </span>
      )}
      </div>
    </div>
  );
}

/** A deal's value on a log scale from $10M to $100B, with reference ticks, and its premium beside it. */
export function DealChart({ valueUsd, premium, evEbitda, label }: { valueUsd: number | null; premium: number | null; evEbitda?: number | null; label?: string }) {
  const { ref, on, animate } = useDrawIn<HTMLDivElement>();
  const [tip, setTip] = useState<string | null>(null);
  const share = valueUsd ? Math.max(0.02, Math.min(1, (Math.log10(valueUsd) - 7) / 4)) : 0;
  const ticks = [{ v: 1e8, l: "$100M" }, { v: 1e9, l: "$1B" }, { v: 1e10, l: "$10B" }, { v: 1e11, l: "$100B" }];
  const grow = (w: number, delay = 0) => ({ initial: animate ? { width: 0 } : false, animate: on ? { width: `${w * 100}%` } : undefined, transition: { duration: 0.9, delay, ease: [0.2, 0.8, 0.2, 1] as const } });
  return (
    <div ref={ref} className="space-y-3">
      {valueUsd ? (
        <div>
          <div className="flex items-baseline justify-between gap-2 text-[11px] text-muted"><span>{label ?? "Deal value"}, log scale</span><span className="num text-[18px] font-semibold text-fg">{fmtUsd(valueUsd)}</span></div>
          <div className="relative mt-1.5 h-3 rounded-full bg-line/60" onPointerEnter={() => setTip(`${fmtUsd(valueUsd)}: ${valueUsd >= 1e10 ? "a megadeal" : valueUsd >= 1e9 ? "a billion-dollar deal" : "a mid-market deal"}`)} onPointerLeave={() => setTip(null)}>
            <motion.div className="absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: animate ? undefined : `${share * 100}%` }} {...grow(share)} />
            {ticks.map((t) => <span key={t.l} className="absolute top-full mt-1 -translate-x-1/2 text-[9.5px] text-faint" style={{ left: `${((Math.log10(t.v) - 7) / 4) * 100}%` }}>{t.l}</span>)}
            {ticks.map((t) => <span key={`l${t.l}`} className="absolute inset-y-0 w-px bg-bg/70" style={{ left: `${((Math.log10(t.v) - 7) / 4) * 100}%` }} />)}
          </div>
        </div>
      ) : null}
      {(premium !== null && premium !== undefined) || evEbitda ? (
        <div className={`grid gap-3 ${valueUsd ? "pt-4" : ""} sm:grid-cols-2`}>
          {premium !== null && premium !== undefined && (
            <div onPointerEnter={() => setTip(`Premium to the unaffected close: ${fmtPct(premium, 1)}`)} onPointerLeave={() => setTip(null)}>
              <div className="flex items-baseline justify-between text-[11px] text-muted"><span>Premium</span><span className="num text-[14px] font-semibold text-fg">{fmtPct(premium, 0)}</span></div>
              <div className="relative mt-1 h-2 rounded-full bg-line/60"><motion.div className="absolute inset-y-0 left-0 rounded-full bg-pos" style={{ width: animate ? undefined : `${Math.min(1, Math.max(0, premium)) * 100}%` }} {...grow(Math.min(1, Math.max(0, premium)), 0.2)} /></div>
              <div className="mt-0.5 flex justify-between text-[9.5px] text-faint"><span>0%</span><span>100%</span></div>
            </div>
          )}
          {evEbitda ? (
            <div onPointerEnter={() => setTip(`${evEbitda.toFixed(1)}x EBITDA, implied from the offer and SEC figures`)} onPointerLeave={() => setTip(null)}>
              <div className="flex items-baseline justify-between text-[11px] text-muted"><span>EV / EBITDA</span><span className="num text-[14px] font-semibold text-fg">{evEbitda.toFixed(1)}x</span></div>
              <div className="relative mt-1 h-2 rounded-full bg-line/60"><motion.div className="absolute inset-y-0 left-0 rounded-full bg-chart-1" style={{ width: animate ? undefined : `${Math.min(1, evEbitda / 30) * 100}%` }} {...grow(Math.min(1, evEbitda / 30), 0.3)} /></div>
              <div className="mt-0.5 flex justify-between text-[9.5px] text-faint"><span>0x</span><span>30x</span></div>
            </div>
          ) : null}
        </div>
      ) : null}
      <p className="h-4 text-[11px] text-muted" aria-live="polite">{tip ?? ""}</p>
    </div>
  );
}

/** The key figures that share a unit, as horizontal bars, largest first. */
export function FigureBars({ bars }: { bars: { label: string; value: string; n: number }[] }) {
  const { ref, on, animate } = useDrawIn<HTMLDivElement>();
  const max = Math.max(...bars.map((b) => b.n), 1);
  return (
    <div ref={ref} className="space-y-2">
      {bars.map((b, i) => (
        <div key={b.label} className="group" title={`${b.label}: ${b.value}`}>
          <div className="flex items-baseline justify-between gap-2 text-[11.5px]"><span className="truncate text-muted group-hover:text-fg">{b.label}</span><span className="num font-semibold text-fg">{b.value}</span></div>
          <div className="mt-1 h-2 rounded-full bg-line/50">
            <motion.div className="h-full rounded-full bg-chart-1" style={{ width: animate ? undefined : `${(b.n / max) * 100}%` }}
              initial={animate ? { width: 0 } : false} animate={on ? { width: `${Math.max(2, (b.n / max) * 100)}%` } : undefined} transition={{ duration: 0.8, delay: i * 0.08, ease: [0.2, 0.8, 0.2, 1] }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** How fast coverage spread: a step line of outlets over time, one dot per outlet (hover for which). */
export function CoverageChart({ sources, height = 96 }: { sources: { name: string; at: string }[]; height?: number }) {
  const uid = useId().replace(/:/g, "");
  const { ref, on, animate } = useDrawIn<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const pts = useMemo(() => [...sources].sort((a, b) => Date.parse(a.at) - Date.parse(b.at)), [sources]);
  if (pts.length < 2) return null;
  const t0 = Date.parse(pts[0].at), t1 = Math.max(Date.parse(pts[pts.length - 1].at), t0 + 3_600_000);
  const pad = { l: 8, r: 8, t: 10, b: 18 };
  const x = (t: number) => pad.l + ((t - t0) / (t1 - t0)) * (W - pad.l - pad.r);
  const y = (n: number) => pad.t + (1 - n / pts.length) * (height - pad.t - pad.b);
  let d = `M${x(t0)},${y(0)}`;
  pts.forEach((p, i) => { const px = x(Date.parse(p.at)); d += ` L${px},${y(i)} L${px},${y(i + 1)}`; });
  const hours = (t1 - t0) / 3_600_000;
  const span = hours < 1.5 ? `${Math.round(hours * 60)} minutes` : hours < 48 ? `${Math.round(hours)} hours` : `${Math.round(hours / 24)} days`;
  return (
    <div ref={ref}>
      <div className="mb-1 flex justify-between text-[11px] text-muted"><span>Outlets covering it</span><span><span className="num text-fg">{pts.length}</span> in {span}</span></div>
      <div className="relative">
      <svg viewBox={`0 0 ${W} ${height}`} width="100%" height={height} preserveAspectRatio="none" className="block overflow-visible" role="img" aria-label={`${pts.length} outlets covered the story over ${span}`}>
        <line x1={pad.l} x2={W - pad.r} y1={height - pad.b} y2={height - pad.b} stroke="var(--line)" vectorEffect="non-scaling-stroke" />
        <clipPath id={`cc${uid}`}><motion.rect x="0" y="-10" height={height + 20} initial={animate ? { width: 0 } : false} animate={on ? { width: W } : undefined} style={animate ? undefined : { width: W }} transition={{ duration: 1, ease: [0.2, 0.8, 0.2, 1] }} /></clipPath>
        <path d={d} fill="none" stroke="var(--chart-1)" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" clipPath={`url(#cc${uid})`} />
      </svg>
      {pts.map((p, i) => (
        <button key={`${p.name}-${p.at}`} type="button" aria-label={`${p.name}, ${new Date(p.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`}
          onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}
          className="absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ left: `${(x(Date.parse(p.at)) / W) * 100}%`, top: y(i + 1) }}>
          <span className={`absolute inset-1 rounded-full border-2 border-bg ${hover === i ? "bg-accent" : "bg-chart-1"}`} />
        </button>
      ))}
      </div>
      <div className="flex justify-between text-[9.5px] text-faint"><span>{new Date(t0).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric" })}</span><span>{new Date(t1).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric" })}</span></div>
      {hover !== null && <p className="mt-1 text-[11px] text-muted"><span className="text-fg">{pts[hover].name}</span> · {new Date(pts[hover].at).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" })}</p>}
    </div>
  );
}
