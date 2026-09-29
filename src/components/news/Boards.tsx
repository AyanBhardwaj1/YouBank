"use client";

/**
 * The Newsroom's boards: the morning brief, the market watch (numbers tick when they change, a tape
 * scrolls in the Terminal and Brief looks), the calendar, the deal tracker with advisor league tables,
 * and the tech radar (sector radars are in Radar.tsx).
 */
import { motion } from "motion/react";
import { ArrowUpRight, CalendarDays, Flame, GitFork, MessageSquare, Star, ThumbsUp } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Brief } from "@/lib/news/brief";
import type { CalEvent, WatchRow } from "@/lib/news/calendar";
import type { LeagueRow } from "@/lib/news/deals";
import type { StoryCard as Story } from "@/lib/news/views";
import { fmtPct, fmtUsd, useMotionLevel, type Spark } from "./client";
import { Sparkline } from "./DataArt";
import { StoryCard } from "./StoryCard";

export type BriefData = { brief: Brief; forYou: Story[]; cards: Record<number, Story> };
export type DealsData = { deals: (Story["deal"] & { id: number; clusterId: number; headline: string; announcedAt: string; sector: string; sourceUrl: string })[]; league: { financial: LeagueRow[]; legal: LeagueRow[] } };
export type RadarItem = { id: number; title: string; snippet: string; url: string; source: string; at: string; meta: Record<string, unknown>; clusterId: number | null };
export type RadarData = { papers: RadarItem[]; repos: RadarItem[]; models: RadarItem[]; launches: RadarItem[] };

/** A number that counts to its new value when it changes (rich motion only). */
export function Ticking({ value, format }: { value: number | null; format: (v: number) => string }) {
  const level = useMotionLevel();
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = from.current;
    from.current = value;
    if (value === null || start === null || level !== "rich" || start === value) { queueMicrotask(() => setShown(value)); return; }
    let raf = 0;
    const t0 = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / 700), e = 1 - Math.pow(1 - k, 3);
      setShown(start + (value - start) * e);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, level]);
  return <>{shown === null ? "—" : format(shown)}</>;
}

const fmtLast = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: v >= 1000 ? 0 : 2, minimumFractionDigits: v >= 1000 ? 0 : 2 });

