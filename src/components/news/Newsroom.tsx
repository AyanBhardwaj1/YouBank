"use client";

/**
 * The Newsroom. One feed ranked for this person, worn in any of four editions (or any look with any
 * layout, with the advanced switch), with the morning brief, the deal tracker, the tech radar and saved
 * stories as views. Stories open in a side peek or on their own page, as the person prefers.
 */
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { Columns3, LayoutDashboard, Newspaper, Rows3, Search, SlidersHorizontal, Terminal as TerminalIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CATEGORY_LABEL, type Category } from "@/lib/news/classify";
import type { StoryCard as Story } from "@/lib/news/views";
import { EDITIONS, LAYOUTS, LOOKS, type EditionId, type LayoutId, type LookId } from "@/lib/news/prefs";
import { ago, MotionContext, post, useApi, useEffectiveMotion, useFeed, useNow, useSparks } from "./client";
import { DealTracker, LeagueTable, RadarBoard, type BriefData, type DealsData, type RadarData } from "./Boards";
import { DashboardLayout, HybridLayout, MagazineLayout, WireLayout, type LayoutProps } from "./layouts";
import { StoryCard } from "./StoryCard";
import { StoryPeek } from "./StoryReader";

type View = "today" | "deals" | "radar" | "saved";
const EDITION_ICON: Record<EditionId, React.ReactNode> = {
  terminal: <TerminalIcon className="h-3.5 w-3.5" />, editorial: <Newspaper className="h-3.5 w-3.5" />, brief: <Rows3 className="h-3.5 w-3.5" />, modern: <LayoutDashboard className="h-3.5 w-3.5" />,
};
const LAYOUT_OF: Record<LayoutId, (p: LayoutProps) => React.ReactNode> = { wire: WireLayout, magazine: MagazineLayout, hybrid: HybridLayout, dashboard: DashboardLayout };

