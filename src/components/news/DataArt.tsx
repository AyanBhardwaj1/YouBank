"use client";

/**
 * Data art: every card's visual is drawn from the story's own data rather than a licensed photo. A
 * company's thirty-day price line (drawn in when it appears), a deal-size bar on a log scale, a filing
 * stamp, a research paper's upvotes, or a monogram on its sector's colour. Always on-brand, always
 * informative, and nothing to license.
 */
import { useId } from "react";
import type { StoryCard } from "@/lib/news/views";
import { fmtPct, fmtUsd, useMotionLevel, type Spark } from "./client";

export const SECTOR_HUE: Record<string, string> = {
  tech: "#6d6af7", healthcare: "#14b8a6", energy: "#f59e0b", financials: "#0ea5e9", consumer: "#f43f5e", industrials: "#64748b", media: "#a855f7", realestate: "#10b981",
};
export const sectorOf = (tags: string[]) => tags.find((t) => t in SECTOR_HUE) ?? null;
export const hueOf = (tags: string[]) => SECTOR_HUE[sectorOf(tags) ?? ""] ?? "var(--accent)";

export function Sparkline({ closes, width = 160, height = 48, strokeWidth = 1.75, fill = true, className = "" }: { closes: number[]; width?: number; height?: number; strokeWidth?: number; fill?: boolean; className?: string }) {
  const id = useId().replace(/:/g, "");
  const motion = useMotionLevel();
  if (closes.length < 2) return null;
  const min = Math.min(...closes), max = Math.max(...closes), span = max - min || 1;
  const pts = closes.map((c, i) => [(i / (closes.length - 1)) * width, height - 3 - ((c - min) / span) * (height - 6)] as const);
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const up = closes[closes.length - 1] >= closes[0];
  const color = up ? "var(--pos)" : "var(--neg)";
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} preserveAspectRatio="none" className={className} aria-hidden>
      <defs>
        <linearGradient id={`g${id}`} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity="0.28" /><stop offset="100%" stopColor={color} stopOpacity="0" /></linearGradient>
      </defs>
      {fill && <path d={`${d} L${width},${height} L0,${height} Z`} fill={`url(#g${id})`} className={motion === "rich" ? "fade-in" : ""} />}
      <path d={d} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" className={motion === "rich" ? "draw" : ""} />
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="2.6" fill={color} />
    </svg>
  );
}

/** A deal's size against a log scale from $10M to $100B, with its value and premium. */
export function DealBar({ valueUsd, premium, label }: { valueUsd: number | null; premium?: number | null; label?: string }) {
  const motion = useMotionLevel();
  const share = valueUsd ? Math.max(0.04, Math.min(1, (Math.log10(valueUsd) - 7) / 4)) : 0.08;
  return (
    <div className="flex h-full flex-col justify-end gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="num text-[20px] font-semibold tracking-tight text-fg">{fmtUsd(valueUsd)}</span>
        {premium !== null && premium !== undefined && <span className="num text-[11px] text-pos">{fmtPct(premium, 0)} premium</span>}
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-line">
        <div className={`h-full rounded-full bg-accent ${motion === "rich" ? "grow-x" : ""}`} style={{ width: `${share * 100}%` }} />
      </div>
      {label && <span className="text-[10.5px] text-muted">{label}</span>}
    </div>
  );
}

