"use client";

/**
 * The Edge feed: findings about what this person and their team watch, and what is trending across
 * Edge, ranked by a blend they can tune (relevance, size of the change, novelty, confidence).
 */
import { AnimatePresence, motion } from "motion/react";
import { Loader2, Radar as RadarIcon, SlidersHorizontal } from "lucide-react";
import { useEffect, useState } from "react";
import { EdgeCardView } from "./Cards";
import { api, post, useApi, type Blend, type EdgeCard, type EdgeState, type FeedData, type Scope } from "./client";

const SCOPES: { id: Scope | "all"; label: string }[] = [
  { id: "all", label: "Everything" }, { id: "mine", label: "Mine" }, { id: "team", label: "Team" }, { id: "trending", label: "Trending" },
];
const SIGNALS: { key: keyof Blend; label: string; hint: string }[] = [
  { key: "relevance", label: "Relevance", hint: "How closely it touches what you watch" },
  { key: "size", label: "Size of change", hint: "Hectares of ground, or how much a deal changes the map" },
  { key: "novelty", label: "Novelty", hint: "Not in the news yet" },
  { key: "confidence", label: "Confidence", hint: "How sure Edge is" },
];

export function FeedView({ state, now, onMap, onOpenDeal, onOpenRadar, onOpenNetworks, onBlend }: { state: EdgeState; now: number; onMap: (c: EdgeCard) => void; onOpenDeal: (c: EdgeCard) => void; onOpenRadar: (c: EdgeCard) => void; onOpenNetworks: (ticker: string) => void; onBlend: () => void }) {
  const [scope, setScope] = useState<Scope | "all">("all");
  const [tuning, setTuning] = useState(false);
  const [blend, setBlend] = useState(state.blend);
  const feed = useApi<FeedData>(`/api/edge/feed?scope=${scope}`, 120_000);
  // Further pages, loaded on request and kept for the scope they were loaded in.
  const [extra, setExtra] = useState<{ scope: string; cards: EdgeCard[] }>({ scope: "", cards: [] });
  const [loadingMore, setLoadingMore] = useState(false);
  const first = feed.data?.cards ?? [];
  const cards = [...first, ...(extra.scope === scope ? extra.cards : []).filter((c) => !first.some((x) => x.id === c.id))];
  const counts = feed.data?.counts;

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const d = await api<FeedData>(`/api/edge/feed?scope=${scope}&offset=${cards.length}`);
      setExtra((cur) => ({ scope, cards: [...(cur.scope === scope ? cur.cards : []), ...d.cards] }));
    } catch { /* the button stays for another try */ } finally { setLoadingMore(false); }
  };

  // Right after the beta is turned on or a watch is added, look again sooner while the first checks land.
  const empty = !!feed.data && !feed.data.cards.length;
  const { reload } = feed;
  useEffect(() => {
    if (!empty) return;
    const t = setInterval(reload, 20_000);
    return () => clearInterval(t);
  }, [empty, reload]);

  const saveBlend = async () => {
    await post("/api/edge", { blend }).catch(() => undefined);
    setTuning(false); setExtra({ scope: "", cards: [] }); reload(); onBlend();
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="Feed scope">
          {SCOPES.map((s) => {
            const n = s.id === "all" ? (counts ? counts.mine + counts.team + counts.trending : null) : counts?.[s.id] ?? null;
            return (
              <button key={s.id} type="button" role="tab" aria-selected={scope === s.id} onClick={() => setScope(s.id)} className={`ctl flex items-center gap-1.5 px-2.5 py-1 text-[12px] transition ${scope === s.id ? "bg-accent-soft text-accent" : "text-muted hover:text-fg"}`}>
                {s.label}{n !== null && <span className="num text-[10.5px] opacity-70">{n}</span>}
              </button>
            );
          })}
        </div>
        <button type="button" onClick={() => setTuning((t) => !t)} aria-expanded={tuning} className="ctl ml-auto flex items-center gap-1.5 border border-line px-2.5 py-1 text-[12px] text-muted hover:border-accent/50 hover:text-fg">
          <SlidersHorizontal className="h-3.5 w-3.5" /> Tune ranking
        </button>
      </div>

      <AnimatePresence initial={false}>
        {tuning && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="panel mt-2 grid gap-3 p-3 sm:grid-cols-2">
              {SIGNALS.map((s) => (
                <label key={s.key} className="block text-[12px]">
                  <span className="flex items-center justify-between"><span>{s.label}</span><span className="num text-muted">{Math.round(blend[s.key] * 100)}</span></span>
                  <input type="range" min={0} max={100} value={Math.round(blend[s.key] * 100)} onChange={(e) => setBlend((b) => ({ ...b, [s.key]: Number(e.target.value) / 100 }))} className="mt-1 w-full accent-[var(--accent)]" aria-describedby={`hint-${s.key}`} />
                  <span id={`hint-${s.key}`} className="text-[10.5px] text-faint">{s.hint}</span>
                </label>
              ))}
              <div className="flex items-center justify-end gap-2 sm:col-span-2">
                <button type="button" onClick={() => { setBlend(state.blend); setTuning(false); }} className="ctl px-3 py-1.5 text-[12px] text-muted hover:text-fg">Cancel</button>
                <button type="button" onClick={saveBlend} className="ctl bg-accent px-3 py-1.5 text-[12px] font-semibold text-accent-fg">Save ranking</button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {feed.error && !feed.data && <p className="mt-6 text-[12.5px] text-neg">{feed.error}</p>}
      {!feed.data && !feed.error && (
        <div className="mt-4 grid gap-3 lg:grid-cols-2">{[0, 1, 2, 3].map((i) => <div key={i} className="panel h-[420px] animate-pulse bg-elevated/40" />)}</div>
      )}
      {empty && (
        <div className="panel mt-4 flex flex-col items-center gap-2 px-6 py-12 text-center">
          <span className="relative flex h-10 w-10 items-center justify-center"><span className="pulse-ring absolute inset-0 rounded-full bg-accent/25" /><RadarIcon className="relative h-5 w-5 text-accent" /></span>
          <h3 className="text-[14px] font-semibold">{scope === "all" || scope === "mine" ? "Edge is looking at your watches" : scope === "team" ? "Nothing from your team's watches yet" : "Nothing trending yet"}</h3>
          <p className="max-w-[52ch] text-[12.5px] text-muted">Each watched plant is compared with the same place a year ago in Sentinel-2 imagery, and deals that touch your companies are drawn on the map. Most sites are quiet; changes appear here as they are found, and everything is looked at again daily.</p>
        </div>
      )}
      {cards.length > 0 && (
        <div className="mt-3 grid items-start gap-3 lg:grid-cols-2">
          {cards.map((c, i) => <EdgeCardView key={c.id} card={c} index={i} now={now} onMap={onMap} onOpenDeal={onOpenDeal} onOpenRadar={onOpenRadar} onOpenNetworks={onOpenNetworks} />)}
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
