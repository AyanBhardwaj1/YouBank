"use client";

/**
 * Where a sector's activity is: bubbles sized by how much the radar's sources and the week's stories
 * name a place, and arcs for movements the sources state (exporters to the US in a trade case, one
 * state's bank buying another's, where a recalled product was made). The world and the United States
 * (by state) are two views of one equirectangular map; coastlines and state lines are static files
 * tinted with the theme's tokens, so every style draws its own map.
 */
import { AnimatePresence, motion } from "motion/react";
import { ArrowUpRight, Globe2, MapPin } from "lucide-react";
import { useId, useMemo, useState } from "react";
import type { MapFlow, MapItem, MapPoint, RadarMap as MapData } from "@/lib/news/radar/view";
import { useMotionLevel } from "./client";

type Region = "world" | "us";
const VIEW: Record<Region, { x: number; y: number; w: number; h: number; squeeze: number }> = {
  // 84°N to 58°S, all longitudes.
  world: { x: 0, y: 16.667, w: 1000, h: 394.444, squeeze: 1 },
  // The lower 48; equirectangular stretches the US wide, so it is drawn at cos(38°) of its width.
  us: { x: 149, y: 107, w: 170, h: 79, squeeze: 0.79 },
};

/** On the world map the states fold into one United States bubble. */
function pointsFor(points: MapPoint[], region: Region): MapPoint[] {
  if (region === "us") return points.filter((p) => p.us);
  const us = points.filter((p) => p.us || p.id === "c:US");
  const rest = points.filter((p) => !p.us && p.id !== "c:US");
  if (!us.length) return rest;
  const anchor = points.find((p) => p.id === "c:US") ?? { id: "c:US", name: "United States", x: 226.4, y: 140.3, kind: "country" as const, us: false, count: 0, items: [] };
  const items: MapItem[] = [];
  for (const p of [...us].sort((a, b) => b.count - a.count)) for (const i of p.items) if (items.length < 6 && !items.some((x) => x.title === i.title)) items.push(i);
  return [{ ...anchor, count: us.reduce((n, p) => n + p.count, 0), items }, ...rest].sort((a, b) => b.count - a.count);
}

function flowsFor(flows: MapFlow[], points: MapPoint[], region: Region): (MapFlow & { a: MapPoint; b: MapPoint })[] {
  const byId = new Map(points.map((p) => [p.id, p]));
  const fold = (id: string) => (region === "world" && (id.startsWith("us:") || id === "r:permian" || id === "r:gulf") ? "c:US" : id);
  const acc = new Map<string, MapFlow>();
  for (const f of flows) {
    const from = fold(f.from), to = fold(f.to);
    if (from === to || !byId.has(from) || !byId.has(to)) continue;
    const k = `${from}>${to}`;
    acc.set(k, { from, to, count: (acc.get(k)?.count ?? 0) + f.count });
  }
  return [...acc.values()].map((f) => ({ ...f, a: byId.get(f.from)!, b: byId.get(f.to)! }));
}

