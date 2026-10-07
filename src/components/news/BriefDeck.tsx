"use client";

/**
 * Brief mode: the day's stories as a vertical deck of cards, one per screen. On a phone it swipes like
 * a short-video feed (native scroll snapping, so it is smooth and accessible); on a desktop the keys
 * drive it: ↓ or j next, ↑ or k back, s save, f follow, x less like this, Enter to open, Esc to leave.
 * Each card is a 20-second read (the headline and as much summary as fits in about 60 words) with one
 * chart: the story's price reaction, its deal, its key figures, or how fast coverage spread.
 *
 * A card read for a few seconds counts as read, and "less like this" hides the story: both teach the
 * personal front page (affinity.ts), as the page explains under "Why you're seeing this".
 */
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { briefCard, chartFor, figureBars } from "@/lib/news/storyviz";
import type { StoryCard as Story } from "@/lib/news/views";
import { Icon } from "@/components/ui/Icon";
import { post, useMotionLevel, type Spark } from "./client";
import { ArtThumb } from "./DataArt";
import { FollowButton, WhyShown } from "./StoryActions";
import { Kicker, Reasons } from "./StoryCard";
import { CoverageChart, DealChart, FigureBars, PriceReaction } from "./StoryCharts";

type Props = { stories: Story[]; sparks: Map<string, Spark | null>; now: number; onClose: () => void; onOpen: (s: Story) => void; onSave: (s: Story) => void; onChanged?: () => void };

/** How long a card must stay on screen to count as read. */
const DWELL_MS = 4_000;

function CardChart({ s, sparks, now }: { s: Story; sparks: Map<string, Spark | null>; now: number }) {
  const kind = chartFor(s, (t) => !!sparks.get(t)?.closes?.length);
  if (kind === "price") {
    const t = s.tickers.find((x) => sparks.get(x)?.closes?.length)!;
    return <PriceReaction ticker={t} closes={sparks.get(t)!.closes} firstSeenAt={s.firstSeenAt} now={now} height={120} />;
  }
  if (kind === "deal") return <DealChart valueUsd={s.deal!.valueUsd} premium={s.deal!.premium} evEbitda={s.deal!.evEbitda} label={s.deal!.kind.replace("_", " ")} />;
  if (kind === "figures") return <FigureBars bars={figureBars(s.summary!.numbers)} />;
  if (kind === "coverage") return <CoverageChart sources={s.sources.map((x) => ({ name: x.name, at: x.at }))} height={80} />;
  return <ArtThumb story={s} sparks={sparks} height={150} />;
}

