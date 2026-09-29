"use client";

/**
 * The four layouts. Any look can wear any layout (the advanced setting); each edition pairs a look with
 * the layout it suits: Terminal with the wire, Editorial with the magazine, Brief with the hybrid,
 * Modern with the dashboard.
 */
import { AnimatePresence, motion, useScroll, useTransform } from "motion/react";
import { useMemo, type RefObject } from "react";
import { CATEGORY_LABEL, type Category } from "@/lib/news/classify";
import type { StoryCard as Story } from "@/lib/news/views";
import { useMotionLevel, type Spark } from "./client";
import { BriefBlock, CalendarList, DealTracker, LeagueTable, MarketWatch, TickerTape, type BriefData, type DealsData } from "./Boards";
import type { RadarScreen } from "@/lib/news/radar/view";
import { RadarTile } from "./Radar";
import { StoryCard } from "./StoryCard";

export type LayoutProps = {
  stories: Story[]; fresh: Set<number>; sparks: Map<string, Spark | null>; now: number;
  onOpen: (s: Story) => void; onSave: (s: Story) => void; onOpenCluster: (id: number) => void; onCategory: (c: string) => void;
  brief: BriefData | null; deals: DealsData | null; radar: RadarScreen | null; deskLabel: string; showRadar: boolean;
  scrollRef: RefObject<HTMLDivElement | null>;
};

const SECTION_ORDER: Category[] = ["deals", "funding", "capital", "earnings", "markets", "policy", "macro", "legal", "people", "product", "research", "filings", "general"];

function bySection(stories: Story[], skip: Set<number>, perSection: number): { cat: Category; items: Story[] }[] {
  const out: { cat: Category; items: Story[] }[] = [];
  for (const cat of SECTION_ORDER) {
    const items = stories.filter((s) => s.category === cat && !skip.has(s.id)).slice(0, perSection);
    if (items.length) out.push({ cat, items });
  }
  return out;
}

function Heading({ title, action }: { title: string; action?: React.ReactNode }) {
  return <div className="nr-rule mb-3 flex items-baseline justify-between gap-3 pt-2"><h2 className="nr-kicker">{title}</h2>{action}</div>;
}

const MoreLink = ({ cat, onCategory }: { cat: Category; onCategory: (c: string) => void }) => (
  <button type="button" onClick={() => onCategory(cat)} className="text-[11px] text-muted hover:text-accent">More {CATEGORY_LABEL[cat].toLowerCase()} →</button>
);

/* ---------------- Wire (Terminal) ---------------- */

export function WireLayout(p: LayoutProps) {
  const now = p.now;
  const groups = useMemo(() => {
    const byTime = [...p.stories].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    const label = (iso: string) => { const h = (now - Date.parse(iso)) / 3_600_000; return h < 1 ? "Last hour" : h < 6 ? "Last six hours" : h < 24 ? "Today" : h < 48 ? "Yesterday" : "Earlier"; };
    const out: { label: string; items: Story[] }[] = [];
    for (const s of byTime) { const l = now ? label(s.updatedAt) : "Latest"; const g = out[out.length - 1]; if (g?.label === l) g.items.push(s); else out.push({ label: l, items: [s] }); }
    return out;
  }, [p.stories, now]);
  return (
    <div>
      {p.brief && <TickerTape rows={p.brief.brief.watch} />}
      <div className="grid grid-cols-[52px_1fr_auto] gap-3 border-b border-line px-3 py-1.5 nr-kicker"><span>Time</span><span>Story</span><span>Move</span></div>
      {groups.map((g) => (
        <section key={g.label}>
          <div className="sticky top-0 z-10 border-b border-line bg-bg/95 px-3 py-1 font-mono text-[10.5px] uppercase tracking-wider text-accent backdrop-blur">{g.label}</div>
          <AnimatePresence initial={false}>
            {g.items.map((s, i) => <StoryCard key={s.id} story={s} variant="row" index={i} sparks={p.sparks} now={now} fresh={p.fresh.has(s.id)} onOpen={p.onOpen} onSave={p.onSave} />)}
          </AnimatePresence>
        </section>
      ))}
    </div>
  );
}

/* ---------------- Magazine (Editorial) ---------------- */

