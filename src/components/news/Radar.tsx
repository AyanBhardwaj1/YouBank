"use client";

/**
 * The radar: pick a sector (your desk's is marked and chosen by default), then its early signals in
 * lanes, the map of where it is happening, and the sector's deals. Technology is the tech radar.
 * Each entry links to its source: a FERC docket notice, a trial record, an FDA approval, a Fed filing.
 */
import { AnimatePresence, motion } from "motion/react";
import { ArrowUpRight } from "lucide-react";
import type { RadarLane } from "@/lib/news/radar";
import type { RadarScreen, SectorRadarView } from "@/lib/news/radar/view";
import { Icon } from "@/components/ui/Icon";
import { ago, useMotionLevel } from "./client";
import { DealTracker, RadarBoard, type DealsData } from "./Boards";
import { RadarMap } from "./RadarMap";

/** Tags worth the accent: what moves money or marks a milestone. */
const HOT = /Priority review|New molecular entity|New trade case|Merger|Acquisition|Failure|LNG export|Approved|Final impact statement|Phase 3|Entity List|Tariffs|Final rule/;

const when = (iso: string, now: number) => (now && now - Date.parse(iso) < 7 * 86_400_000 ? ago(iso, now) : new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }));

export function SectorPicker({ data, onChoose }: { data: RadarScreen; onChoose: (sector: string) => void }) {
  return (
    <div role="tablist" aria-label="Radar sector" className="flex flex-wrap gap-1.5">
      {data.sectors.map((s) => {
        const on = s.id === data.sector;
        return (
          <button key={s.id} type="button" role="tab" aria-selected={on} onClick={() => onChoose(s.id)}
            className={`relative rounded-full border px-3 py-1 text-[12px] transition-colors ${on ? "border-accent/50 text-accent" : "border-line text-muted hover:border-line-strong hover:text-fg"}`}>
            {on && <motion.span layoutId="radar-sector" className="absolute inset-0 rounded-full bg-accent-soft" transition={{ type: "spring", stiffness: 480, damping: 38 }} />}
            <span className="relative">{s.id === "tech" ? "Technology" : s.label}{s.id === data.own && <span className="ml-1 text-[10px] opacity-70">· your desk</span>}</span>
          </button>
        );
      })}
    </div>
  );
}

function LaneCard({ lane, now, limit, i, compact }: { lane: RadarLane; now: number; limit: number; i: number; compact?: boolean }) {
  const level = useMotionLevel();
  return (
    <motion.section className="nr-card flex min-w-0 flex-col p-[var(--nr-pad)]" initial={level === "rich" ? { opacity: 0, y: 10 } : false} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06, type: "spring", stiffness: 300, damping: 30 }}>
      <header className="mb-1.5">
        <div className="nr-kicker flex items-center gap-1.5"><Icon name={lane.icon} className="h-3.5 w-3.5" /><span className="truncate">{lane.title}</span>{lane.entries.length > 0 && <span className="num ml-auto normal-case tracking-normal text-faint">{lane.entries.length}</span>}</div>
        {!compact && <p className="mt-1 text-[11px] leading-relaxed text-muted">{lane.blurb}</p>}
      </header>
      {lane.status === "unavailable" ? <p className="py-3 text-[11.5px] text-muted">The source did not answer. The next pass tries again.</p>
        : lane.entries.length === 0 ? <p className="py-3 text-[11.5px] text-muted">Nothing new in this window.</p>
        : (
          <ol className="divide-y divide-line/70">
            {lane.entries.slice(0, limit).map((e, k) => (
              <motion.li key={e.id} className="py-2" initial={level === "rich" ? { opacity: 0, x: -6 } : false} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.06 + k * 0.025 }}>
                <a href={e.url} target="_blank" rel="noopener noreferrer" className="group block">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-[12.5px] leading-snug text-fg group-hover:text-accent">{e.title}</span>
                    <ArrowUpRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-faint transition group-hover:-translate-y-px group-hover:translate-x-px group-hover:text-accent" />
                  </div>
                  {!compact && e.snippet && <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-muted">{e.snippet}</p>}
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10.5px]">
                    <span className="text-faint">{e.source} · {when(e.at, now)}</span>
                    {e.tags.slice(0, compact ? 1 : 3).map((t) => <span key={t} className={`rounded-full border px-1.5 py-px ${HOT.test(t) ? "border-accent/40 bg-accent-soft text-accent" : "border-line text-muted"}`}>{t}</span>)}
                    {e.metric && <span className="num text-fg/80">{e.metric}</span>}
                  </div>
                </a>
              </motion.li>
            ))}
          </ol>
        )}
      {!compact && <footer className="mt-auto pt-2 text-[10px] text-faint">From {lane.sources}</footer>}
    </motion.section>
  );
}

