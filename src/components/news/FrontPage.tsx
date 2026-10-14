"use client";

/**
 * The front page: the Newsroom's own identity, built to be read at a glance and to hold up to a
 * professional's scrutiny. From the top:
 * - a ticker: the desk's market watch and the latest headlines, crawling (still when motion is off);
 * - the masthead, with the four ways in: Brief mode (swipe cards), Listen (the audio briefing), the
 *   60-second recap, and the globe;
 * - the hero: the person's top story set large, beside its best chart (the price reaction, the deal,
 *   or how fast coverage spread), with "Why you're seeing this", Follow and Save;
 * - the next three as data-art cards (generated thumbnails, since no story carries a licensed photo);
 * - "The day in data": deal sizes, how the names in the news moved, what the desk's news is about, and
 *   the day's filings, each drawn in as it scrolls into view;
 * - "For you", when the person's watchlist, network or reading picked stories out;
 * - the globe of where the news is happening, loaded only when it scrolls into view;
 * - sections by kind of story, as data-art cards.
 */
import dynamic from "next/dynamic";
import { motion, useInView } from "motion/react";
import { useMemo, useRef } from "react";
import { CATEGORY_LABEL, type Category } from "@/lib/news/classify";
import type { GlobePoint } from "@/lib/news/geo";
import type { StoryCard as Story } from "@/lib/news/views";
import { Icon } from "@/components/ui/Icon";
import { ago, fmtPct, fmtUsd, useApi, useMotionLevel, type Spark } from "./client";
import { ArtThumb, hueOf } from "./DataArt";
import type { LayoutProps } from "./layouts";
import { FollowButton, WhyShown } from "./StoryActions";
import { Kicker, Reasons, SaveButton, Tickers } from "./StoryCard";
import { CoverageChart, DealChart, FigureBars, PriceReaction, useDrawIn } from "./StoryCharts";
import { figureBars } from "@/lib/news/storyviz";

const NewsGlobe = dynamic(() => import("./NewsGlobe"), { ssr: false, loading: () => <div className="shimmer h-full w-full rounded-[var(--nr-radius)]" /> });

const SECTION_ORDER: Category[] = ["deals", "funding", "capital", "earnings", "markets", "policy", "macro", "legal", "people", "product", "research", "filings", "general"];

/* ---------------- Ticker ---------------- */

function FrontTicker({ p }: { p: LayoutProps }) {
  const level = useMotionLevel();
  const rows = p.brief?.brief.watch ?? [];
  const latest = useMemo(() => [...p.stories].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)).slice(0, 8), [p.stories]);
  if (!rows.length && !latest.length) return null;
  const items = (k: string) => [
    ...rows.map((r) => (
      <span key={`${k}m${r.symbol}`} className="num inline-flex items-center gap-1.5 px-4 text-[11.5px]">
        <span className="text-muted">{r.label}</span><span className="text-fg">{r.last === null ? "—" : r.last.toLocaleString("en-US", { maximumFractionDigits: 2 })}</span>
        <span className={(r.change ?? 0) >= 0 ? "text-pos" : "text-neg"}>{(r.change ?? 0) >= 0 ? "▲" : "▼"} {fmtPct(r.change, 2).replace(/^[+-]/, "")}</span>
      </span>
    )),
    ...latest.map((s) => (
      <button key={`${k}h${s.id}`} type="button" onClick={() => p.onOpen(s)} className="inline-flex items-center gap-2 px-4 text-[11.5px] text-fg hover:text-accent">
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: hueOf(s.tags) }} />{s.headline}
        <span className="num text-faint">{p.now ? ago(s.updatedAt, p.now) : ""}</span>
      </button>
    )),
  ];
  return (
    <div className="relative overflow-hidden border-b border-line bg-elevated/40 py-1.5" aria-label="Market watch and latest headlines">
      <span className="absolute inset-y-0 left-0 z-10 flex items-center gap-1.5 bg-gradient-to-r from-bg via-bg/95 to-transparent pl-3 pr-6 text-[10px] font-bold uppercase tracking-[0.14em] text-accent"><span className="pulse-ring inline-block h-1.5 w-1.5 rounded-full bg-pos" />Live</span>
      {level === "rich"
        ? <div className="tape-track flex w-max whitespace-nowrap pl-16" style={{ animationDuration: `${Math.max(50, (rows.length + latest.length) * 7)}s` }}>{items("a")}{items("b")}</div>
        : <div className="flex overflow-x-auto whitespace-nowrap pl-16">{items("a")}</div>}
    </div>
  );
}