export function MarketWatch({ rows, dense = false }: { rows: WatchRow[]; dense?: boolean }) {
  if (!rows.length) return <p className="text-[11.5px] text-muted">Market data is loading or unavailable.</p>;
  return (
    <div className={dense ? "divide-y divide-line" : "grid gap-2"}>
      {rows.map((r) => (
        <div key={r.symbol} className={`grid grid-cols-[1fr_auto_auto] items-center gap-3 ${dense ? "py-1.5" : ""}`}>
          <div className="min-w-0">
            <div className="truncate text-[12px] text-fg">{r.label}</div>
            {r.via && <div className="text-[10px] text-faint">via {r.via}</div>}
          </div>
          <div className="h-6 w-16">{r.spark.length > 1 && <Sparkline closes={r.spark} height={24} fill={false} strokeWidth={1.25} />}</div>
          <div className="num w-[92px] text-right text-[12px]">
            <div className="text-fg"><Ticking value={r.last} format={fmtLast} /></div>
            <div className={(r.change ?? 0) >= 0 ? "text-pos" : "text-neg"}>{fmtPct(r.change, 2)}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

/** A scrolling strip of the market watch (static when motion is off). */
export function TickerTape({ rows }: { rows: WatchRow[] }) {
  const level = useMotionLevel();
  if (!rows.length) return null;
  const item = (r: WatchRow, k: string) => (
    <span key={k} className="num inline-flex items-center gap-1.5 px-4 text-[11.5px]">
      <span className="text-muted">{r.label}</span><span className="text-fg">{r.last === null ? "—" : fmtLast(r.last)}</span>
      <span className={(r.change ?? 0) >= 0 ? "text-pos" : "text-neg"}>{(r.change ?? 0) >= 0 ? "▲" : "▼"} {fmtPct(r.change, 2).replace(/^[+-]/, "")}</span>
    </span>
  );
  return (
    <div className="relative overflow-hidden border-y border-line bg-elevated/40 py-1.5" aria-label="Market watch">
      {level === "rich"
        ? <div className="tape-track flex w-max whitespace-nowrap">{rows.map((r) => item(r, `a${r.symbol}`))}{rows.map((r) => item(r, `b${r.symbol}`))}</div>
        : <div className="flex flex-wrap whitespace-nowrap">{rows.map((r) => item(r, r.symbol))}</div>}
    </div>
  );
}

export function CalendarList({ events }: { events: CalEvent[] }) {
  if (!events.length) return <p className="text-[11.5px] text-muted">Nothing scheduled for your desk this week.</p>;
  return (
    <ul className="space-y-1.5">
      {events.map((e) => (
        <li key={`${e.at}-${e.label}`} className="flex items-start gap-3 text-[12px]">
          <span className="num w-[86px] shrink-0 text-muted">{new Date(e.at).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "America/New_York" })}{e.kind === "data" ? ` ${new Date(e.at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" })}` : ""}</span>
          <span className="text-fg">{e.label}{e.estimated && <span className="text-muted"> (est.)</span>}</span>
        </li>
      ))}
    </ul>
  );
}

/** The morning brief: title, opener, "for you", then the day's picks with why each matters. */
export function BriefBlock({ data, sparks, now, onOpen, onSave, compact = false }: { data: BriefData; sparks: Map<string, Spark | null>; now: number; onOpen: (s: Story) => void; onSave: (s: Story) => void; compact?: boolean }) {
  const b = data.brief;
  const dateLabel = new Date(`${b.slot}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
  const items = compact ? b.items.slice(0, 4) : b.items;
  return (
    <div>
      <div className="nr-kicker">{b.deskLabel} brief · {dateLabel}</div>
      <h2 className="nr-head nr-lead mt-2 text-fg">{b.title}</h2>
      {b.intro && <p className="nr-body mt-3 max-w-[70ch] text-fg/85">{b.intro}</p>}
      {data.forYou.length > 0 && (
        <div className="mt-5 rounded-[var(--nr-radius)] border border-accent/25 bg-accent-soft/40 p-3">
          <div className="nr-kicker mb-1 text-accent">For you</div>
          <div className="divide-y divide-line/70">{data.forYou.map((s) => <StoryCard key={s.id} story={s} variant="compact" sparks={sparks} now={now} onOpen={onOpen} />)}</div>
        </div>
      )}
      <div className="mt-3 divide-y divide-line">
        {items.map((it, i) => {
          const card = data.cards[it.clusterId];
          return card
            ? <StoryCard key={it.clusterId} story={card} variant="brief" index={i} sparks={sparks} now={now} onOpen={onOpen} onSave={onSave} lines={it.lines} why={it.why} />
            : <div key={it.clusterId} className="py-4"><div className="nr-head nr-h2 text-fg">{it.headline}</div><p className="nr-body mt-1 text-fg/80">{it.lines.join(" ")}</p></div>;
        })}
      </div>
      {!b.model && <p className="mt-2 text-[10.5px] text-faint">Written from the stories&apos; own summaries (the AI brief is paused or unavailable).</p>}
    </div>
  );
}

export function DealTracker({ data, onOpenCluster, limit }: { data: DealsData; onOpenCluster: (id: number) => void; limit?: number }) {
  const rows = limit ? data.deals.slice(0, limit) : data.deals;
  if (!rows.length) return <p className="text-[11.5px] text-muted">No deals parsed yet. Announcements appear here as the Newsroom reads them.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11.5px]">
        <thead><tr className="text-left text-[10px] uppercase tracking-wider text-muted"><th className="py-1.5 pr-3 font-medium">Date</th><th className="pr-3 font-medium">Deal</th><th className="pr-3 font-medium">Type</th><th className="pr-3 text-right font-medium">Value</th><th className="pr-3 text-right font-medium">Premium</th><th className="text-right font-medium">EV/EBITDA</th></tr></thead>
        <tbody>{rows.map((d) => (
          <tr key={d.id} onClick={() => onOpenCluster(d.clusterId)} className="cursor-pointer border-t border-line transition hover:bg-elevated/60">
            <td className="whitespace-nowrap py-1.5 pr-3 text-muted">{new Date(d.announcedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</td>
            <td className="max-w-[340px] pr-3 font-sans text-fg"><span className="line-clamp-1">{[d.acquirer, d.target].filter(Boolean).join(" → ") || d.headline}</span></td>
            <td className="whitespace-nowrap pr-3 font-sans text-muted">{d.kind.replace("_", " ")}{d.round ? ` · ${d.round}` : ""}</td>
            <td className="pr-3 text-right text-fg">{fmtUsd(d.valueUsd)}</td>
            <td className={`pr-3 text-right ${d.premium !== null ? "text-pos" : "text-faint"}`}>{d.premium !== null ? fmtPct(d.premium, 0) : "—"}</td>
            <td className="text-right text-fg">{d.evEbitda ? `${d.evEbitda.toFixed(1)}x` : "—"}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

export function LeagueTable({ rows, title }: { rows: LeagueRow[]; title: string }) {
  return (
    <div>
      <div className="nr-kicker mb-2">{title}</div>
      {rows.length === 0 ? <p className="text-[11.5px] text-muted">Advisors appear as announcements name them.</p> : (
        <ol className="space-y-1">{rows.slice(0, 10).map((r, i) => (
          <li key={r.firm} className="grid grid-cols-[18px_1fr_auto_auto] items-center gap-2 text-[12px]">
            <span className="num text-muted">{i + 1}</span><span className="truncate text-fg">{r.firm}</span><span className="num text-muted">{r.deals} deal{r.deals === 1 ? "" : "s"}</span><span className="num w-16 text-right text-fg">{r.valueUsd ? fmtUsd(r.valueUsd) : "—"}</span>
          </li>
        ))}</ol>
      )}
    </div>
  );
}

function RadarList({ title, icon, items, metric }: { title: string; icon: React.ReactNode; items: RadarItem[]; metric: (m: Record<string, unknown>) => React.ReactNode }) {
  const level = useMotionLevel();
  return (
    <div className="nr-card p-[var(--nr-pad)]">
      <div className="nr-kicker mb-2 flex items-center gap-1.5">{icon}{title}</div>
      {items.length === 0 ? <p className="text-[11.5px] text-muted">Nothing yet this week.</p> : (
        <ol className="space-y-2.5">{items.map((it, i) => (
          <motion.li key={it.id} initial={level === "rich" ? { opacity: 0, x: -6 } : false} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.03 }}>
            <a href={it.url} target="_blank" rel="noopener noreferrer" className="group block">
              <div className="flex items-start justify-between gap-2"><span className="text-[12.5px] leading-snug text-fg group-hover:text-accent">{it.title}</span><ArrowUpRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-faint group-hover:text-accent" /></div>
              <div className="mt-0.5 flex items-center gap-2 text-[10.5px] text-muted">{metric(it.meta)}</div>
            </a>
          </motion.li>
        ))}</ol>
      )}
    </div>
  );
}

export function RadarBoard({ data }: { data: RadarData }) {
  const n = (x: unknown) => Number(x ?? 0).toLocaleString("en-US");
  return (
    <div className="grid gap-[var(--nr-gap)] md:grid-cols-2 2xl:grid-cols-4">
      <RadarList title="Papers researchers upvoted" icon={<ThumbsUp className="h-3.5 w-3.5" />} items={data.papers} metric={(m) => <><span className="num">{n(m.upvotes)} upvotes</span>{Array.isArray(m.keywords) && (m.keywords as string[]).length > 0 && <span className="truncate">{(m.keywords as string[]).slice(0, 3).join(", ")}</span>}</>} />
      <RadarList title="Repositories rising" icon={<GitFork className="h-3.5 w-3.5" />} items={data.repos} metric={(m) => <><span className="num inline-flex items-center gap-0.5"><Star className="h-3 w-3" />{n(m.stars)}</span>{m.language ? <span>{String(m.language)}</span> : null}</>} />
      <RadarList title="Trending models" icon={<Flame className="h-3.5 w-3.5" />} items={data.models} metric={(m) => <><span className="num">{n(m.likes)} likes</span>{m.task ? <span>{String(m.task)}</span> : null}</>} />
      <RadarList title="Launches the community lifted" icon={<MessageSquare className="h-3.5 w-3.5" />} items={data.launches} metric={(m) => <><span className="num">{n(m.points)} points</span><span className="num">{n(m.comments)} comments</span></>} />
    </div>
  );
}

export const CalendarIcon = CalendarDays;