export function MagazineLayout(p: LayoutProps) {
  const level = useMotionLevel();
  const { scrollY } = useScroll({ container: p.scrollRef });
  const lift = useTransform(scrollY, [0, 500], [0, level === "rich" ? -48 : 0]);
  const fade = useTransform(scrollY, [0, 500], [1, level === "rich" ? 0.55 : 1]);
  const [lead, ...rest] = p.stories;
  const next = rest.slice(0, 4);
  const skip = new Set([lead?.id, ...next.map((s) => s.id)].filter(Boolean) as number[]);
  const sections = bySection(rest, skip, 4);
  const dateLine = p.now ? new Date(p.now).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" }) : "";
  if (!lead) return null;
  return (
    <div className="mx-auto max-w-[1180px] px-6 pb-16 pt-8">
      <div className="flex flex-wrap items-end justify-between gap-2 border-b-2 border-fg pb-3">
        <h1 className="nr-head text-[clamp(30px,4vw,54px)] leading-none text-fg">The {p.deskLabel} Desk</h1>
        <span className="text-[12px] text-muted">{dateLine}</span>
      </div>
      <div className="mt-8 grid gap-10 lg:grid-cols-[1fr_300px]">
        <motion.div style={{ y: lift, opacity: fade }}><StoryCard story={lead} variant="lead" sparks={p.sparks} now={p.now} onOpen={p.onOpen} onSave={p.onSave} /></motion.div>
        <div className="divide-y divide-line border-t border-line lg:border-l lg:border-t-0 lg:pl-8">
          {next.map((s, i) => <StoryCard key={s.id} story={s} variant="compact" index={i} sparks={p.sparks} now={p.now} onOpen={p.onOpen} />)}
        </div>
      </div>
      {p.brief?.brief.intro && (
        <blockquote className="nr-head mx-auto mt-14 max-w-[820px] border-y border-line py-6 text-center text-[clamp(20px,2.2vw,28px)] italic leading-snug text-fg/85">{p.brief.brief.intro}</blockquote>
      )}
      {sections.map((sec) => (
        <section key={sec.cat} className="mt-12">
          <Heading title={CATEGORY_LABEL[sec.cat]} action={<MoreLink cat={sec.cat} onCategory={p.onCategory} />} />
          <div className="grid gap-[var(--nr-gap)] sm:grid-cols-2 xl:grid-cols-4">
            {sec.items.map((s, i) => <StoryCard key={s.id} story={s} variant="card" index={i} sparks={p.sparks} now={p.now} onOpen={p.onOpen} onSave={p.onSave} />)}
          </div>
        </section>
      ))}
    </div>
  );
}

/* ---------------- Hybrid (Brief) ---------------- */