/* ---------------- Cards ---------------- */

export function ArtCard({ s, p, i, tall = false }: { s: Story; p: LayoutProps; i: number; tall?: boolean }) {
  const level = useMotionLevel();
  const rich = level === "rich";
  return (
    <motion.article
      initial={rich ? { opacity: 0, y: 14 } : false} whileInView={rich ? { opacity: 1, y: 0 } : undefined} viewport={{ once: true, margin: "0px 0px -8% 0px" }}
      transition={{ type: "spring", stiffness: 300, damping: 30, delay: Math.min(i, 6) * 0.04 }}
      whileHover={rich ? { y: -4 } : undefined}
      className={`nr-card group flex h-full cursor-pointer flex-col overflow-hidden ${s.read ? "opacity-75" : ""} ${p.fresh.has(s.id) ? "nr-flash" : ""}`} onClick={() => p.onOpen(s)}>
      <ArtThumb story={s} sparks={p.sparks} height={tall ? 176 : 128} className="m-2 mb-0" />
      <div className="flex flex-1 flex-col gap-2 p-[var(--nr-pad)] pt-3">
        <Kicker s={s} now={p.now} />
        <h3 className="nr-head nr-h3 text-fg transition group-hover:text-accent">{s.headline}</h3>
        {s.summary?.bullets?.[0] && <p className="nr-body line-clamp-2 text-[12.5px] text-fg/70">{s.summary.bullets[0]}</p>}
        <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-1">
          <Reasons reasons={s.reasons.slice(0, 1)} />
          <span className="ml-auto flex items-center gap-1"><WhyShown explain={s.explain} reasons={s.reasons} compact /><SaveButton s={s} onSave={p.onSave} /></span>
        </div>
      </div>
    </motion.article>
  );
}

/** The hero's chart: the best the story's data supports. */
function HeroChart({ s, sparks, now }: { s: Story; sparks: Map<string, Spark | null>; now: number }) {
  const ticker = s.tickers.find((t) => sparks.get(t)?.closes?.length);
  const spark = ticker ? sparks.get(ticker)! : null;
  const bars = s.summary ? figureBars(s.summary.numbers) : [];
  return (
    <div className="nr-card flex h-full flex-col gap-5 overflow-hidden p-[var(--nr-pad)] sm:p-5">
      {!spark && <ArtThumb story={s} sparks={sparks} height={190} />}
      {spark && ticker && <PriceReaction ticker={ticker} closes={spark.closes} firstSeenAt={s.firstSeenAt} now={now} height={190} />}
      {s.deal && (s.deal.valueUsd || s.deal.premium !== null) && <DealChart valueUsd={s.deal.valueUsd} premium={s.deal.premium} evEbitda={s.deal.evEbitda} label={s.deal.kind.replace("_", " ")} />}
      {!s.deal && bars.length >= 2 && <FigureBars bars={bars} />}
      {!spark && !s.deal && bars.length < 2 && s.sources.length >= 2 && <CoverageChart sources={s.sources.map((x) => ({ name: x.name, at: x.at }))} />}
    </div>
  );
}