export function BriefDeck({ stories, sparks, now, onClose, onOpen, onSave, onChanged }: Props) {
  const level = useMotionLevel();
  const deck = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState(0);
  const [hidden, setHidden] = useState<Set<number>>(new Set());
  const [saved, setSaved] = useState<Map<number, boolean>>(new Map());
  const [follow, setFollow] = useState(0);
  const cards = useMemo(() => stories.filter((s) => !hidden.has(s.id)).slice(0, 30), [stories, hidden]);
  const total = cards.length;

  const go = useCallback((i: number) => {
    const el = deck.current?.children[Math.max(0, Math.min(total, i))] as HTMLElement | undefined;
    el?.scrollIntoView({ behavior: level === "off" ? "auto" : "smooth", block: "start" });
  }, [total, level]);

  // Which card is on screen.
  useEffect(() => {
    const root = deck.current;
    if (!root) return;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) setActive(Number((e.target as HTMLElement).dataset.i));
    }, { root, threshold: 0.6 });
    for (const c of Array.from(root.children)) io.observe(c);
    return () => io.disconnect();
  }, [total]);

  // A card that stays on screen counts as read.
  const activeId = cards[active]?.id ?? null, activeRead = cards[active]?.read ?? true;
  useEffect(() => {
    if (activeId === null || activeRead) return;
    const t = setTimeout(() => { void post(`/api/news/story/${activeId}`, { action: "read" }).catch(() => undefined); }, DWELL_MS);
    return () => clearTimeout(t);
  }, [activeId, activeRead]);

  // No page scroll behind the deck.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    deck.current?.focus();
    return () => { document.body.style.overflow = prev; };
  }, []);

  const save = useCallback((s: Story) => { onSave(s); setSaved((m) => new Map(m).set(s.id, !(m.get(s.id) ?? s.saved))); }, [onSave]);
  const less = useCallback((s: Story) => {
    void post(`/api/news/story/${s.id}`, { action: "hide" }).then(() => onChanged?.()).catch(() => undefined);
    setHidden((h) => new Set(h).add(s.id));
  }, [onChanged]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input, textarea, select")) return;
      const s = cards[active];
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowDown" || e.key === "j" || e.key === "PageDown" || (e.key === " " && !e.shiftKey)) { e.preventDefault(); go(active + 1); }
      else if (e.key === "ArrowUp" || e.key === "k" || e.key === "PageUp" || (e.key === " " && e.shiftKey)) { e.preventDefault(); go(active - 1); }
      else if (s && e.key === "s") save(s);
      else if (s && e.key === "x") less(s);
      else if (s && e.key === "f") setFollow((n) => n + 1);
      else if (s && (e.key === "Enter" || e.key === "o")) onOpen(s);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, cards, go, onClose, onOpen, save, less]);

  return (
    <motion.div className="fixed inset-0 z-[60] bg-bg" initial={level === "off" ? false : { opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 24 }} transition={{ duration: level === "off" ? 0 : 0.25 }} role="dialog" aria-modal="true" aria-label="Brief mode">
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center justify-between gap-2 bg-gradient-to-b from-bg via-bg/80 to-transparent px-4 pb-6 pt-3">
        <div className="pointer-events-auto flex items-center gap-2 text-[12px] text-muted">
          <Icon name="GalleryVerticalEnd" className="h-4 w-4 text-accent" />
          <span className="font-semibold text-fg">Brief</span>
          <span className="num">{Math.min(active + 1, total)} / {total}</span>
        </div>
        <div className="pointer-events-auto flex items-center gap-2">
          <span className="hidden items-center gap-1 text-[10.5px] text-faint md:flex"><Icon name="Keyboard" className="h-3.5 w-3.5" />↑ ↓ to move · s save · f follow · x less like this · Enter open · Esc close</span>
          <button type="button" onClick={onClose} className="rounded-full border border-line bg-panel/80 p-1.5 text-muted hover:text-fg" aria-label="Leave Brief mode"><Icon name="X" className="h-4 w-4" /></button>
        </div>
      </div>
      {/* Progress: one tick per card, the current one lit. */}
      <div className="absolute right-2 top-1/2 z-10 hidden -translate-y-1/2 flex-col gap-1 md:flex" aria-hidden>
        {cards.map((s, i) => <button key={s.id} type="button" tabIndex={-1} onClick={() => go(i)} className={`h-4 w-1 rounded-full transition-all ${i === active ? "h-7 bg-accent" : i < active ? "bg-fg/40" : "bg-line-strong"}`} />)}
      </div>
      <div ref={deck} tabIndex={-1} className="nr-deck h-[100dvh] overflow-y-auto outline-none">
        {cards.map((s, i) => {
          const c = briefCard(s);
          const on = i === active;
          const isSaved = saved.get(s.id) ?? s.saved;
          return (
            <section key={s.id} data-i={i} className="flex h-[100dvh] items-center justify-center px-5 pb-10 pt-14 sm:pb-8 sm:pt-16" aria-label={`Story ${i + 1} of ${total}`}>
              <motion.article className="w-full max-w-[580px]" initial={false} animate={on || level === "off" ? { opacity: 1, y: 0, scale: 1 } : { opacity: 0.35, y: 12, scale: 0.98 }} transition={{ type: "spring", stiffness: 260, damping: 30 }}>
                <div className="flex items-center justify-between gap-2">
                  <Kicker s={s} now={now} />
                  <span className="num shrink-0 rounded-full bg-elevated px-2 py-0.5 text-[10.5px] text-muted">{c.seconds}s read</span>
                </div>
                <h2 className="nr-head mt-3 text-[clamp(23px,6vw,36px)] leading-[1.1] text-fg">{s.headline}</h2>
                <div className="nr-body mt-3 space-y-2 text-[15px] text-fg/85">{c.lines.map((l) => <p key={l}>{l}</p>)}</div>
                {c.why && <p className="mt-3 hidden border-l-2 border-accent pl-3 text-[14px] leading-relaxed text-fg/80 sm:block"><b className="text-fg">Why it matters. </b>{c.why}</p>}
                <div className="nr-card mt-4 p-3 sm:mt-5 sm:p-4">{on || i === active + 1 || i === active - 1 ? <CardChart s={s} sparks={sparks} now={now} /> : <div className="h-[120px]" />}</div>
                <div className="mt-3 flex flex-wrap items-center gap-1.5"><Reasons reasons={s.reasons.slice(0, 1)} /><WhyShown explain={s.explain} reasons={s.reasons} compact align="left" /></div>
                <div className="mt-4 flex flex-wrap items-center gap-2 sm:mt-5">
                  <button type="button" onClick={() => onOpen(s)} className="inline-flex items-center gap-1.5 rounded-full bg-fg px-3.5 py-2 text-[12.5px] font-medium text-bg hover:opacity-90">Open<Icon name="ArrowRight" className="h-3.5 w-3.5" /></button>
                  <button type="button" onClick={() => save(s)} aria-pressed={isSaved} className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-2 text-[12.5px] ${isSaved ? "border-accent/50 text-accent" : "border-line text-fg hover:border-accent/50"}`}><Icon name={isSaved ? "BookmarkCheck" : "Bookmark"} className="h-3.5 w-3.5" />{isSaved ? "Saved" : "Save"}</button>
                  <FollowKey key={`${s.id}-${on ? follow : 0}`} s={s} trigger={on ? follow : 0} />
                  <button type="button" onClick={() => less(s)} className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-2 text-[12px] text-muted hover:text-fg" title="Hide it, and show fewer like it"><Icon name="ThumbsDown" className="h-3.5 w-3.5" />Less like this</button>
                </div>
              </motion.article>
            </section>
          );
        })}
        <section data-i={total} className="flex h-[100dvh] items-center justify-center px-5">
          <div className="max-w-[440px] text-center">
            <Icon name="Check" className="mx-auto h-8 w-8 text-pos" />
            <h2 className="nr-head mt-3 text-[28px] text-fg">You&apos;re caught up</h2>
            <p className="mt-2 text-[13px] text-muted">That was today&apos;s {total} for your desk. New stories land every ten minutes.</p>
            <button type="button" onClick={onClose} className="mt-5 rounded-full bg-accent px-4 py-2 text-[12.5px] font-medium text-accent-fg">Back to the Newsroom</button>
          </div>
        </section>
      </div>
      <AnimatePresence>
        {active === 0 && total > 1 && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center text-[11px] text-muted sm:bottom-5">
            <span className="flex items-center gap-1 rounded-full bg-panel/80 px-3 py-1 backdrop-blur"><Icon name="ChevronUp" className="h-3.5 w-3.5" /><span className="md:hidden">Swipe up for the next story</span><span className="hidden md:inline">Press ↓ for the next story</span></span>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/** The follow button, which the "f" key can also press (through `trigger`). */
function FollowKey({ s, trigger }: { s: Story; trigger: number }) {
  const ref = useRef<HTMLSpanElement | null>(null);
  useEffect(() => { if (trigger) ref.current?.querySelector("button")?.click(); }, [trigger]);
  return <span ref={ref}><FollowButton id={s.id} following={!!s.following} /></span>;
}