/** "AMD" stays AMD, "World Labs" is WL, "Nvidia" is NV. */
export function monogramOf(name: string): string {
  const words = name.replace(/[^A-Za-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 0 && !/^(the|of|and|to|for|a|in|on|inc|corp|co|ltd|llc|plc)$/i.test(w));
  if (!words.length) return "N";
  if (words.length === 1 || /^[A-Z0-9]{2,4}$/.test(words[0])) return /^[A-Z0-9]{2,4}$/.test(words[0]) ? words[0] : words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

export function Monogram({ name, tags, size = 44 }: { name: string; tags: string[]; size?: number }) {
  const initials = monogramOf(name);
  const hue = hueOf(tags);
  return (
    <div className="grid shrink-0 place-items-center font-semibold uppercase" style={{ width: size, height: size, borderRadius: "calc(var(--nr-radius, 12px) * 0.6 + 4px)", background: `color-mix(in srgb, ${hue} 18%, transparent)`, color: hue, fontSize: size * (initials.length > 2 ? 0.3 : 0.36), letterSpacing: "-0.02em" }} aria-hidden>
      {initials}
    </div>
  );
}

/** The SEC form and its item, stamped. */
export function FilingStamp({ form, items }: { form: string; items: string[] }) {
  return (
    <div className="inline-flex flex-col items-start rounded-[4px] border border-dashed border-line-strong px-2 py-1 font-mono text-[10.5px] leading-tight text-muted">
      <span className="text-[12px] font-semibold text-fg">{form}</span>
      {items.length > 0 && <span>Item {items.slice(0, 3).join(" · ")}</span>}
    </div>
  );
}

function MetricMeter({ label, value, max }: { label: string; value: number; max: number }) {
  const motion = useMotionLevel();
  return (
    <div className="flex h-full flex-col justify-end gap-1">
      <span className="num text-[18px] font-semibold text-fg">{value.toLocaleString("en-US")}</span>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-line"><div className={`h-full rounded-full bg-info ${motion === "rich" ? "grow-x" : ""}`} style={{ width: `${Math.min(100, (value / max) * 100)}%` }} /></div>
      <span className="text-[10.5px] text-muted">{label}</span>
    </div>
  );
}

/**
 * The best visual for a story: its company's price line, else its deal, else its filing, else a
 * monogram. `size` "lg" is the magazine lead's full composition.
 */
export function StoryArt({ story, sparks, height = 64, size = "md" }: { story: StoryCard; sparks: Map<string, Spark | null>; height?: number; size?: "sm" | "md" | "lg" }) {
  const ticker = story.tickers.find((t) => sparks.get(t)?.closes?.length);
  const spark = ticker ? sparks.get(ticker)! : null;
  const hue = hueOf(story.tags);
  if (spark) {
    return (
      <div className="relative flex h-full w-full flex-col justify-end overflow-hidden" style={{ minHeight: height }}>
        <div className="absolute inset-0 opacity-60" style={{ background: `radial-gradient(120% 90% at 100% 0%, color-mix(in srgb, ${hue} 16%, transparent), transparent 60%)` }} aria-hidden />
        <div className="relative flex items-baseline justify-between px-0.5">
          <span className="num text-[11px] font-semibold text-fg">{ticker}</span>
          <span className="num text-[11px]"><span className={(spark.change ?? 0) >= 0 ? "text-pos" : "text-neg"}>{fmtPct(spark.change, 1)}</span> <span className="text-muted">1d</span> · <span className={(spark.month ?? 0) >= 0 ? "text-pos" : "text-neg"}>{fmtPct(spark.month, 0)}</span> <span className="text-muted">30d</span></span>
        </div>
        <Sparkline closes={spark.closes} height={size === "lg" ? Math.max(height - 24, 60) : height - 18} strokeWidth={size === "lg" ? 2.25 : 1.6} />
      </div>
    );
  }
  if (story.deal && (story.deal.valueUsd || story.deal.premium)) {
    return <div className="h-full w-full" style={{ minHeight: height }}><DealBar valueUsd={story.deal.valueUsd} premium={story.deal.premium} label={[story.deal.kind.replace("_", " "), story.deal.evEbitda ? `${story.deal.evEbitda.toFixed(1)}x EBITDA` : ""].filter(Boolean).join(" · ")} /></div>;
  }
  if (story.filing) return <div className="flex h-full items-end" style={{ minHeight: height }}><FilingStamp form={story.filing.form} items={story.filing.items} /></div>;
  const m = (story as StoryCard & { meta?: Record<string, number> }).meta;
  if (m?.upvotes) return <MetricMeter label="researcher upvotes" value={m.upvotes} max={200} />;
  const name = story.names?.[0] ?? story.deal?.target ?? story.headline;
  if (size === "lg") {
    // A lead with nothing to chart: the company's initials large on its sector's colour, and how widely it is covered.
    const outlets = Math.max(1, story.sourceCount);
    return (
      <div className="relative flex h-full w-full flex-col justify-between overflow-hidden" style={{ minHeight: height }}>
        <div className="absolute inset-0" style={{ background: `radial-gradient(110% 90% at 100% 0%, color-mix(in srgb, ${hue} 24%, transparent), transparent 62%)` }} aria-hidden />
        <span className="nr-kicker relative" style={{ color: hue }}>{story.categoryLabel}</span>
        <span className="nr-head relative select-none leading-none" style={{ color: hue, fontSize: Math.min(132, height * 0.46), letterSpacing: "-0.04em" }} aria-hidden>{monogramOf(name)}</span>
        <div className="relative">
          <div className="flex gap-1" aria-hidden>{Array.from({ length: Math.min(outlets, 16) }, (_, i) => <span key={i} className="h-1.5 flex-1 rounded-full" style={{ background: hue, opacity: 0.35 + 0.65 * ((i + 1) / Math.min(outlets, 16)) }} />)}</div>
          <p className="num mt-1.5 text-[11px] text-muted">{outlets === 1 ? "One source so far" : `Covered by ${outlets} outlets`}</p>
        </div>
      </div>
    );
  }
  return (
    <div className="flex h-full items-end gap-3" style={{ minHeight: size === "sm" ? undefined : height }}>
      <Monogram name={name} tags={story.tags} size={size === "sm" ? 32 : 44} />
    </div>
  );
}