function Hero({ s, p }: { s: Story; p: LayoutProps }) {
  const level = useMotionLevel();
  const rich = level === "rich";
  const bullets = s.summary?.bullets ?? [];
  return (
    <section className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:gap-10">
      <motion.div initial={rich ? { opacity: 0, y: 18 } : false} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 220, damping: 28 }} className="min-w-0">
        <Kicker s={s} now={p.now} />
        <button type="button" onClick={() => p.onOpen(s)} className="nr-head nr-lead mt-3 block text-left text-fg transition hover:text-accent">{s.headline}</button>
        <div className="nr-body mt-4 max-w-[62ch] space-y-2 text-fg/85">{bullets.slice(0, 2).map((b) => <p key={b}>{b}</p>)}</div>
        {s.summary?.why && <p className="nr-body mt-3 max-w-[62ch] border-l-2 border-accent pl-3 text-fg/80"><b className="text-fg">Why it matters. </b>{s.summary.why}</p>}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Reasons reasons={s.reasons} />
          <Tickers s={s} sparks={p.sparks} />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => p.onOpen(s)} className="inline-flex items-center gap-1.5 rounded-full bg-fg px-3.5 py-1.5 text-[12px] font-medium text-bg hover:opacity-90">Read the story<Icon name="ArrowRight" className="h-3.5 w-3.5" /></button>
          <FollowButton id={s.id} following={!!s.following} />
          <WhyShown explain={s.explain} reasons={s.reasons} align="left" />
          <SaveButton s={s} onSave={p.onSave} />
        </div>
      </motion.div>
      <motion.div initial={rich ? { opacity: 0, scale: 0.97 } : false} animate={{ opacity: 1, scale: 1 }} transition={{ type: "spring", stiffness: 200, damping: 26, delay: 0.08 }} className="min-w-0">
        <HeroChart s={s} sparks={p.sparks} now={p.now} />
      </motion.div>
    </section>
  );
}

/* ---------------- The day in data ---------------- */

function DataTile({ title, sub, children, i }: { title: string; sub: string; children: React.ReactNode; i: number }) {
  const level = useMotionLevel();
  return (
    <motion.section className="nr-card flex min-w-0 flex-col p-[var(--nr-pad)]" initial={level === "rich" ? { opacity: 0, y: 16 } : false} whileInView={level === "rich" ? { opacity: 1, y: 0 } : undefined} viewport={{ once: true, margin: "0px 0px -10% 0px" }} transition={{ type: "spring", stiffness: 260, damping: 28, delay: i * 0.06 }}>
      <h3 className="text-[13px] font-semibold text-fg">{title}</h3>
      <p className="mb-3 text-[11px] text-muted">{sub}</p>
      <div className="mt-auto">{children}</div>
    </motion.section>
  );
}

