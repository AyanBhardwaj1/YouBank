"use client";

/**
 * The Edge feed: findings about what this person and their team watch, and what is trending across
 * Edge, ranked by a blend they can tune (relevance, size of the change, novelty, confidence).
 */
import { AnimatePresence, motion } from "motion/react";
import { Download, Loader2, Radar as RadarIcon, RefreshCw, SlidersHorizontal, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import type { EdgeBrief } from "@/lib/edge/brief";
import { EdgeCardView, type OnMap } from "./Cards";
import { api, post, useApi, type Blend, type EdgeCard, type EdgeState, type FeedData, type Scope } from "./client";
import { onTabKeys, tabProps } from "./tabs";

const SCOPES: { id: Scope | "all"; label: string }[] = [
  { id: "all", label: "Everything" }, { id: "mine", label: "Mine" }, { id: "team", label: "Team" }, { id: "trending", label: "Trending" },
];
/** Kinds of finding, as filter chips (only kinds the feed holds are shown). */
const KINDS: { id: string; label: string }[] = [
  { id: "ground_change", label: "Ground" }, { id: "radar_change", label: "Radar" }, { id: "flaring", label: "Flaring" }, { id: "methane_plume", label: "Methane" }, { id: "permits", label: "Permits" }, { id: "deal_proforma", label: "Deals" },
  { id: "filing_change", label: "Filings" }, { id: "graph_flag", label: "Red flags" }, { id: "graph_prediction", label: "Model picks" },
];
const SIGNALS: { key: keyof Blend; label: string; hint: string }[] = [
  { key: "relevance", label: "Relevance", hint: "How closely it touches what you watch" },
  { key: "size", label: "Size of change", hint: "Hectares of ground, or how much a deal changes the map" },
  { key: "novelty", label: "Novelty", hint: "Not in the news yet" },
  { key: "confidence", label: "Confidence", hint: "How sure Edge is" },
];

export function FeedView({ state, initial, onMap, onOpenDeal, onOpenRadar, onOpenNetworks, onBlend }: { state: EdgeState; initial?: FeedData; onMap: OnMap; onOpenDeal: (c: EdgeCard) => void; onOpenRadar: (c: EdgeCard) => void; onOpenNetworks: (ticker: string) => void; onBlend: () => void }) {
  const [scope, setScope] = useState<Scope | "all">("all");
  const [kind, setKind] = useState<string | null>(null);
  const [tuning, setTuning] = useState(false);
  // An empty feed is looked at again sooner while the first checks land (right after the beta is turned on or a watch is added).
  const [quiet, setQuiet] = useState(false);
  const query = `scope=${scope}${kind ? `&kind=${kind}` : ""}`;
  // The first page may have come with the page itself (only for the opening scope).
  const feed = useApi<FeedData>(`/api/edge/feed?${query}`, quiet ? 20_000 : 120_000, initial, initial?.generatedAt);
  // Further pages, loaded on request and kept for the scope and kind they were loaded in.
  const [extra, setExtra] = useState<{ query: string; cards: EdgeCard[] }>({ query: "", cards: [] });
  const [loadingMore, setLoadingMore] = useState(false);
  const first = feed.data?.cards ?? [];
  const cards = [...first, ...(extra.query === query ? extra.cards : []).filter((c) => !first.some((x) => x.id === c.id))];
  const counts = feed.data?.counts;
  const [kinds, setKinds] = useState<Record<string, number>>({});
  // The chips keep the counts of the unfiltered feed while one kind is shown.
  useEffect(() => { if (feed.data?.kinds && !kind) queueMicrotask(() => setKinds(feed.data!.kinds!)); }, [feed.data, kind]);
  const empty = !!feed.data && !feed.data.cards.length;
  useEffect(() => { queueMicrotask(() => setQuiet(empty)); }, [empty]);
  const { reload } = feed;

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const d = await api<FeedData>(`/api/edge/feed?${query}&offset=${cards.length}`);
      setExtra((cur) => ({ query, cards: [...(cur.query === query ? cur.cards : []), ...d.cards] }));
    } catch { /* the button stays for another try */ } finally { setLoadingMore(false); }
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="Feed scope" onKeyDown={onTabKeys}>
          {SCOPES.map((s) => {
            const n = s.id === "all" ? (counts ? counts.mine + counts.team + counts.trending : null) : counts?.[s.id] ?? null;
            return (
              <button key={s.id} type="button" {...tabProps(scope === s.id)} onClick={() => setScope(s.id)} className={`ctl flex items-center gap-1.5 px-2.5 py-1 text-[12px] transition ${scope === s.id ? "bg-accent-soft text-accent" : "text-muted hover:text-fg"}`}>
                {s.label}{n !== null && <span className="num text-[10.5px] opacity-70">{n}</span>}
              </button>
            );
          })}
        </div>
        <a href="/api/edge/audit?all=1" className="ctl ml-auto flex items-center gap-1.5 px-2 py-1 text-[11.5px] text-muted hover:text-fg" title="Every finding in your feed with its sources, licenses, retrieval times and methods"><Download className="h-3.5 w-3.5" /> Audit log</a>
        <button type="button" onClick={() => setTuning((t) => !t)} aria-expanded={tuning} className="ctl flex items-center gap-1.5 border border-line px-2.5 py-1 text-[12px] text-muted hover:border-accent/50 hover:text-fg">
          <SlidersHorizontal className="h-3.5 w-3.5" /> Tune ranking
        </button>
      </div>

      <AnimatePresence initial={false}>
        {tuning && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <Tuning initial={state.blend} onClose={() => setTuning(false)} onSaved={() => { setTuning(false); setExtra({ query: "", cards: [] }); reload(); onBlend(); }} />
          </motion.div>
        )}
      </AnimatePresence>

      {Object.keys(kinds).length > 1 && (
        <div className="mt-2 flex flex-wrap gap-1" role="group" aria-label="Kind of finding">
          <button type="button" aria-pressed={!kind} onClick={() => setKind(null)} className={`rounded-full border px-2 py-0.5 text-[11.5px] ${!kind ? "border-accent/50 bg-accent-soft text-accent" : "border-line text-muted hover:text-fg"}`}>All kinds</button>
          {KINDS.filter((k) => kinds[k.id]).map((k) => (
            <button key={k.id} type="button" aria-pressed={kind === k.id} onClick={() => setKind(kind === k.id ? null : k.id)} className={`rounded-full border px-2 py-0.5 text-[11.5px] ${kind === k.id ? "border-accent/50 bg-accent-soft text-accent" : "border-line text-muted hover:text-fg"}`}>
              {k.label} <span className="num text-[10.5px] opacity-70">{kinds[k.id]}</span>
            </button>
          ))}
        </div>
      )}

      {scope === "all" && !kind && <BriefPanel cards={cards} />}

      {feed.error && !feed.data && (
        <div className="panel mt-4 flex flex-wrap items-center justify-between gap-2 px-4 py-3">
          <p className="text-[12.5px] text-neg">The feed did not load: {feed.error}</p>
          <button type="button" onClick={reload} className="ctl flex items-center gap-1.5 border border-line px-2.5 py-1 text-[12px] text-muted hover:text-fg"><RefreshCw className="h-3.5 w-3.5" /> Try again</button>
        </div>
      )}
      {!feed.data && !feed.error && <CardSkeletons />}
      {empty && (
        <div className="panel mt-4 flex flex-col items-center gap-2 px-6 py-12 text-center">
          <span className="relative flex h-10 w-10 items-center justify-center"><span className="pulse-ring absolute inset-0 rounded-full bg-accent/25" /><RadarIcon className="relative h-5 w-5 text-accent" /></span>
          <h3 className="text-[14px] font-semibold">{scope === "all" || scope === "mine" ? "Edge is looking at your watches" : scope === "team" ? "Nothing from your team's watches yet" : "Nothing trending yet"}</h3>
          <p className="max-w-[52ch] text-[12.5px] text-muted">Each watched plant is compared with the same place a year ago in Sentinel-2 imagery, and deals that touch your companies are drawn on the map. Most sites are quiet; changes appear here as they are found, and everything is looked at again daily.</p>
        </div>
      )}
      {cards.length > 0 && (
        <div className="mt-3 grid items-start gap-3 lg:grid-cols-2">
          {cards.map((c, i) => <EdgeCardView key={c.id} card={c} index={i} onMap={onMap} onOpenDeal={onOpenDeal} onOpenRadar={onOpenRadar} onOpenNetworks={onOpenNetworks} />)}
        </div>
      )}
      {feed.data && cards.length < feed.data.total && (
        <div className="mt-4 flex justify-center">
          <button type="button" onClick={loadMore} disabled={loadingMore} className="ctl flex items-center gap-1.5 border border-line px-3 py-1.5 text-[12px] text-muted hover:border-accent/50 hover:text-fg">
            {loadingMore && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Show more ({feed.data.total - cards.length})
          </button>
        </div>
      )}
    </div>
  );
}