export function RadarMap({ data, defaultRegion, onOpenCluster }: { data: MapData; defaultRegion: Region; onOpenCluster: (id: number) => void }) {
  const level = useMotionLevel();
  const uid = useId().replace(/:/g, "");
  const [region, setRegion] = useState<Region>(defaultRegion);
  const [hover, setHover] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const v = VIEW[region];
  const points = useMemo(() => pointsFor(data.points, region), [data.points, region]);
  const flows = useMemo(() => flowsFor(data.flows, points, region), [data.flows, points, region]);
  const usCount = data.points.filter((p) => p.us).length;
  const max = Math.max(1, ...points.map((p) => p.count));
  // Radii in map units that come out about 3 to 16 pixels on either view.
  const radius = (c: number) => (3 + 13 * Math.sqrt(c / max)) * 1.25 * (v.w / 1000) * (region === "us" ? 0.8 : 1);
  const focus = points.find((p) => p.id === (hover ?? picked)) ?? null;
  const list = points.slice(0, 10);
  const pct = (p: { x: number; y: number }) => ({ left: `${((p.x - v.x) / v.w) * 100}%`, top: `${((p.y - v.y) / v.h) * 100}%` });
  // Names for the busiest places, skipping any that would sit on top of one already placed.
  const labels = useMemo(() => {
    const out: MapPoint[] = [];
    for (const p of points) {
      if (out.length >= (region === "us" ? 7 : 6)) break;
      const fx = (p.x - v.x) / v.w, fy = (p.y - v.y) / v.h;
      if (out.every((q) => Math.abs((q.x - v.x) / v.w - fx) > 0.11 || Math.abs((q.y - v.y) / v.h - fy) > 0.07)) out.push(p);
    }
    return out;
  }, [points, region, v]);

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
      <div className="min-w-0">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="nr-kicker flex items-center gap-1.5"><Globe2 className="h-3.5 w-3.5" />Where it is happening</div>
          <div role="radiogroup" aria-label="Map" className="flex rounded-full border border-line p-0.5 text-[11px]">
            {(["world", "us"] as Region[]).map((r) => (
              <button key={r} type="button" role="radio" aria-checked={region === r} disabled={r === "us" && !usCount} onClick={() => { setRegion(r); setPicked(null); }}
                className={`relative rounded-full px-2.5 py-0.5 transition-colors disabled:opacity-40 ${region === r ? "text-fg" : "text-muted hover:text-fg"}`}>
                {region === r && <motion.span layoutId={`map-region-${uid}`} className="absolute inset-0 rounded-full bg-elevated" transition={{ type: "spring", stiffness: 500, damping: 40 }} />}
                <span className="relative">{r === "world" ? "World" : "United States"}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="relative overflow-hidden rounded-[var(--nr-radius)] border border-line bg-bg/40" style={{ aspectRatio: `${(v.w * v.squeeze) / v.h}` }}>
          <svg viewBox={`${v.x} ${v.y} ${v.w} ${v.h}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full" role="img" aria-label={`Map of ${points.length} places`}>
            <defs>
              <filter id={`land-${uid}`} x="0" y="0" width="1" height="1" colorInterpolationFilters="sRGB">
                <feFlood style={{ floodColor: "var(--elevated)" }} /><feComposite in2="SourceAlpha" operator="in" />
              </filter>
              <filter id={`lines-${uid}`} x="0" y="0" width="1" height="1" colorInterpolationFilters="sRGB">
                <feFlood style={{ floodColor: "var(--line-strong)" }} /><feComposite in2="SourceAlpha" operator="in" />
              </filter>
              <radialGradient id={`glow-${uid}`}><stop offset="0%" stopColor="var(--accent)" stopOpacity="0.55" /><stop offset="100%" stopColor="var(--accent)" stopOpacity="0" /></radialGradient>
            </defs>
            <image href="/radar/world-land.svg" x="0" y="16.667" width="1000" height="394.444" preserveAspectRatio="none" filter={`url(#land-${uid})`} />
            {region === "us" && <>
              <image href="/radar/us-land.svg" x="0" y="0" width="1000" height="500" preserveAspectRatio="none" filter={`url(#land-${uid})`} />
              <image href="/radar/us-states.svg" x="0" y="0" width="1000" height="500" preserveAspectRatio="none" filter={`url(#lines-${uid})`} />
            </>}
            {flows.map((f, i) => {
              const mx = (f.a.x + f.b.x) / 2, my = (f.a.y + f.b.y) / 2, dx = f.b.x - f.a.x, dy = f.b.y - f.a.y, len = Math.hypot(dx, dy) || 1;
              const lift = Math.min(len * 0.35, v.w * 0.12);
              const d = `M${f.a.x},${f.a.y} Q${mx - (dy / len) * lift},${my + (dx / len) * lift - lift * 0.4} ${f.b.x},${f.b.y}`;
              return (
                <motion.path key={`${f.from}>${f.to}`} d={d} fill="none" stroke="var(--chart-1)" strokeOpacity={0.6} strokeWidth={Math.min(3, 0.9 + f.count * 0.35)} strokeLinecap="round"
                  strokeDasharray={level !== "off" ? "4 3" : undefined} vectorEffect="non-scaling-stroke"
                  initial={level === "rich" ? { opacity: 0 } : false} animate={{ opacity: 1 }} transition={{ duration: 0.6, delay: 0.3 + i * 0.04 }}
                  className={level === "rich" ? "radar-flow" : ""} />
              );
            })}
            {points.map((p, i) => {
              const r = radius(p.count), on = p.id === hover || p.id === picked;
              return (
                <g key={p.id} transform={`translate(${p.x} ${p.y}) scale(${1 / v.squeeze} 1)`} role="button" tabIndex={0} aria-label={`${p.name}: ${p.count} ${p.count === 1 ? "mention" : "mentions"}`}
                  onMouseEnter={() => setHover(p.id)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(p.id)} onBlur={() => setHover(null)}
                  onClick={() => setPicked((x) => (x === p.id ? null : p.id))} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setPicked((x) => (x === p.id ? null : p.id)); } }}
                  className="cursor-pointer outline-none">
                  {level === "rich" && i < 3 && <circle r={r} fill={`url(#glow-${uid})`} className="radar-pulse" style={{ animationDelay: `${i * 0.6}s` }} />}
                  <motion.circle r={r} fill="var(--accent)" fillOpacity={on ? 0.55 : 0.28} stroke="var(--accent)" strokeOpacity={on ? 1 : 0.75} strokeWidth={on ? 2 : 1} vectorEffect="non-scaling-stroke"
                    initial={level === "rich" ? { scale: 0, opacity: 0 } : false} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 380, damping: 22, delay: Math.min(i, 24) * 0.025 }} />
                </g>
              );
            })}
          </svg>
          {/* Names for the busiest places, in HTML so the map's stretch never distorts the text. */}
          {labels.map((p) => (
            <span key={`l-${p.id}`} className="pointer-events-none absolute -translate-x-1/2 translate-y-[10px] whitespace-nowrap rounded-full bg-bg/80 px-1.5 py-px text-[10px] text-fg/90 shadow-sm backdrop-blur-sm" style={pct(p)}>
              {p.name.replace(" (country)", "")} <span className="num text-accent">{p.count}</span>
            </span>
          ))}
          <AnimatePresence>
            {focus && (
              <motion.div key={focus.id} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.14 }}
                className={`pointer-events-none absolute z-10 w-[260px] -translate-x-1/2 rounded-[var(--nr-radius)] border border-line-strong bg-raised/95 p-2.5 text-[11.5px] shadow-float backdrop-blur ${(focus.y - v.y) / v.h < 0.4 ? "translate-y-[18px]" : "-translate-y-[calc(100%+14px)]"}`} style={pct(focus)}>
                <div className="flex items-baseline justify-between gap-2"><span className="font-semibold text-fg">{focus.name.replace(" (country)", "")}</span><span className="num text-accent">{focus.count}</span></div>
                <ul className="mt-1 space-y-0.5 text-muted">{focus.items.slice(0, 3).map((it) => <li key={it.title} className="line-clamp-1">{it.title}</li>)}</ul>
              </motion.div>
            )}
          </AnimatePresence>
          {!points.length && <p className="absolute inset-0 grid place-items-center text-[12px] text-muted">No places named yet this week.</p>}
        </div>
      </div>
      <div className="min-w-0">
        <div className="nr-kicker mb-2 flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" />{picked ? points.find((p) => p.id === picked)?.name.replace(" (country)", "") : "Most active"}</div>
        {picked ? (
          <div>
            <ul className="space-y-2">{(points.find((p) => p.id === picked)?.items ?? []).map((it) => (
              <li key={it.title}>
                {it.clusterId
                  ? <button type="button" onClick={() => onOpenCluster(it.clusterId!)} className="text-left text-[12px] leading-snug text-fg hover:text-accent">{it.title}</button>
                  : <a href={it.url} target="_blank" rel="noopener noreferrer" className="group inline-flex items-start gap-1 text-[12px] leading-snug text-fg hover:text-accent">{it.title}<ArrowUpRight className="mt-0.5 h-3 w-3 shrink-0 text-faint group-hover:text-accent" /></a>}
                <div className="text-[10.5px] text-muted">{it.source}</div>
              </li>
            ))}</ul>
            <button type="button" onClick={() => setPicked(null)} className="mt-3 text-[11px] text-muted underline hover:text-fg">Back to all places</button>
          </div>
        ) : (
          <ol className="space-y-1.5">{list.map((p, i) => (
            <li key={p.id}>
              <button type="button" onClick={() => setPicked(p.id)} onMouseEnter={() => setHover(p.id)} onMouseLeave={() => setHover(null)} className="group grid w-full grid-cols-[16px_1fr_auto] items-center gap-2 text-left text-[12px]">
                <span className="num text-faint">{i + 1}</span>
                <span className="min-w-0">
                  <span className="block truncate text-fg group-hover:text-accent">{p.name.replace(" (country)", "")}</span>
                  <span className="mt-0.5 block h-1 overflow-hidden rounded-full bg-line"><motion.span className="block h-full rounded-full bg-accent/70" initial={level === "rich" ? { width: 0 } : false} animate={{ width: `${(p.count / max) * 100}%` }} transition={{ duration: 0.6, delay: i * 0.04 }} /></span>
                </span>
                <span className="num text-muted">{p.count}</span>
              </button>
            </li>
          ))}</ol>
        )}
      </div>
    </div>
  );
}
