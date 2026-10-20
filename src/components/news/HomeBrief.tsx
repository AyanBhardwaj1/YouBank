"use client";

/** Today's brief on Home: the desk's title and opener, the top stories, and what is on your watchlist or in your network. */
import Link from "next/link";
import { Newspaper, Sparkles } from "lucide-react";
import { Suspense, use } from "react";
import type { BriefData } from "./Boards";
import { useApi } from "./client";

/** The brief the Home page started on the server (see app/app/page.tsx), streamed with the page. */
export type BriefSeed = Promise<{ data: BriefData; at: number } | null>;

/**
 * With `seed`, the brief arrives in the page's own HTML stream as soon as the server has it, instead of
 * after the page's JavaScript loads and asks for it; the skeleton shows until then. Without it (or if the
 * server could not make it), the brief is fetched from the browser as before. Either way it refreshes
 * every ten minutes.
 */
export function HomeBrief({ seed }: { seed?: BriefSeed }) {
  if (!seed) return <Brief />;
  return <Suspense fallback={<Frame />}><Seeded seed={seed} /></Suspense>;
}

function Seeded({ seed }: { seed: BriefSeed }) {
  const s = use(seed);
  return <Brief initial={s?.data} seededAt={s?.at} />;
}

function Frame({ label = "", children }: { label?: string; children?: React.ReactNode }) {
  return (
    <section className="panel overflow-hidden">
      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <h2 className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted"><Newspaper className="h-3.5 w-3.5 text-accent" /> Today&apos;s brief{label ? ` · ${label}` : ""}</h2>
        <Link href="/app/news" className="text-[11px] text-muted hover:text-fg">Newsroom →</Link>
      </div>
      {children ?? <div className="space-y-2 p-3">{[0, 1, 2].map((i) => <div key={i} className="shimmer h-4 rounded" style={{ width: `${88 - i * 14}%` }} />)}</div>}
    </section>
  );
}

function Brief({ initial, seededAt }: { initial?: BriefData; seededAt?: number }) {
  const { data, error } = useApi<BriefData>("/api/news/brief", 10 * 60_000, initial, seededAt);
  if (error && !data) return null;
  const b = data?.brief;
  if (!b) return <Frame />;
  return (
    <Frame label={b.deskLabel}>
      {!b.items.length ? (
        <p className="p-3 text-[12px] text-muted">The first brief for your desk is written once its stories are in, within the hour.</p>
      ) : (
        <div className="p-3">
          <h3 className="display text-[22px] leading-tight text-fg">{b.title}</h3>
          {b.intro && <p className="mt-1.5 max-w-[80ch] text-[12.5px] leading-relaxed text-fg/80">{b.intro}</p>}
          <ol className="mt-3 grid gap-x-6 gap-y-2 md:grid-cols-2">
            {b.items.slice(0, 6).map((it, i) => (
              <li key={it.clusterId}>
                <Link href={`/app/news?story=${it.clusterId}`} className="group flex gap-2">
                  <span className="num pt-px text-[11px] text-accent">{i + 1}</span>
                  <span className="text-[12.5px] leading-snug text-fg group-hover:text-accent">{it.headline}</span>
                </Link>
              </li>
            ))}
          </ol>
          {data.forYou.length > 0 && (
            <div className="mt-3 border-t border-line pt-2.5">
              <div className="mb-1 flex items-center gap-1 text-[10.5px] uppercase tracking-wider text-accent"><Sparkles className="h-3 w-3" /> For you</div>
              <ul className="space-y-1">{data.forYou.slice(0, 3).map((s) => <li key={s.id}><Link href={`/app/news?story=${s.id}`} className="text-[12px] text-fg hover:text-accent">{s.headline}</Link> <span className="text-[10.5px] text-muted">{s.reasons.filter((r) => !r.startsWith("For your desk"))[0]}</span></li>)}</ul>
            </div>
          )}
        </div>
      )}
    </Frame>
  );
}