/** The ranking sliders. The draft lives here, so dragging a slider redraws the panel and not the cards below. */
function Tuning({ initial, onClose, onSaved }: { initial: Blend; onClose: () => void; onSaved: () => void }) {
  const [blend, setBlend] = useState(initial);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    await post("/api/edge", { blend }).catch(() => undefined);
    setSaving(false); onSaved();
  };
  return (
    <div className="panel mt-2 grid gap-3 p-3 sm:grid-cols-2">
      {SIGNALS.map((s) => (
        <label key={s.key} className="block text-[12px]">
          <span className="flex items-center justify-between"><span>{s.label}</span><span className="num text-muted">{Math.round(blend[s.key] * 100)}</span></span>
          <input type="range" min={0} max={100} value={Math.round(blend[s.key] * 100)} onChange={(e) => setBlend((b) => ({ ...b, [s.key]: Number(e.target.value) / 100 }))} className="mt-1 w-full accent-[var(--accent)]" aria-describedby={`hint-${s.key}`} />
          <span id={`hint-${s.key}`} className="text-[10.5px] text-faint">{s.hint}</span>
        </label>
      ))}
      <div className="flex items-center justify-end gap-2 sm:col-span-2">
        <button type="button" onClick={onClose} className="ctl px-3 py-1.5 text-[12px] text-muted hover:text-fg">Cancel</button>
        <button type="button" onClick={save} disabled={saving} className="ctl flex items-center gap-1.5 bg-accent px-3 py-1.5 text-[12px] font-semibold text-accent-fg disabled:opacity-60">{saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Save ranking</button>
      </div>
    </div>
  );
}

