"use client";

/**
 * Reading a story: the side peek (the feed stays beside it; arrow keys step through stories) and the
 * full page share one body. What happened, the key numbers, why it matters (and, on request, why it
 * matters to you), deal terms with the premium and implied multiples (and, with the Edge beta on, the
 * deal on Edge's map), every source with a link to its publisher, the companies in it (straight into the
 * terminal), and related stories.
 */
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, ArrowRight, Bookmark, BookmarkCheck, ExternalLink, EyeOff, Maximize2, Network, Sparkles, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { StoryView } from "@/lib/news/views";
import { DealMap } from "@/components/edge/DealMap";
import { useWorkspace } from "@/components/workspace/WorkspaceProvider";
import { ago, fmtPct, fmtUsd, post, useApi, useMotionLevel, useNow, useSparks } from "./client";
import { hueOf, StoryArt } from "./DataArt";
import { useCoarsePointer } from "@/components/ui/useMedia";

type Props = { id: number; onClose?: () => void; onStep?: (dir: 1 | -1) => void; onChanged?: () => void; mode: "peek" | "page" };

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="mt-6"><h3 className="nr-kicker mb-2">{title}</h3>{children}</section>;
}

export function StoryBody({ id, onClose, onStep, onChanged, mode }: Props) {
  const { data: s, error, reload } = useApi<StoryView>(`/api/news/story/${id}`);
  const { edge } = useWorkspace();
  const now = useNow();
  const sparks = useSparks(s?.tickers ?? []);
  const [why, setWhy] = useState<{ id: number; text: string | null; busy: boolean; reason?: string }>({ id: 0, text: null, busy: false });
  const [note, setNote] = useState<{ id: number; text: string } | null>(null);
  useEffect(() => { void post(`/api/news/story/${id}`, { action: "read" }).catch(() => undefined); }, [id]);

  const act = async (action: string) => {
    const r = await post<{ ok?: boolean; message?: string }>(`/api/news/story/${id}`, { action }).catch((e) => ({ message: e instanceof Error ? e.message : String(e) }));
    if (r.message) setNote({ id, text: r.message });
    reload(); onChanged?.();
  };
  const askWhy = async () => {
    setWhy({ id, text: null, busy: true });
    const r = await post<{ text: string | null; reason?: string }>(`/api/news/story/${id}`, { action: "why" }).catch((e) => ({ text: null, reason: e instanceof Error ? e.message : String(e) }));
    setWhy({ id, text: r.text, busy: false, reason: r.reason });
  };

  if (error && !s) return <div className="p-6 text-[12px] text-neg">{error}</div>;
  if (!s || s.id !== id) return <div className="space-y-3 p-6">{[0, 1, 2, 3].map((i) => <div key={i} className="shimmer h-5 rounded" style={{ width: `${90 - i * 12}%` }} />)}</div>;

  const personal = s.why ?? (why.id === id ? why.text : null);
  const network = s.reasons.some((r) => r.startsWith("In your network"));
  const lead = s.items.find((i) => i.kind !== "filing") ?? s.items[0];
  return (
    <div className={mode === "page" ? "mx-auto max-w-[760px] px-5 py-8" : "px-5 pb-10 pt-4"}>
      <div className="flex items-center justify-between gap-2">
        <div className="nr-kicker flex items-center gap-1.5"><span style={{ color: hueOf(s.tags) }}>{s.filing ? s.filing.form : s.categoryLabel}</span><span className="text-faint">·</span><span className="normal-case tracking-normal">{now ? ago(s.firstSeenAt, now) : ""}</span><span className="text-faint">·</span><span className="normal-case tracking-normal">{s.sourceCount} source{s.sourceCount === 1 ? "" : "s"}</span></div>
        <div className="flex items-center gap-0.5">
          {onStep && <><button type="button" onClick={() => onStep(-1)} className="rounded-md p-1.5 text-muted hover:bg-elevated hover:text-fg max-md:p-2.5" aria-label="Previous story"><ArrowLeft className="h-4 w-4" /></button><button type="button" onClick={() => onStep(1)} className="rounded-md p-1.5 text-muted hover:bg-elevated hover:text-fg max-md:p-2.5" aria-label="Next story"><ArrowRight className="h-4 w-4" /></button></>}
          {mode === "peek" && <Link href={`/app/news/story/${s.id}`} className="rounded-md p-1.5 text-muted hover:bg-elevated hover:text-fg max-md:p-2.5" aria-label="Open full page" title="Open full page"><Maximize2 className="h-4 w-4" /></Link>}
          {onClose && <button type="button" onClick={onClose} className="rounded-md p-1.5 text-muted hover:bg-elevated hover:text-fg max-md:p-2.5" aria-label="Close"><X className="h-4 w-4" /></button>}
        </div>
      </div>
      <h1 className={`nr-head mt-3 text-fg ${mode === "page" ? "nr-lead" : "nr-h2"}`} style={mode === "peek" ? { fontSize: "calc(var(--nr-h2) * 1.25)" } : undefined}>{s.headline}</h1>
      {s.reasons.filter((r) => !r.startsWith("For your desk")).length > 0 && <div className="mt-3 flex flex-wrap gap-1.5">{s.reasons.filter((r) => !r.startsWith("For your desk")).map((r) => <span key={r} className="rounded-full border border-accent/30 bg-accent-soft px-2 py-0.5 text-[11px] text-accent">{r}</span>)}</div>}

      <div className="nr-card mt-5 h-[150px] overflow-hidden p-4"><StoryArt story={s} sparks={sparks} height={118} size="lg" /></div>

      {s.summary?.bullets?.length ? (
        <Section title="What happened">
          <ul className="nr-body space-y-2 text-fg/90">{s.summary.bullets.map((b) => <li key={b} className="flex gap-2"><span className="mt-[0.55em] h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />{b}</li>)}</ul>
          {s.summary.fromText && <p className="mt-2 text-[10.5px] text-faint">Summarized from the open article and {s.sourceCount - 1} other source{s.sourceCount === 2 ? "" : "s"}.</p>}
        </Section>
      ) : null}

      {s.summary?.numbers?.length ? (
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">{s.summary.numbers.map((n) => <div key={n.label} className="nr-card p-3"><div className="text-[10.5px] text-muted">{n.label}</div><div className="num mt-0.5 text-[16px] font-semibold text-fg">{n.value}</div></div>)}</div>
      ) : null}

      <Section title="Why it matters">
        {s.summary?.why && <p className="nr-body text-fg/85">{s.summary.why}</p>}
        <AnimatePresence mode="wait">
          {personal ? (
            <motion.div key="mine" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mt-3 rounded-[var(--nr-radius)] border border-accent/30 bg-accent-soft/60 p-3">
              <div className="mb-1 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-accent"><Sparkles className="h-3.5 w-3.5" /> For you</div>
              <p className="nr-body text-fg/90">{personal}</p>
            </motion.div>
          ) : (
            <motion.div key="ask" className="mt-3">
              <button type="button" onClick={askWhy} disabled={why.busy} className="inline-flex items-center gap-1.5 rounded-full border border-accent/40 px-3 py-1 text-[11.5px] text-accent transition hover:bg-accent-soft disabled:opacity-60">
                <Sparkles className="h-3.5 w-3.5" /> {why.busy ? "Thinking about your desk…" : "Why it matters to you"}
              </button>
              {why.id === id && why.reason && <p className="mt-2 text-[11px] text-muted">{why.reason}</p>}
            </motion.div>
          )}
        </AnimatePresence>
        {s.summary?.watch && <p className="nr-body mt-3 text-muted"><b className="text-fg">What to watch. </b>{s.summary.watch}</p>}
      </Section>

      {s.deal && (
        <Section title="Deal terms">
          <div className="nr-card grid gap-3 p-4 sm:grid-cols-2">
            <div><div className="text-[10.5px] text-muted">{s.deal.kind.replace("_", " ")}</div><div className="mt-0.5 text-[13px] text-fg">{[s.deal.acquirer, s.deal.target].filter(Boolean).join(" → ")}</div></div>
            <div><div className="text-[10.5px] text-muted">Value</div><div className="num mt-0.5 text-[15px] font-semibold text-fg">{fmtUsd(s.deal.valueUsd)}{s.deal.perShare ? <span className="text-[12px] font-normal text-muted"> · ${s.deal.perShare.toFixed(2)}/share</span> : null}</div></div>
            {s.deal.premium !== null && <div><div className="text-[10.5px] text-muted">Premium to unaffected close</div><div className="num mt-0.5 text-[15px] font-semibold text-pos">{fmtPct(s.deal.premium, 1)}</div></div>}
            {(s.deal.evEbitda || s.deal.evRevenue) && <div><div className="text-[10.5px] text-muted">Implied multiples (from SEC figures)</div><div className="num mt-0.5 text-[15px] font-semibold text-fg">{[s.deal.evEbitda ? `${s.deal.evEbitda.toFixed(1)}x EBITDA` : "", s.deal.evRevenue ? `${s.deal.evRevenue.toFixed(1)}x revenue` : ""].filter(Boolean).join(" · ")}</div></div>}
            {s.deal.round && <div><div className="text-[10.5px] text-muted">Round</div><div className="mt-0.5 text-[13px] text-fg">{s.deal.round}</div></div>}
            {s.deal.investors.length > 0 && <div className="sm:col-span-2"><div className="text-[10.5px] text-muted">Investors</div><div className="mt-0.5 text-[12.5px] text-fg">{s.deal.investors.join(", ")}</div></div>}
            {s.deal.advisors.length > 0 && <div className="sm:col-span-2"><div className="text-[10.5px] text-muted">Advisors</div><div className="mt-1 flex flex-wrap gap-1.5">{s.deal.advisors.map((a) => <span key={`${a.firm}-${a.side}`} className="rounded-[4px] bg-elevated px-2 py-0.5 text-[11px] text-fg">{a.firm} <span className="text-muted">{a.role}, {a.side}</span></span>)}</div></div>}
          </div>
          {edge && <DealMap storyId={id} />}
        </Section>
      )}

      {s.entities.length > 0 && (
        <Section title="In this story">
          <div className="flex flex-wrap gap-1.5">{s.entities.map((e) => e.ticker
            ? <Link key={e.name} href={`/app/terminal?ticker=${e.ticker}&fn=DES`} className="num rounded-[4px] border border-line px-2 py-0.5 text-[11.5px] text-fg hover:border-accent/50 hover:text-accent">{e.ticker} <span className="font-sans text-muted">{e.name}</span></Link>
            : <span key={e.name} className="rounded-[4px] bg-elevated px-2 py-0.5 text-[11.5px] text-muted">{e.name}</span>)}</div>
        </Section>
      )}

      <Section title={`Sources (${s.items.length})`}>
        <ol className="space-y-2">{s.items.map((i) => (
          <li key={`${i.url}-${i.at}`} className="nr-card p-3">
            <div className="flex items-center justify-between gap-2 text-[11px] text-muted"><span className="font-semibold text-fg">{i.source}{i.via === "research" && <span className="ml-1.5 rounded-full bg-chart-emphasis/15 px-1.5 text-[9.5px] font-normal text-chart-emphasis">found by research</span>}</span><span>{now ? ago(i.at, now) : ""}</span></div>
            <a href={i.url} target="_blank" rel="noopener noreferrer" className="mt-1 flex items-start gap-1.5 text-[12.5px] leading-snug text-fg hover:text-accent">{i.title}<ExternalLink className="mt-0.5 h-3 w-3 shrink-0 text-muted" /></a>
            {i.snippet && i.kind !== "filing" && <p className="mt-1 line-clamp-2 text-[11.5px] text-muted">{i.snippet}</p>}
            {i.kind === "filing" && <p className="mt-1 text-[11.5px] text-muted">{i.snippet}</p>}
          </li>
        ))}</ol>
      </Section>

      <div className="sticky bottom-0 mt-6 flex flex-wrap items-center gap-2 border-t border-line bg-bg/85 py-3 backdrop-blur">
        {lead && <a href={lead.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-full bg-fg px-3 py-1.5 text-[12px] text-bg hover:opacity-90"><ExternalLink className="h-3.5 w-3.5" /> Read at {lead.source}</a>}
        <button type="button" onClick={() => act(s.saved ? "unsave" : "save")} className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-[12px] text-fg hover:border-accent/50">{s.saved ? <BookmarkCheck className="h-3.5 w-3.5 text-accent" /> : <Bookmark className="h-3.5 w-3.5" />}{s.saved ? "Saved" : "Save"}</button>
        {network && <button type="button" onClick={() => act("reach-out")} className="inline-flex items-center gap-1.5 rounded-full border border-accent/40 px-3 py-1.5 text-[12px] text-accent hover:bg-accent-soft"><Network className="h-3.5 w-3.5" /> Reason to reach out</button>}
        <Link href={`/app/terminal?fn=AI&ticker=${s.tickers[0] ?? ""}`} className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-[12px] text-fg hover:border-accent/50"><Sparkles className="h-3.5 w-3.5" /> Ask AI</Link>
        <button type="button" onClick={() => { void act("hide"); onClose?.(); }} className="ml-auto inline-flex items-center gap-1.5 rounded-full px-2 py-1.5 text-[11.5px] text-muted hover:text-fg"><EyeOff className="h-3.5 w-3.5" /> Hide</button>
      </div>
      {note?.id === id && <p className="mt-2 text-[11.5px] text-muted">{note.text}</p>}

      {s.related.length > 0 && (
        <Section title="Related">
          <div className="space-y-1">{s.related.map((r) => <Link key={r.id} href={`/app/news/story/${r.id}`} className="block rounded-md px-2 py-1.5 text-[12.5px] text-fg hover:bg-elevated"><span className="text-muted">{now ? ago(r.updatedAt, now) : ""} · </span>{r.headline}</Link>)}</div>
        </Section>
      )}
    </div>
  );
}

/**
 * The side peek: slides in over the right of the feed; Esc closes, arrows step through stories. On a
 * phone it takes the whole screen (over the tab bar, clear of the notch) and a swipe to the right closes it.
 */
export function StoryPeek({ id, onClose, onStep, onChanged }: { id: number | null; onClose: () => void; onStep: (dir: 1 | -1) => void; onChanged?: () => void }) {
  const motionLevel = useMotionLevel();
  const coarse = useCoarsePointer();
  useEffect(() => {
    if (id === null) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input, textarea, select")) return;
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight" || e.key === "j") onStep(1);
      else if (e.key === "ArrowLeft" || e.key === "k") onStep(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [id, onClose, onStep]);
  const spring = motionLevel === "rich" ? { type: "spring" as const, stiffness: 320, damping: 34 } : { duration: motionLevel === "off" ? 0 : 0.18 };
  return (
    <AnimatePresence>
      {id !== null && (
        <>
          <motion.button key="scrim" type="button" aria-label="Close story" className="fixed inset-0 top-10 z-40 bg-black/25 backdrop-blur-[1px] max-md:top-0 max-md:z-[60]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.aside key="peek" role="dialog" aria-modal="true" aria-label="Story" className="nr-peek scroll-touch fixed bottom-0 right-0 top-10 z-50 w-[min(600px,94vw)] overflow-y-auto border-l border-line bg-bg shadow-2xl max-md:top-0 max-md:z-[61] max-md:w-full max-md:border-l-0 max-md:pb-safe max-md:pt-safe"
            initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }} transition={spring}
            drag="x" dragListener={coarse} dragConstraints={{ left: 0, right: 0 }} dragElastic={{ left: 0, right: 0.6 }} dragDirectionLock style={{ touchAction: "pan-y" }}
            onDragEnd={(_, info) => { if (info.offset.x > 110 || info.velocity.x > 600) onClose(); }}>
            <StoryBody key={id} id={id} mode="peek" onClose={onClose} onStep={onStep} onChanged={onChanged} />
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
