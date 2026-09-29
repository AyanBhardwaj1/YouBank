"use client";

/**
 * The Newsroom inside the terminal: TOP (your desk's top stories, ranked for you), CN (news, filings and
 * deals about a company) and NI (news by topic: NI ENERGY, NI MA, NI private credit). Rows in the
 * Terminal look; a story opens inside the panel, with a way back.
 */
import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import type { Command } from "@/lib/functions";
import type { FeedView, StoryCard as Story } from "@/lib/news/views";
import { MotionContext, useApi, useNow, useSparks } from "@/components/news/client";
import { StoryCard } from "@/components/news/StoryCard";
import { StoryBody } from "@/components/news/StoryReader";

function Rows({ stories, loading, empty }: { stories: Story[]; loading: boolean; empty: string }) {
  const now = useNow();
  const sparks = useSparks(stories.slice(0, 30).flatMap((s) => s.tickers.slice(0, 1)));
  const [open, setOpen] = useState<number | null>(null);
  return (
    <MotionContext value="subtle">
      <div className="nr h-full overflow-y-auto" data-look="terminal" data-motion="subtle">
        {open !== null ? (
          <div>
            <button type="button" onClick={() => setOpen(null)} className="flex items-center gap-1 px-3 pt-2 font-mono text-[11px] text-muted hover:text-accent"><ArrowLeft className="h-3 w-3" /> Back to the list</button>
            <StoryBody id={open} mode="peek" />
          </div>
        ) : loading && !stories.length ? (
          <div className="space-y-1 p-3">{[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="shimmer h-7 rounded-sm" />)}</div>
        ) : !stories.length ? (
          <p className="p-4 font-mono text-[11.5px] text-muted">{empty}</p>
        ) : (
          <div>{stories.map((s, i) => <StoryCard key={s.id} story={s} variant="row" index={i} sparks={sparks} now={now} onOpen={(x) => setOpen(x.id)} />)}</div>
        )}
      </div>
    </MotionContext>
  );
}

export function TopScreen() {
  const { data, loading, error } = useApi<FeedView>("/api/news/feed?limit=80", 60_000);
  return <Rows stories={data?.stories ?? []} loading={loading} empty={error ?? "No stories for your desk yet. They arrive every ten minutes."} />;
}

export function CnScreen({ ticker }: { ticker: string; onRun?: (c: Command) => void }) {
  const { data, loading, error } = useApi<{ stories: Story[] }>(`/api/news/lookup?ticker=${encodeURIComponent(ticker)}&days=45`, 120_000);
  return <Rows stories={data?.stories ?? []} loading={loading} empty={error ?? `No news or filings about ${ticker} in the last 45 days.`} />;
}

export function NiScreen({ arg }: { arg?: string; onRun?: (c: Command) => void }) {
  const topic = (arg ?? "").trim();
  const { data, loading, error } = useApi<{ stories: Story[] }>(topic ? `/api/news/lookup?topic=${encodeURIComponent(topic)}` : null, 120_000);
  if (!topic) return <p className="p-4 font-mono text-[11.5px] text-muted">Give a topic: NI ENERGY, NI MA, NI IPO, NI private credit, or any words.</p>;
  return <Rows stories={data?.stories ?? []} loading={loading} empty={error ?? `Nothing on “${topic}” this week.`} />;
}

/** The few latest stories about a company, for DES. */
export function CompanyNewsStrip({ ticker, onRun }: { ticker: string; onRun?: (c: Command) => void }) {
  const { data } = useApi<{ stories: Story[] }>(`/api/news/lookup?ticker=${encodeURIComponent(ticker)}&days=30&limit=5`, 300_000);
  const now = useNow();
  const stories = data?.stories ?? [];
  if (!stories.length) return null;
  return (
    <section className="mt-3">
      <div className="mb-1 flex items-center justify-between"><h3 className="text-[10.5px] uppercase tracking-wider text-muted">Latest news</h3>{onRun && <button type="button" onClick={() => onRun({ ticker, fn: "CN", via: "click" })} className="text-[10.5px] text-muted hover:text-accent">CN for more →</button>}</div>
      <ul className="divide-y divide-line">{stories.slice(0, 5).map((s) => (
        <li key={s.id} className="flex items-baseline gap-2 py-1 text-[11.5px]">
          <span className="num w-10 shrink-0 text-muted">{now ? `${Math.max(1, Math.round((now - Date.parse(s.updatedAt)) / 3_600_000))}h` : ""}</span>
          <a href={`/app/news/story/${s.id}`} className="min-w-0 flex-1 truncate text-fg hover:text-accent">{s.headline}</a>
          <span className="shrink-0 text-[10.5px] text-muted">{s.filing ? s.filing.form : s.sources[0]?.name}</span>
        </li>
      ))}</ul>
    </section>
  );
}