/** A sector's lanes, full or compact (the dashboard tile). */
export function RadarLanes({ lanes, now, limit = 10, compact }: { lanes: RadarLane[]; now: number; limit?: number; compact?: boolean }) {
  return (
    <div className={`grid gap-[var(--nr-gap)] md:grid-cols-2 ${lanes.length >= 3 ? "xl:grid-cols-3" : ""}`}>
      {lanes.map((l, i) => <LaneCard key={l.id} lane={l} now={now} limit={limit} i={i} compact={compact} />)}
    </div>
  );
}

function SectorBody({ data, now, onOpenCluster }: { data: SectorRadarView; now: number; onOpenCluster: (id: number) => void }) {
  const deals = { deals: data.deals, league: { financial: [], legal: [] } } as unknown as DealsData;
  return (
    <div className="grid gap-[var(--nr-gap)]">
      <section className="nr-card p-[var(--nr-pad)]"><RadarMap key={data.sector} data={data.map} defaultRegion={data.region} onOpenCluster={onOpenCluster} /></section>
      <RadarLanes lanes={data.lanes} now={now} />
      <section className="nr-card min-w-0 p-[var(--nr-pad)]">
        <div className="nr-kicker mb-2">{data.sectors.find((s) => s.id === data.sector)?.label} deals, last 30 days</div>
        <DealTracker data={deals} onOpenCluster={onOpenCluster} limit={10} />
      </section>
    </div>
  );
}

export function RadarView({ data, now, onChoose, onOpenCluster }: { data: RadarScreen | null; now: number; onChoose: (sector: string) => void; onOpenCluster: (id: number) => void }) {
  if (!data) return <div className="mx-auto max-w-[1440px] space-y-4 px-5 py-6"><div className="shimmer h-8 w-64 rounded" /><div className="shimmer h-72 rounded" /><div className="grid gap-4 md:grid-cols-3"><div className="shimmer h-64 rounded" /><div className="shimmer h-64 rounded" /><div className="shimmer h-64 rounded" /></div></div>;
  return (
    <div className="mx-auto max-w-[1440px] px-5 py-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="nr-head nr-h2 text-fg">{data.title}</h2>
          <p className="mt-1 max-w-[82ch] text-[11.5px] leading-relaxed text-muted">{data.blurb}</p>
        </div>
        {data.kind === "sector" && now > 0 && <span className="text-[10.5px] text-faint">Updated {now - Date.parse(data.builtAt) < 86_400_000 ? `${ago(data.builtAt, now)} ago` : when(data.builtAt, now)} · public sources, linked</span>}
      </div>
      <div className="mt-3"><SectorPicker data={data} onChoose={onChoose} /></div>
      <AnimatePresence mode="wait">
        <motion.div key={data.sector} className="mt-5" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.2 }}>
          {data.kind === "tech" ? <RadarBoard data={data} /> : <SectorBody data={data} now={now} onOpenCluster={onOpenCluster} />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

/** The dashboard tile: the first lanes, four entries each. */
export function RadarTile({ data, now }: { data: RadarScreen; now: number }) {
  if (data.kind === "tech") return <RadarBoard data={{ papers: data.papers.slice(0, 4), repos: data.repos.slice(0, 4), models: data.models.slice(0, 4), launches: data.launches.slice(0, 4) }} />;
  return <RadarLanes lanes={data.lanes.slice(0, 3)} now={now} limit={4} compact />;
}
