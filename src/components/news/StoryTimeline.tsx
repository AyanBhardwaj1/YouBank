"use client";

/**
 * A story's timeline: earlier stories on the same companies, the first report, each outlet as it
 * joined, and filings, on a vertical rule that draws down as it scrolls into view. Times are relative
 * for the last week and dated before that. Earlier stories open in the reader (or their public page).
 */
import { motion } from "motion/react";
import type { TimelineEvent } from "@/lib/news/storyviz";
import { Icon } from "@/components/ui/Icon";
import { ago } from "./client";
import { useDrawIn } from "./StoryCharts";

const DOT: Record<TimelineEvent["kind"], string> = { first: "bg-accent", source: "bg-chart-1", filing: "bg-chart-emphasis", deal: "bg-pos", earlier: "bg-faint", update: "bg-chart-1" };

export function StoryTimeline({ events, now, onOpenCluster, hrefFor }: { events: TimelineEvent[]; now: number; onOpenCluster?: (id: number) => void; hrefFor?: (id: number) => string }) {
  const { ref, on, animate } = useDrawIn<HTMLOListElement>();
  if (!events.length) return null;
  const when = (iso: string) => (now && now - Date.parse(iso) < 7 * 86_400_000 ? ago(iso, now) : new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }));
  return (
    <ol ref={ref} className="relative ml-1.5">
      <motion.span aria-hidden className="absolute bottom-2 left-[3px] top-2 w-px origin-top bg-line-strong" initial={animate ? { scaleY: 0 } : false} animate={on ? { scaleY: 1 } : undefined} transition={{ duration: 0.9, ease: [0.2, 0.8, 0.2, 1] }} />
      {events.map((e, i) => (
        <motion.li key={`${e.kind}-${e.at}-${i}`} className="relative pb-3 pl-5 last:pb-0" initial={animate ? { opacity: 0, x: -6 } : false} animate={on ? { opacity: 1, x: 0 } : undefined} transition={{ delay: 0.15 + i * 0.05, duration: 0.3 }}>
          <span className={`absolute left-0 top-[5px] h-[7px] w-[7px] rounded-full ring-2 ring-bg ${DOT[e.kind]} ${e.kind === "first" ? "scale-125" : ""}`} />
          <div className="flex flex-wrap items-baseline gap-x-2 text-[11px]">
            <span className={e.kind === "first" ? "font-semibold text-accent" : e.kind === "filing" ? "font-semibold text-chart-emphasis" : "text-muted"}>{e.label}</span>
            <span className="num text-faint">{when(e.at)}</span>
          </div>
          {e.detail && (
            e.clusterId && (onOpenCluster || hrefFor)
              ? (hrefFor
                ? <a href={hrefFor(e.clusterId)} className="mt-0.5 block text-[12px] leading-snug text-fg hover:text-accent">{e.detail}</a>
                : <button type="button" onClick={() => onOpenCluster!(e.clusterId!)} className="mt-0.5 block text-left text-[12px] leading-snug text-fg hover:text-accent">{e.detail}</button>)
              : e.url
                ? <a href={e.url} target="_blank" rel="noopener noreferrer" className="group mt-0.5 inline-flex items-start gap-1 text-[12px] leading-snug text-fg/85 hover:text-accent">{e.detail}<Icon name="ArrowUpRight" className="mt-0.5 h-3 w-3 shrink-0 text-faint group-hover:text-accent" /></a>
                : <p className="mt-0.5 text-[12px] leading-snug text-fg/85">{e.detail}</p>
          )}
        </motion.li>
      ))}
    </ol>
  );
}