export function Newsroom({ initialView = "today", initialStory = null }: { initialView?: View; initialStory?: number | null }) {
  const router = useRouter();
  const now = useNow();
  const [view, setView] = useState<View>(initialView);
  const [category, setCategory] = useState("");
  const [query, setQuery] = useState({ typed: "", applied: "" });
  const [desk, setDesk] = useState("");
  const [peek, setPeek] = useState<number | null>(initialStory);
  const [override, setOverride] = useState<{ edition?: EditionId; look?: LookId; layout?: LayoutId; advanced?: boolean }>({});
  const [showAdvanced, setShowAdvanced] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const feed = useFeed({ desk, category: view === "today" ? category : "", q: query.applied, saved: view === "saved" ? "1" : "" });
  const data = feed.data;
  const prefs = data?.prefs;
  const edition = override.edition ?? prefs?.edition ?? "brief";
  const advanced = override.advanced ?? prefs?.advanced ?? false;
  const look: LookId = advanced ? override.look ?? prefs?.look ?? EDITIONS[edition].look : EDITIONS[edition].look;
  const layout: LayoutId = advanced ? override.layout ?? prefs?.layout ?? EDITIONS[edition].layout : EDITIONS[edition].layout;
  const motionLevel = useEffectiveMotion(prefs?.motion ?? "rich");
  const deskId = data?.desk.id ?? "";
  const showRadar = !!data && (data.desk.lenses.includes("radar") || data.desk.lenses.includes("vc") || data.desk.sectors.includes("tech"));

  // The brief feeds every layout of Today (the wire uses its market tape).
  const brief = useApi<BriefData>(view === "today" && deskId ? `/api/news/brief?desk=${encodeURIComponent(deskId)}` : null, 5 * 60_000);
  const deals = useApi<DealsData>((view === "deals" || layout === "dashboard") ? `/api/news/deals?days=${view === "deals" ? 60 : 30}` : null, 5 * 60_000);
  const radar = useApi<RadarData>((view === "radar" || (layout === "dashboard" && showRadar)) ? "/api/news/radar" : null, 15 * 60_000);

  const stories = useMemo(() => data?.stories ?? [], [data]);
  const tickers = useMemo(() => [...stories.slice(0, 60).flatMap((s) => s.tickers.slice(0, 1)), ...(brief.data?.forYou ?? []).flatMap((s) => s.tickers.slice(0, 1)), ...Object.values(brief.data?.cards ?? {}).flatMap((s) => s.tickers.slice(0, 1))], [stories, brief.data]);
  const sparks = useSparks(tickers);

  const savePrefs = useCallback((patch: Record<string, unknown>) => { void post("/api/news/prefs", { prefs: patch }).catch(() => undefined); }, []);
  const chooseEdition = (e: EditionId) => { setOverride((o) => ({ ...o, edition: e, look: EDITIONS[e].look, layout: EDITIONS[e].layout })); savePrefs({ edition: e, look: EDITIONS[e].look, layout: EDITIONS[e].layout }); };
  const chooseLook = (l: LookId) => { setOverride((o) => ({ ...o, advanced: true, look: l, layout })); savePrefs({ advanced: true, look: l, layout }); };
  const chooseLayout = (l: LayoutId) => { setOverride((o) => ({ ...o, advanced: true, layout: l, look })); savePrefs({ advanced: true, look, layout: l }); };

  const open = useCallback((s: Story | number) => {
    const id = typeof s === "number" ? s : s.id;
    if (prefs?.reading === "page") router.push(`/app/news/story/${id}`); else setPeek(id);
  }, [prefs?.reading, router]);
  const step = useCallback((dir: 1 | -1) => {
    setPeek((cur) => { if (cur === null) return cur; const i = stories.findIndex((s) => s.id === cur); const next = stories[i + dir]; return next ? next.id : cur; });
  }, [stories]);
  const save = useCallback((s: Story) => { void post(`/api/news/story/${s.id}`, { action: s.saved ? "unsave" : "save" }).then(() => feed.reload()); }, [feed]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && !(e.target as HTMLElement)?.closest("input, textarea, select")) { e.preventDefault(); searchRef.current?.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const Layout = LAYOUT_OF[layout];
  const counts = data?.counts ?? {};
  const cats = (Object.keys(CATEGORY_LABEL) as Category[]).filter((c) => counts[c]);
  const transition = motionLevel === "rich" ? { duration: 0.35, ease: [0.2, 0.8, 0.2, 1] as const } : { duration: motionLevel === "off" ? 0 : 0.15 };

  return (
    <MotionContext value={motionLevel}>
      <div className="nr flex h-full flex-col" data-look={look} data-motion={motionLevel}>
        <header className="glass z-20 border-b border-line bg-bg/85 px-4 py-2.5">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="flex min-w-0 items-center gap-2">
              <Newspaper className="h-4 w-4 shrink-0 text-accent" />
              <select value={desk || deskId} onChange={(e) => setDesk(e.target.value === data?.ownDesk.id ? "" : e.target.value)} className="nr-head max-w-[260px] truncate bg-transparent text-[15px] text-fg outline-none" aria-label="Desk">
                {data ? data.desks.map((d) => <option key={d.id} value={d.id}>{d.label}{d.id === data.ownDesk.id ? " (your desk)" : ""}</option>) : <option>Newsroom</option>}
              </select>
              <span className="hidden items-center gap-1.5 text-[11px] text-muted md:flex"><span className="pulse-ring inline-block h-1.5 w-1.5 rounded-full bg-pos" />{data && now ? `updated ${ago(data.generatedAt, now)}` : "live"}</span>
            </div>
            <nav className="flex items-center gap-0.5" aria-label="Newsroom views">
              {(["today", "deals", "radar", "saved"] as View[]).map((v) => (
                <button key={v} type="button" onClick={() => setView(v)} className={`relative rounded-md px-2.5 py-1 text-[12px] capitalize transition ${view === v ? "text-fg" : "text-muted hover:text-fg"}`}>
                  {view === v && <motion.span layoutId="nr-tab" className="absolute inset-0 rounded-md bg-elevated" transition={{ type: "spring", stiffness: 500, damping: 36 }} />}
                  <span className="relative">{v === "today" ? "Today" : v}</span>
                </button>
              ))}
            </nav>
            <form onSubmit={(e) => { e.preventDefault(); setQuery((q) => ({ ...q, applied: q.typed.trim() })); setView("today"); }} className="ml-auto flex items-center gap-1.5 rounded-full border border-line bg-elevated/50 px-2.5 py-1">
              <Search className="h-3.5 w-3.5 text-muted" />
              <input ref={searchRef} value={query.typed} onChange={(e) => { const t = e.target.value; setQuery((q) => ({ typed: t, applied: t ? q.applied : "" })); }} placeholder="Search stories  /" className="w-40 bg-transparent text-[12px] text-fg outline-none placeholder:text-faint md:w-56" />
            </form>
            <div className="flex items-center gap-0.5 rounded-full border border-line p-0.5" role="radiogroup" aria-label="Edition">
              {(Object.keys(EDITIONS) as EditionId[]).map((e) => (
                <button key={e} type="button" role="radio" aria-checked={!advanced && edition === e} onClick={() => chooseEdition(e)} title={`${EDITIONS[e].label}: ${EDITIONS[e].blurb}`}
                  className={`relative flex items-center gap-1 rounded-full px-2 py-1 text-[11px] transition ${!advanced && edition === e ? "text-accent-fg" : "text-muted hover:text-fg"}`}>
                  {!advanced && edition === e && <motion.span layoutId="nr-edition" className="absolute inset-0 rounded-full bg-accent" transition={{ type: "spring", stiffness: 500, damping: 34 }} />}
                  <span className="relative flex items-center gap-1">{EDITION_ICON[e]}<span className="hidden lg:inline">{EDITIONS[e].label}</span></span>
                </button>
              ))}
              <button type="button" onClick={() => setShowAdvanced((v) => !v)} className={`rounded-full px-2 py-1 text-[11px] ${advanced ? "text-accent" : "text-muted hover:text-fg"}`} title="Mix any look with any layout" aria-expanded={showAdvanced}><SlidersHorizontal className="h-3.5 w-3.5" /></button>
            </div>
          </div>
          <AnimatePresence>
            {showAdvanced && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                <div className="flex flex-wrap items-center gap-4 pt-2.5 text-[11.5px]">
                  <span className="text-muted">Mix and match:</span>
                  <label className="flex items-center gap-1.5">Look<select value={look} onChange={(e) => chooseLook(e.target.value as LookId)} className="rounded-md border border-line bg-elevated px-1.5 py-0.5">{(Object.keys(LOOKS) as LookId[]).map((l) => <option key={l} value={l}>{LOOKS[l]}</option>)}</select></label>
                  <label className="flex items-center gap-1.5">Layout<select value={layout} onChange={(e) => chooseLayout(e.target.value as LayoutId)} className="rounded-md border border-line bg-elevated px-1.5 py-0.5">{(Object.keys(LAYOUTS) as LayoutId[]).map((l) => <option key={l} value={l}>{LAYOUTS[l].label}</option>)}</select></label>
                  {advanced && <button type="button" onClick={() => { setOverride((o) => ({ ...o, advanced: false })); savePrefs({ advanced: false, edition }); }} className="text-muted underline-offset-2 hover:text-fg hover:underline">Back to the {EDITIONS[edition].label} edition</button>}
                  <span className="text-faint">Saved to your profile. More in Settings, News and alerts.</span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          {view === "today" && cats.length > 0 && (
            <div className="-mx-1 mt-2 flex gap-1 overflow-x-auto px-1 pb-0.5">
              <button type="button" onClick={() => setCategory("")} className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] ${!category ? "border-accent/50 bg-accent-soft text-accent" : "border-line text-muted hover:text-fg"}`}>All</button>
              {cats.map((c) => <button key={c} type="button" onClick={() => setCategory(category === c ? "" : c)} className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] ${category === c ? "border-accent/50 bg-accent-soft text-accent" : "border-line text-muted hover:text-fg"}`}>{CATEGORY_LABEL[c]} <span className="num text-faint">{counts[c]}</span></button>)}
              {query.applied && <button type="button" onClick={() => setQuery({ typed: "", applied: "" })} className="shrink-0 rounded-full border border-line px-2.5 py-0.5 text-[11px] text-muted hover:text-fg">“{query.applied}” ×</button>}
            </div>
          )}
        </header>

        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
          {feed.error && !data && <div className="p-8 text-center text-[12.5px] text-neg">{feed.error}</div>}
          {!data && !feed.error && <div className="mx-auto max-w-[1100px] space-y-3 p-6">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="shimmer h-20 rounded-[var(--nr-radius)]" style={{ animationDelay: `${i * 80}ms` }} />)}</div>}
          {data && (
            <AnimatePresence mode="wait">
              <motion.div key={`${view}-${look}-${layout}`} initial={motionLevel === "off" ? false : { opacity: 0, y: motionLevel === "rich" ? 10 : 0, filter: motionLevel === "rich" ? "blur(4px)" : "none" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} exit={motionLevel === "off" ? undefined : { opacity: 0, y: motionLevel === "rich" ? -6 : 0 }} transition={transition}>
                {view === "today" && (stories.length
                  ? <Layout stories={stories} fresh={feed.fresh} sparks={sparks} now={now} onOpen={open} onSave={save} onOpenCluster={(id) => open(id)} onCategory={setCategory}
                      brief={brief.data} deals={deals.data} radar={radar.data} deskLabel={data.desk.label} showRadar={showRadar} scrollRef={scrollRef} />
                  : <Empty text={query.applied ? `No stories match “${query.applied}” in the last month.` : "Your desk's first stories arrive as sources are read, every ten minutes."} />)}
                {view === "saved" && (stories.length
                  ? <div className="mx-auto max-w-[900px] divide-y divide-line px-5 py-6">{stories.map((s, i) => <StoryCard key={s.id} story={s} variant="brief" index={i} sparks={sparks} now={now} onOpen={open} onSave={save} />)}</div>
                  : <Empty text="Nothing saved yet. Use the bookmark on any story to keep it here." />)}
                {view === "deals" && (
                  <div className="mx-auto grid max-w-[1400px] gap-6 px-5 py-6 xl:grid-cols-[minmax(0,1fr)_320px]">
                    <div className="nr-card min-w-0 p-[var(--nr-pad)]"><h2 className="nr-head nr-h2 mb-1 text-fg">Deal tracker</h2><p className="mb-4 text-[11.5px] text-muted">Every deal, raise, IPO and financing the Newsroom read in the last 60 days, with the premium to the unaffected close and implied multiples where the target is a US filer.</p>{deals.data ? <DealTracker data={deals.data} onOpenCluster={(id) => open(id)} /> : <div className="shimmer h-64 rounded" />}</div>
                    <div className="space-y-4">{deals.data && <><div className="nr-card p-[var(--nr-pad)]"><LeagueTable rows={deals.data.league.financial} title="Financial advisors, last 12 months" /></div><div className="nr-card p-[var(--nr-pad)]"><LeagueTable rows={deals.data.league.legal} title="Legal advisors, last 12 months" /></div></>}</div>
                  </div>
                )}
                {view === "radar" && <div className="mx-auto max-w-[1440px] px-5 py-6"><h2 className="nr-head nr-h2 mb-1 text-fg">Tech radar</h2><p className="mb-4 text-[11.5px] text-muted">What researchers and builders are paying attention to this week, before it is news: Hugging Face daily papers and trending models, GitHub&apos;s fastest-rising repositories, and Show HN launches.</p>{radar.data ? <RadarBoard data={radar.data} /> : <div className="shimmer h-64 rounded" />}</div>}
              </motion.div>
            </AnimatePresence>
          )}
        </div>
        <StoryPeek id={peek} onClose={() => setPeek(null)} onStep={step} onChanged={() => feed.reload()} />
      </div>
    </MotionContext>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="mx-auto flex max-w-[520px] flex-col items-center gap-3 px-6 py-24 text-center"><Columns3 className="h-8 w-8 text-faint" /><p className="text-[13px] text-muted">{text}</p></div>;
}
