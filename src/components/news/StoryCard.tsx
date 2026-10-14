"use client";

/**
 * One story, six ways: a wire row, a compact line, a rail card, a dashboard tile, the magazine lead,
 * and a brief item. Every variant takes its type, scale and surfaces from the look (globals.css .nr),
 * so the same card is a Bloomberg row, an FT lead, an Axios item or an Apple News tile.
 */
import { motion } from "motion/react";
import { Bookmark, BookmarkCheck, FileText, Sparkles, Users } from "lucide-react";
import { useState } from "react";
import type { StoryCard as Story } from "@/lib/news/views";
import { ago, fmtPct, useMotionLevel, type Spark } from "./client";
import { hueOf, StoryArt } from "./DataArt";

export type CardVariant = "row" | "compact" | "card" | "tile" | "lead" | "brief";
type Props = { story: Story; variant: CardVariant; sparks: Map<string, Spark | null>; now: number; fresh?: boolean; index?: number; onOpen: (s: Story) => void; onSave?: (s: Story) => void; lines?: string[]; why?: string };

export const sourceLine = (s: Story) => {
  const names = [...new Set(s.sources.map((x) => (x.kind === "filing" ? "SEC" : x.name)))];
  const shown = names.slice(0, 2).join(", ");
  return names.length > 2 || s.sourceCount > names.length ? `${shown} +${Math.max(s.sourceCount, names.length) - 2 > 0 ? Math.max(s.sourceCount, names.length) - 2 : 1}` : shown;
};

export function Kicker({ s, now }: { s: Story; now: number }) {
  return (
    <div className="nr-kicker flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
      <span style={{ color: hueOf(s.tags) }}>{s.filing ? `${s.filing.form}${s.filing.items[0] ? ` ${s.filing.items[0]}` : ""}` : s.categoryLabel}</span>
      <span className="text-faint">·</span>
      <span className="font-medium normal-case tracking-normal text-muted">{now ? ago(s.updatedAt, now) : ""}</span>
      <span className="text-faint">·</span>
      <span className="truncate font-medium normal-case tracking-normal text-muted">{sourceLine(s)}</span>
      {s.sources.some((x) => x.via === "research") && <span className="rounded-full bg-chart-emphasis/15 px-1.5 text-[9.5px] normal-case tracking-normal text-chart-emphasis" title="Found by AI research, checked against its page">research</span>}
    </div>
  );
}

export function Reasons({ reasons }: { reasons: string[] }) {
  const personal = reasons.filter((r) => !r.startsWith("For your desk"));
  if (!personal.length) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {personal.map((r) => (
        <span key={r} className="inline-flex items-center gap-1 rounded-full border border-accent/30 bg-accent-soft px-2 py-0.5 text-[10.5px] text-accent">
          {r.startsWith("In your network") ? <Users className="h-3 w-3" /> : <Sparkles className="h-3 w-3" />}{r}
        </span>
      ))}
    </div>
  );
}

export function Tickers({ s, sparks }: { s: Story; sparks: Map<string, Spark | null> }) {
  if (!s.tickers.length) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {s.tickers.slice(0, 4).map((t) => {
        const ch = sparks.get(t)?.change ?? null;
        return <span key={t} className="num inline-flex items-center gap-1 rounded-[4px] bg-elevated px-1.5 py-px text-[10.5px] text-fg">{t}{ch !== null && <span className={ch >= 0 ? "text-pos" : "text-neg"}>{fmtPct(ch, 1)}</span>}</span>;
      })}
    </div>
  );
}

export function SaveButton({ s, onSave }: { s: Story; onSave?: (s: Story) => void }) {
  if (!onSave) return null;
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); onSave(s); }} className="shrink-0 rounded-md p-1 text-muted transition hover:bg-elevated hover:text-accent" aria-label={s.saved ? "Remove from saved" : "Save story"} title={s.saved ? "Saved" : "Save"}>
      {s.saved ? <BookmarkCheck className="h-3.5 w-3.5 text-accent" /> : <Bookmark className="h-3.5 w-3.5" />}
    </button>
  );
}