export function HybridLayout(p: LayoutProps) {
  const latest = useMemo(() => [...p.stories].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)).slice(0, 30), [p.stories]);
  const briefIds = new Set(p.brief?.brief.items.map((i) => i.clusterId) ?? []);
  const sections = bySection(p.stories, briefIds, 10);
  return (
    <div>
      {p.brief && <TickerTape rows={p.brief.brief.watch} />}
      <div className="mx-auto grid max-w-[1400px] gap-8 px-5 py-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0">
          {p.brief ? <BriefBlock data={p.brief} sparks={p.sparks} now={p.now} onOpen={p.onOpen} onSave={p.onSave} /> : <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="shimmer h-16 rounded-[var(--nr-radius)]" />)}</div>}
        </div>
        <aside className="min-w-0 xl:sticky xl:top-2 xl:self-start">
          <div className="nr-card p-[var(--nr-pad)]">
            <div className="nr-kicker mb-1 flex items-center gap-1.5"><span className="pulse-ring inline-block h-1.5 w-1.5 rounded-full bg-pos" /> Live wire</div>
            <div className="max-h-[70vh] divide-y divide-line overflow-y-auto pr-1">
              <AnimatePresence initial={false}>{latest.map((s) => <div key={s.id} className={p.fresh.has(s.id) ? "nr-flash" : ""}><StoryCard story={s} variant="compact" sparks={p.sparks} now={p.now} onOpen={p.onOpen} /></div>)}</AnimatePresence>
            </div>
          </div>
          {p.brief && p.brief.brief.calendar.length > 0 && <div className="nr-card mt-4 p-[var(--nr-pad)]"><div className="nr-kicker mb-2">This week</div><CalendarList events={p.brief.brief.calendar} /></div>}
        </aside>
      </div>
      <div className="mx-auto max-w-[1400px] space-y-8 px-5 pb-16">
        {sections.map((sec) => (
          <section key={sec.cat}>
            <Heading title={CATEGORY_LABEL[sec.cat]} action={<MoreLink cat={sec.cat} onCategory={p.onCategory} />} />
            <div className="-mx-1 flex snap-x gap-[var(--nr-gap)] overflow-x-auto px-1 pb-2">
              {sec.items.map((s, i) => <div key={s.id} className="w-[290px] shrink-0 snap-start"><StoryCard story={s} variant="card" index={i} sparks={p.sparks} now={p.now} fresh={p.fresh.has(s.id)} onOpen={p.onOpen} onSave={p.onSave} /></div>)}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

/* ---------------- Dashboard (Modern) ---------------- */

function Tile({ title, className = "", children, i }: { title: string; className?: string; children: React.ReactNode; i: number }) {
  const level = useMotionLevel();
  return (
    <motion.section className={`nr-card flex min-w-0 flex-col p-[var(--nr-pad)] ${className}`}
      initial={level === "rich" ? { opacity: 0, y: 16, scale: 0.98 } : false} animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 260, damping: 26, delay: i * 0.05 }}>
      <h2 className="nr-kicker mb-3">{title}</h2>
      {children}
    </motion.section>
  );
}

export function DashboardLayout(p: LayoutProps) {
  const top = p.stories.slice(0, 6);
  const filings = p.stories.filter((s) => s.kinds.includes("filing")).slice(0, 8);
  const b = p.brief?.brief;
  return (
    <div className="mx-auto grid max-w-[1440px] grid-cols-1 gap-[var(--nr-gap)] px-5 py-6 md:grid-cols-2 xl:grid-cols-4">
      <Tile i={0} title={b ? `${b.deskLabel} brief` : "Today's brief"} className="md:col-span-2">
        {b ? (
          <>
            <h3 className="nr-head nr-h2 text-fg" style={{ fontSize: "calc(var(--nr-h2) * 1.35)" }}>{b.title}</h3>
            {b.intro && <p className="nr-body mt-2 text-fg/80">{b.intro}</p>}
            <ol className="mt-3 space-y-2">{b.items.slice(0, 4).map((it, n) => (
              <li key={it.clusterId}><button type="button" onClick={() => p.onOpenCluster(it.clusterId)} className="group flex w-full gap-2 text-left"><span className="num text-accent">{n + 1}</span><span className="text-[12.5px] text-fg group-hover:text-accent">{it.headline}</span></button></li>
            ))}</ol>
          </>
        ) : <div className="shimmer h-24 rounded-[var(--nr-radius)]" />}
      </Tile>
      <Tile i={1} title="Market watch">{b ? <MarketWatch rows={b.watch} dense /> : <div className="shimmer h-24 rounded" />}</Tile>
      <Tile i={2} title="This week">{b ? <CalendarList events={b.calendar} /> : <div className="shimmer h-24 rounded" />}</Tile>
      {top.map((s, i) => <div key={s.id} className="min-h-[230px]"><StoryCard story={s} variant="tile" index={i} sparks={p.sparks} now={p.now} fresh={p.fresh.has(s.id)} onOpen={p.onOpen} onSave={p.onSave} /></div>)}
      <Tile i={3} title="Deal tracker" className="md:col-span-2">{p.deals ? <DealTracker data={p.deals} onOpenCluster={p.onOpenCluster} limit={8} /> : <div className="shimmer h-32 rounded" />}</Tile>
      <Tile i={4} title="Filings">
        <div className="space-y-1">{filings.length ? filings.map((s) => <StoryCard key={s.id} story={s} variant="compact" sparks={p.sparks} now={p.now} onOpen={p.onOpen} />) : <p className="text-[11.5px] text-muted">No filings for your desk yet today.</p>}</div>
      </Tile>
      <Tile i={5} title="League table, financial advisors">{p.deals ? <LeagueTable rows={p.deals.league.financial} title="Last 12 months" /> : <div className="shimmer h-32 rounded" />}</Tile>
      {p.showRadar && p.radar && <Tile i={6} title={p.radar.title} className="md:col-span-2 xl:col-span-4"><RadarTile data={p.radar} now={p.now} /></Tile>}
    </div>
  );
}