/** Placeholders shaped like ground cards (a square image, a title, two lines, the footer), so nothing jumps when the feed lands. */
function CardSkeletons() {
  return (
    <div className="mt-3 grid items-start gap-3 lg:grid-cols-2" aria-busy="true" aria-label="Loading the feed">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="panel overflow-hidden">
          <div className="flex items-center justify-between px-3.5 pt-3"><div className="shimmer h-3 w-40 rounded" /><div className="shimmer h-3 w-24 rounded" /></div>
          <div className="mt-2.5 px-3.5"><div className="shimmer aspect-square w-full rounded-lg" /></div>
          <div className="space-y-2 px-3.5 pb-3.5 pt-3">
            <div className="shimmer h-4 w-3/4 rounded" />
            <div className="flex gap-1.5"><div className="shimmer h-4 w-28 rounded-md" /><div className="shimmer h-4 w-36 rounded-md" /></div>
            <div className="shimmer h-3 w-full rounded" /><div className="shimmer h-3 w-5/6 rounded" />
            <div className="flex justify-between pt-1"><div className="shimmer h-2.5 w-32 rounded" /><div className="shimmer h-2.5 w-40 rounded" /></div>
          </div>
        </div>
      ))}
    </div>
  );
}

/** The fortnight across the person's watches in a few lines, each pointing at the cards it rests on. */
function BriefPanel({ cards }: { cards: EdgeCard[] }) {
  const { data } = useApi<{ brief: EdgeBrief | null }>("/api/edge/brief");
  const b = data?.brief;
  if (!b) return null;
  const titleOf = (id: number) => cards.find((c) => c.id === id)?.title ?? "a card below";
  return (
    <section className="panel mt-3 p-3.5" aria-label="The fortnight in brief">
      <div className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.09em] text-accent"><Sparkles className="h-3.5 w-3.5" /> The fortnight across your watches</div>
      <h3 className="mt-1 text-[15px] font-semibold leading-snug tracking-tight">{b.headline}</h3>
      <ul className="mt-2 space-y-1.5">
        {b.points.map((p, i) => (
          <li key={i} className="text-[12.5px] leading-relaxed">
            {p.text.replace(/\s*\[\d+(?:\s*[,–-]\s*\d+)*\]/g, "")}
            {p.cards.map((id) => <a key={id} href={`#edge-card-${id}`} title={titleOf(id)} className="ml-1.5 inline-block max-w-[16ch] truncate rounded bg-elevated px-1.5 align-[-2px] text-[10.5px] text-muted hover:text-fg">{titleOf(id)}</a>)}
          </li>
        ))}
      </ul>
      {b.watch && <p className="mt-2 text-[12px] text-muted"><span className="font-semibold text-fg">Watch next. </span>{b.watch}</p>}
      <p className="mt-1.5 text-[10px] text-faint">Written by AI from the {b.cards} newest findings below, nothing else; each line links to the cards it rests on.</p>
    </section>
  );
}