/** Horizontal bars that grow in on view; each row opens its story. */
function GrowBars({ rows, tone = "bg-accent" }: { rows: { key: string; label: string; value: string; share: number; color?: string; onClick?: () => void }[]; tone?: string }) {
  const { ref, on, animate } = useDrawIn<HTMLUListElement>();
  return (
    <ul ref={ref} className="space-y-2">
      {rows.map((r, i) => (
        <li key={r.key}>
          <button type="button" onClick={r.onClick} disabled={!r.onClick} className="group block w-full text-left" title={`${r.label}: ${r.value}`}>
            <div className="flex items-baseline justify-between gap-2 text-[11.5px]"><span className="truncate text-fg/85 group-hover:text-accent">{r.label}</span><span className="num shrink-0 text-fg">{r.value}</span></div>
            <div className="mt-1 h-1.5 rounded-full bg-line/60">
              <motion.div className={`h-full rounded-full ${r.color ? "" : tone}`} style={{ background: r.color, width: animate ? undefined : `${r.share * 100}%` }}
                initial={animate ? { width: 0 } : false} animate={on ? { width: `${Math.max(2, r.share * 100)}%` } : undefined} transition={{ duration: 0.8, delay: i * 0.07, ease: [0.2, 0.8, 0.2, 1] }} />
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Each name's one-day move as a bar either side of zero (gains right, losses left). */
function MoveBars({ rows, onOpen }: { rows: { ticker: string; change: number; story: Story }[]; onOpen: (s: Story) => void }) {
  const { ref, on, animate } = useDrawIn<HTMLUListElement>();
  const max = Math.max(0.01, ...rows.map((r) => Math.abs(r.change)));
  return (
    <ul ref={ref} className="space-y-1.5">
      {rows.map((r, i) => {
        const w = (Math.abs(r.change) / max) * 50;
        return (
          <li key={r.ticker}>
            <button type="button" onClick={() => onOpen(r.story)} className="group grid w-full grid-cols-[52px_1fr_56px] items-center gap-2 text-left" title={`${r.ticker} ${fmtPct(r.change, 1)} today: ${r.story.headline}`}>
              <span className="num text-[11.5px] text-fg group-hover:text-accent">{r.ticker}</span>
              <span className="relative h-3">
                <span className="absolute inset-y-0 left-1/2 w-px bg-line-strong" />
                <motion.span className={`absolute inset-y-0.5 rounded-full ${r.change >= 0 ? "bg-pos" : "bg-neg"}`}
                  style={r.change >= 0 ? { left: "50%", width: animate ? undefined : `${w}%` } : { right: "50%", width: animate ? undefined : `${w}%` }}
                  initial={animate ? { width: 0 } : false} animate={on ? { width: `${Math.max(1, w)}%` } : undefined} transition={{ duration: 0.7, delay: i * 0.06 }} />
              </span>
              <span className={`num text-right text-[11.5px] ${r.change >= 0 ? "text-pos" : "text-neg"}`}>{fmtPct(r.change, 1)}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** The day's filings on a 24-hour strip: one dot per filing, larger for weightier ones. */
function FilingStrip({ stories, now, onOpen }: { stories: Story[]; now: number; onOpen: (s: Story) => void }) {
  const { ref, on, animate } = useDrawIn<HTMLDivElement>();
  const day = 24 * 3_600_000;
  const shown = stories.filter((s) => now && now - Date.parse(s.updatedAt) < day);
  return (
    <div ref={ref}>
      <div className="relative h-16">
        <span className="absolute inset-x-0 top-1/2 h-px bg-line-strong" />
        {[0, 6, 12, 18, 24].map((h) => <span key={h} className="absolute top-1/2 h-2 w-px -translate-y-1/2 bg-line-strong" style={{ left: `${(h / 24) * 100}%` }} />)}
        {shown.map((s, i) => {
          const x = 1 - (now - Date.parse(s.updatedAt)) / day;
          const r = 6 + s.importance * 10;
          return (
            <motion.button key={s.id} type="button" onClick={() => onOpen(s)} title={`${s.filing?.form ?? "Filing"}: ${s.headline}`} aria-label={`${s.filing?.form ?? "Filing"}: ${s.headline}`}
              className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-bg bg-chart-emphasis hover:bg-accent"
              style={{ left: `${x * 100}%`, top: `${50 + ((i % 3) - 1) * 22}%`, width: r, height: r }}
              initial={animate ? { scale: 0 } : false} animate={on ? { scale: 1 } : undefined} transition={{ type: "spring", stiffness: 400, damping: 20, delay: 0.1 + i * 0.03 }} />
          );
        })}
      </div>
      <div className="flex justify-between text-[9.5px] text-faint"><span>24h ago</span><span>12h</span><span>now</span></div>
      <p className="mt-2 text-[11px] text-muted"><span className="num text-fg">{shown.length}</span> {shown.length === 1 ? "filing" : "filings"} for your desk in the last day{shown[0] ? `; the latest, ${shown[0].filing?.form ?? "a filing"}` : ""}.</p>
    </div>
  );
}

function DayInData({ p }: { p: LayoutProps }) {
  const deals = useMemo(() => p.stories.filter((s) => s.deal?.valueUsd).sort((a, b) => (b.deal!.valueUsd ?? 0) - (a.deal!.valueUsd ?? 0)).slice(0, 5), [p.stories]);
  // Not memoized: the price lines arrive into a shared map after the first render.
  const movers = (() => {
    const seen = new Set<string>();
    const out: { ticker: string; change: number; story: Story }[] = [];
    for (const s of p.stories.slice(0, 80)) for (const t of s.tickers.slice(0, 1)) {
      const ch = p.sparks.get(t)?.change;
      if (ch === null || ch === undefined || seen.has(t)) continue;
      seen.add(t);
      out.push({ ticker: t, change: ch, story: s });
    }
    return out.sort((a, b) => Math.abs(b.change) - Math.abs(a.change)).slice(0, 6).sort((a, b) => b.change - a.change);
  })();
  const cats = useMemo(() => {
    const c = p.counts ?? Object.fromEntries(Object.entries(p.stories.reduce<Record<string, number>>((m, s) => ({ ...m, [s.category]: (m[s.category] ?? 0) + 1 }), {})));
    return Object.entries(c).filter(([k]) => k !== "general").sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [p.counts, p.stories]);
  const filings = useMemo(() => p.stories.filter((s) => s.kinds.includes("filing")).slice(0, 30), [p.stories]);
  const maxDeal = deals[0]?.deal?.valueUsd ?? 1;
  const maxCat = cats[0]?.[1] ?? 1;
  const tiles: React.ReactNode[] = [];
  if (deals.length >= 2) tiles.push(
    <DataTile key="deals" i={tiles.length} title="Deals on the wire" sub="The largest deals in your feed; bar length is value.">
      <GrowBars rows={deals.map((s) => ({ key: String(s.id), label: s.deal!.target || s.names[0] || s.headline, value: fmtUsd(s.deal!.valueUsd), share: (s.deal!.valueUsd ?? 0) / maxDeal, onClick: () => p.onOpen(s) }))} />
    </DataTile>,
  );
  if (movers.length >= 3) tiles.push(
    <DataTile key="movers" i={tiles.length} title="How the names moved" sub="One-day change for companies in today's stories.">
      <MoveBars rows={movers} onOpen={p.onOpen} />
    </DataTile>,
  );
  if (cats.length >= 2) tiles.push(
    <DataTile key="cats" i={tiles.length} title="What your desk's news is about" sub="Stories in your feed by kind.">
      <GrowBars tone="bg-chart-1" rows={cats.map(([k, n]) => ({ key: k, label: CATEGORY_LABEL[k as Category] ?? k, value: String(n), share: n / maxCat, onClick: p.onCategory ? () => p.onCategory(k) : undefined }))} />
    </DataTile>,
  );
  if (filings.length) tiles.push(
    <DataTile key="filings" i={tiles.length} title="Filings, last 24 hours" sub="Each dot a filing for your desk; larger is weightier.">
      <FilingStrip stories={filings} now={p.now} onOpen={p.onOpen} />
    </DataTile>,
  );
  if (!tiles.length) return null;
  return (
    <section className="mt-14">
      <Heading title="The day in data" />
      <div className={`grid gap-[var(--nr-gap)] sm:grid-cols-2 ${tiles.length >= 4 ? "xl:grid-cols-4" : tiles.length === 3 ? "xl:grid-cols-3" : ""}`}>{tiles}</div>
    </section>
  );
}

/* ---------------- Globe teaser ---------------- */

function GlobeTeaser({ p }: { p: LayoutProps }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const seen = useInView(ref, { once: true, margin: "200px 0px" });
  const { data } = useApi<{ points: GlobePoint[]; stories: number }>(seen ? "/api/news/globe" : null, 5 * 60_000);
  return (
    <section className="mt-14" ref={ref}>
      <Heading title="Where it is happening" action={p.onAction && <button type="button" onClick={() => p.onAction!("globe")} className="inline-flex items-center gap-1 text-[11px] text-muted hover:text-accent">Explore the globe <Icon name="ArrowRight" className="h-3 w-3" /></button>} />
      <div className="h-[360px] sm:h-[420px]">
        {seen && data ? <NewsGlobe points={data.points} tags={p.deskTags ?? null} now={p.now} onOpen={(id) => p.onOpenCluster(id)} height="100%" compact /> : <div className="shimmer h-full w-full rounded-[var(--nr-radius)]" />}
      </div>
    </section>
  );
}

/* ---------------- Layout ---------------- */

function Heading({ title, action }: { title: string; action?: React.ReactNode }) {
  return <div className="nr-rule mb-4 flex items-baseline justify-between gap-3 pt-3"><h2 className="nr-kicker">{title}</h2>{action}</div>;
}

const ACTIONS: { id: "brief" | "listen" | "recap" | "globe"; label: string; icon: string; hint: string }[] = [
  { id: "brief", label: "Brief mode", icon: "GalleryVerticalEnd", hint: "Swipe through today's stories, one 20-second card at a time" },
  { id: "listen", label: "Listen", icon: "Headphones", hint: "Your briefing, read aloud, with a chapter for each story" },
  { id: "recap", label: "60-second recap", icon: "Film", hint: "The day in a minute of animated slides, to watch or share" },
  { id: "globe", label: "Globe", icon: "Globe2", hint: "Where today's news is happening" },
];

export function FrontLayout(p: LayoutProps) {
  const [hero, ...rest] = p.stories;
  const next = rest.slice(0, 3);
  const forYou = useMemo(() => rest.slice(3).filter((s) => s.reasons.some((r) => !r.startsWith("For your desk"))).slice(0, 8), [rest]);
  const skip = useMemo(() => new Set([hero?.id, ...next.map((s) => s.id), ...forYou.map((s) => s.id)]), [hero, next, forYou]);
  // Sections with two or more stories get their own heading; single stories gather in "More today".
  const { sections, more } = useMemo(() => {
    const out: { cat: Category; items: Story[] }[] = [];
    const rest: Story[] = [];
    for (const cat of SECTION_ORDER) {
      const items = p.stories.filter((s) => s.category === cat && !skip.has(s.id)).slice(0, 4);
      if (items.length >= 2) out.push({ cat, items }); else rest.push(...items);
    }
    return { sections: out, more: rest.slice(0, 8) };
  }, [p.stories, skip]);
  const outlets = useMemo(() => new Set(p.stories.flatMap((s) => s.sources.map((x) => x.name))).size, [p.stories]);
  const dateLine = p.now ? new Date(p.now).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }) : "";
  if (!hero) return null;
  return (
    <div>
      <FrontTicker p={p} />
      <div className="mx-auto max-w-[1280px] px-4 pb-24 pt-6 sm:px-6 sm:pt-8">
        <header className="mb-8 flex flex-wrap items-end justify-between gap-4 border-b border-line-strong pb-5">
          <div className="min-w-0">
            <div className="nr-kicker">YouBank Newsroom · {dateLine}</div>
            <h1 className="nr-head mt-2 text-[clamp(28px,3.6vw,46px)] leading-[1.02] text-fg">Today on the {p.deskLabel} desk</h1>
            <p className="mt-2 text-[12.5px] text-muted"><span className="num text-fg">{p.stories.length}</span> stories from <span className="num text-fg">{outlets}</span> outlets, ranked for you{p.brief?.brief.title ? <> · the brief: <span className="text-fg">{p.brief.brief.title}</span></> : null}</p>
          </div>
          {p.onAction && (
            <div className="flex flex-wrap gap-1.5">
              {ACTIONS.map((a) => (
                <button key={a.id} type="button" onClick={() => p.onAction!(a.id)} title={a.hint}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] transition ${a.id === "brief" ? "border-accent bg-accent text-accent-fg hover:opacity-90" : "border-line bg-panel/60 text-fg hover:border-accent/50 hover:text-accent"}`}>
                  <Icon name={a.icon} className="h-3.5 w-3.5" />{a.label}
                </button>
              ))}
            </div>
          )}
        </header>
        <Hero s={hero} p={p} />
        {next.length > 0 && (
          <section className="mt-12">
            <Heading title="Also leading" />
            <div className="grid gap-[var(--nr-gap)] sm:grid-cols-2 lg:grid-cols-3">{next.map((s, i) => <ArtCard key={s.id} s={s} p={p} i={i} tall />)}</div>
          </section>
        )}
        <DayInData p={p} />
        {forYou.length > 0 && (
          <section className="mt-14">
            <Heading title="For you" action={<span className="text-[11px] text-muted">Picked by your watchlist, network and reading</span>} />
            <div className="-mx-1 flex snap-x gap-[var(--nr-gap)] overflow-x-auto px-1 pb-2">
              {forYou.map((s, i) => <div key={s.id} className="w-[280px] shrink-0 snap-start sm:w-[300px]"><ArtCard s={s} p={p} i={i} /></div>)}
            </div>
          </section>
        )}
        <GlobeTeaser p={p} />
        {sections.map((sec) => (
          <section key={sec.cat} className="mt-14">
            <Heading title={CATEGORY_LABEL[sec.cat]} action={<button type="button" onClick={() => p.onCategory(sec.cat)} className="text-[11px] text-muted hover:text-accent">More {CATEGORY_LABEL[sec.cat].toLowerCase()} →</button>} />
            <div className="grid gap-[var(--nr-gap)] sm:grid-cols-2 xl:grid-cols-4">{sec.items.map((s, i) => <ArtCard key={s.id} s={s} p={p} i={i} />)}</div>
          </section>
        ))}
        {more.length > 0 && (
          <section className="mt-14">
            <Heading title="More today" />
            <div className="grid gap-[var(--nr-gap)] sm:grid-cols-2 xl:grid-cols-4">{more.map((s, i) => <ArtCard key={s.id} s={s} p={p} i={i} />)}</div>
          </section>
        )}
      </div>
    </div>
  );
}