export function StoryCard({ story: s, variant, sparks, now, fresh, index, onOpen, onSave, lines, why }: Props) {
  const motionLevel = useMotionLevel();
  const rich = motionLevel === "rich";
  const [flipped, setFlipped] = useState(false);
  const open = () => onOpen(s);
  const bullets = lines ?? s.summary?.bullets ?? [];
  const whyText = why ?? s.summary?.why ?? "";
  const enter = rich ? { initial: { opacity: 0, y: fresh ? -14 : 10 }, animate: { opacity: 1, y: 0 }, transition: { type: "spring" as const, stiffness: 380, damping: 32, delay: Math.min(index ?? 0, 12) * 0.03 } } : {};
  const hover = rich ? { whileHover: { y: -3 }, transition: { type: "spring" as const, stiffness: 420, damping: 30 } } : {};
  const read = s.read ? "opacity-70" : "";

  if (variant === "row") {
    return (
      <motion.article layout={rich ? "position" : false} {...enter} className={`nr-card group grid cursor-pointer grid-cols-[52px_1fr_auto] items-start gap-3 px-3 py-2 transition hover:bg-elevated/60 ${fresh ? "nr-flash" : ""} ${read}`} onClick={open}>
        <span className="num pt-0.5 text-[11px] text-muted">{now ? ago(s.updatedAt, now) : ""}</span>
        <div className="min-w-0">
          <button type="button" className="nr-head nr-h3 block w-full text-left text-fg group-hover:text-accent">{s.headline}</button>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted">
            <span style={{ color: hueOf(s.tags) }}>{s.filing ? s.filing.form : s.categoryLabel}</span><span className="truncate">{sourceLine(s)}</span>
            {s.reasons.filter((r) => !r.startsWith("For your desk")).slice(0, 1).map((r) => <span key={r} className="text-accent">{r}</span>)}
          </div>
        </div>
        <div className="flex items-center gap-1.5"><Tickers s={{ ...s, tickers: s.tickers.slice(0, 2) }} sparks={sparks} /><SaveButton s={s} onSave={onSave} /></div>
      </motion.article>
    );
  }

  if (variant === "compact") {
    return (
      <motion.article {...enter} className={`group cursor-pointer py-2 ${read}`} onClick={open}>
        <Kicker s={s} now={now} />
        <button type="button" className="nr-head nr-h3 mt-1 block text-left text-fg group-hover:text-accent">{s.headline}</button>
      </motion.article>
    );
  }

  if (variant === "brief") {
    return (
      <motion.article {...enter} className={`group relative cursor-pointer py-4 ${read}`} onClick={open}>
        <div className="flex gap-3">
          {index !== undefined && <span className="nr-head w-6 shrink-0 text-[22px] leading-none text-accent">{index + 1}</span>}
          <div className="min-w-0 flex-1">
            <Kicker s={s} now={now} />
            <button type="button" className="nr-head nr-h2 mt-1 block text-left text-fg group-hover:text-accent">{s.headline}</button>
            <div className="nr-body mt-1.5 space-y-1 text-fg/85">{bullets.slice(0, 2).map((b) => <p key={b}>{b}</p>)}</div>
            {whyText && <p className="nr-body mt-2 border-l-2 border-accent pl-3 text-fg/80"><b className="text-fg">Why it matters. </b>{whyText}</p>}
            <div className="mt-2 flex flex-wrap items-center gap-2"><Reasons reasons={s.reasons} /><Tickers s={s} sparks={sparks} /></div>
          </div>
          <SaveButton s={s} onSave={onSave} />
        </div>
      </motion.article>
    );
  }

  if (variant === "lead") {
    return (
      <motion.article {...enter} className={`group grid cursor-pointer gap-5 md:grid-cols-[1.25fr_1fr] ${read}`} onClick={open}>
        <div className="order-2 min-w-0 md:order-1">
          <Kicker s={s} now={now} />
          <button type="button" className="nr-head nr-lead mt-3 block text-left text-fg transition group-hover:text-accent">{s.headline}</button>
          <div className="nr-body mt-4 max-w-[62ch] space-y-2 text-fg/85">{bullets.slice(0, 3).map((b) => <p key={b}>{b}</p>)}</div>
          {whyText && <p className="nr-body mt-3 max-w-[62ch] italic text-muted">{whyText}</p>}
          <div className="mt-3 flex flex-wrap items-center gap-2"><Reasons reasons={s.reasons} /><Tickers s={s} sparks={sparks} /><SaveButton s={s} onSave={onSave} /></div>
        </div>
        <div className="nr-card order-1 flex h-[260px] items-stretch overflow-hidden p-4 md:order-2 md:mt-8 md:h-[320px] md:self-start">
          <StoryArt story={s} sparks={sparks} height={288} size="lg" />
        </div>
      </motion.article>
    );
  }

  if (variant === "tile") {
    return (
      <motion.article {...enter} {...hover} className={`nr-flip h-full ${read}`}>
        <div className={`nr-flip-inner relative h-full ${flipped ? "flipped" : ""}`}>
          <div className="nr-face nr-card flex h-full cursor-pointer flex-col gap-3 p-[var(--nr-pad)]" onClick={open}>
            <div className="h-[72px]"><StoryArt story={s} sparks={sparks} height={72} /></div>
            <Kicker s={s} now={now} />
            <button type="button" className="nr-head nr-h3 block text-left text-fg">{s.headline}</button>
            <div className="mt-auto flex items-center justify-between gap-2">
              <Reasons reasons={s.reasons.slice(0, 1)} />
              <div className="ml-auto flex items-center gap-1">
                {whyText && <button type="button" onClick={(e) => { e.stopPropagation(); setFlipped(true); }} className="rounded-full border border-line px-2 py-0.5 text-[10.5px] text-muted transition hover:border-accent/50 hover:text-accent">Why it matters</button>}
                <SaveButton s={s} onSave={onSave} />
              </div>
            </div>
          </div>
          <div className="nr-face nr-face-back nr-card absolute inset-0 flex cursor-pointer flex-col gap-2 p-[var(--nr-pad)]" onClick={() => setFlipped(false)} aria-hidden={!flipped}>
            <span className="nr-kicker text-accent">Why it matters</span>
            <p className="nr-body text-fg/90">{whyText}</p>
            <button type="button" tabIndex={flipped ? 0 : -1} onClick={(e) => { e.stopPropagation(); setFlipped(false); }} className="mt-auto self-start text-[10.5px] text-muted hover:text-accent">Flip back</button>
          </div>
        </div>
      </motion.article>
    );
  }

  // Rail card (hybrid).
  return (
    <motion.article {...enter} {...hover} className={`nr-card group flex h-full cursor-pointer flex-col gap-2.5 p-[var(--nr-pad)] ${fresh ? "nr-flash" : ""} ${read}`} onClick={open}>
      <div className="h-[58px]"><StoryArt story={s} sparks={sparks} height={58} /></div>
      <Kicker s={s} now={now} />
      <button type="button" className="nr-head nr-h3 block text-left text-fg group-hover:text-accent">{s.headline}</button>
      {bullets[0] && <p className="nr-body line-clamp-3 text-fg/75">{bullets[0]}</p>}
      <div className="mt-auto flex items-center justify-between gap-2"><Reasons reasons={s.reasons.slice(0, 1)} /><div className="ml-auto flex items-center">{s.filing && <FileText className="h-3.5 w-3.5 text-muted" aria-label="SEC filing" />}<SaveButton s={s} onSave={onSave} /></div></div>
    </motion.article>
  );
}
