"use client";

/**
 * The signed-out Newsroom: a public story page and the public front (/news). Built only from what
 * src/lib/news/public.ts returns, which is public by construction (no user is ever passed in), so
 * nothing personal can appear here: no reasons, no "why it matters to you", no saved or followed state.
 * Every page ends in a plain invitation: the same story, ranked for your desk, with alerts and audio,
 * is what YouBank does once you sign in.
 */
import Link from "next/link";
import { motion } from "motion/react";
import type { PublicCard, PublicStory } from "@/lib/news/public";
import { figureBars } from "@/lib/news/storyviz";
import { Logo } from "@/components/brand/Logo";
import { ThemeMenu } from "@/components/theme/ThemeMenu";
import { Icon } from "@/components/ui/Icon";
import { ago, fmtPct, fmtUsd, MotionContext, useEffectiveMotion, type Spark } from "../client";
import { ArtThumb, hueOf } from "../DataArt";
import { RelationshipMap } from "../RelationshipMap";
import { ShareButtons } from "../StoryActions";
import { CoverageChart, DealChart, FigureBars, PriceReaction } from "../StoryCharts";
import { StoryTimeline } from "../StoryTimeline";

const NO_SPARKS = new Map<string, Spark | null>();

function Shell({ children }: { children: React.ReactNode }) {
  const level = useEffectiveMotion("rich");
  return (
    <MotionContext value={level}>
      <div className="nr min-h-screen" data-look="front" data-motion={level}>
        <header className="glass sticky top-0 z-40 border-b border-line bg-bg/85">
          <div className="mx-auto flex max-w-[1180px] items-center gap-3 px-4 py-2.5 sm:px-5">
            <Link href="/" className="flex items-center gap-2" aria-label="YouBank home"><Logo size={24} id="news-lock" /></Link>
            <Link href="/news" className="hidden text-[12px] font-semibold uppercase tracking-[0.14em] text-accent sm:inline">Newsroom</Link>
            <div className="ml-auto flex items-center gap-2">
              <ThemeMenu nameClass="hidden" />
              <Link href="/sign-in" className="ctl hidden px-3 py-1.5 text-[12.5px] text-muted hover:text-fg sm:inline-block">Sign in</Link>
              <Link href="/sign-in?next=/app/news" className="inline-flex items-center gap-1.5 rounded-full bg-accent px-3.5 py-1.5 text-[12.5px] font-semibold text-accent-fg hover:opacity-90">Get started free</Link>
            </div>
          </div>
        </header>
        {children}
        <footer className="border-t border-line">
          <div className="mx-auto max-w-[1180px] px-5 py-8 text-[11.5px] leading-relaxed text-muted">
            Headlines link to their publishers; summaries, charts and maps are YouBank&apos;s, from public sources. Not investment advice. <Link href="/" className="text-fg hover:text-accent">About YouBank</Link>
          </div>
        </footer>
      </div>
    </MotionContext>
  );
}

/** The invitation: what signing in adds to this story. */
function Cta({ id, big = false }: { id?: number; big?: boolean }) {
  const next = id ? `/app/news/story/${id}` : "/app/news";
  const points = [
    ["Target", "Why it matters to you", "Every story matched to your watchlist, your contacts and your pipeline."],
    ["BellPlus", "Follow developing stories", "An alert, and a push, the moment a story you follow moves."],
    ["Headphones", "Your briefing, read aloud", "A few minutes each morning with a chapter per story."],
    ["GalleryVerticalEnd", "Brief mode", "Swipe through the day, a 20-second card each."],
  ] as const;
  return (
    <section className={`relative overflow-hidden rounded-[var(--nr-radius)] border border-accent/30 ${big ? "p-6 sm:p-8" : "p-5"}`} style={{ background: "radial-gradient(120% 140% at 100% 0%, color-mix(in srgb, var(--accent) 16%, var(--panel)), var(--panel) 60%)" }}>
      <div className="nr-kicker">Read more on YouBank</div>
      <h2 className={`nr-head mt-2 text-fg ${big ? "text-[clamp(26px,3vw,38px)]" : "text-[22px]"}`}>The Newsroom, ranked for your desk</h2>
      <p className="mt-2 max-w-[60ch] text-[13px] leading-relaxed text-fg/75">About ninety free sources every ten minutes, one story per event, read for you: bankers, investors, operators and students each get their own desk. Free to start.</p>
      {big && (
        <ul className="mt-5 grid gap-3 sm:grid-cols-2">
          {points.map(([icon, title, text]) => (
            <li key={title} className="flex gap-2.5"><Icon name={icon} className="mt-0.5 h-4 w-4 shrink-0 text-accent" /><span><span className="block text-[13px] font-semibold text-fg">{title}</span><span className="block text-[12px] text-muted">{text}</span></span></li>
          ))}
        </ul>
      )}
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <Link href={`/sign-in?next=${encodeURIComponent(next)}`} className="inline-flex items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-[13px] font-semibold text-accent-fg hover:opacity-90">Sign up free <Icon name="ArrowRight" className="h-3.5 w-3.5" /></Link>
        {id && <Link href={`/sign-in?next=${encodeURIComponent(next)}`} className="rounded-full border border-line px-4 py-2 text-[13px] text-fg hover:border-accent/50">Open this story in YouBank</Link>}
      </div>
    </section>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="mt-10"><h2 className="nr-kicker mb-3">{title}</h2>{children}</section>;
}

/** The story's chart for its public page (the same choices as in the app). */
function Chart({ s, now }: { s: PublicStory; now: number }) {
  const bars = s.summary ? figureBars(s.summary.numbers) : [];
  const deal = s.deal && (s.deal.valueUsd || s.deal.premium !== null);
  if (!s.spark && !deal && bars.length < 2 && s.sources.length < 2) return <ArtThumb story={{ ...s, filing: s.filing, deal: s.deal }} sparks={NO_SPARKS} height={200} />;
  return (
    <div className="nr-card space-y-5 p-4 sm:p-5">
      {s.spark && <PriceReaction ticker={s.spark.ticker} closes={s.spark.closes} firstSeenAt={s.firstSeenAt} now={now} height={170} />}
      {deal && <DealChart valueUsd={s.deal!.valueUsd} premium={s.deal!.premium} evEbitda={s.deal!.evEbitda} label={s.deal!.kind.replace("_", " ")} />}
      {!deal && bars.length >= 2 && <FigureBars bars={bars} />}
      {!s.spark && !deal && bars.length < 2 && <CoverageChart sources={s.sources.map((x) => ({ name: x.name, at: x.at }))} />}
    </div>
  );
}

export function PublicStoryView({ s, url, now }: { s: PublicStory; url: string; now: number }) {
  const slugOf = new Map(s.related.map((r) => [r.id, r.slug]));
  const date = new Date(s.firstSeenAt).toLocaleString("en-US", { month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York", timeZoneName: "short" });
  return (
    <Shell>
      <main className="mx-auto max-w-[760px] px-4 pb-16 pt-8 sm:px-5 sm:pt-12">
        <Link href="/news" className="inline-flex items-center gap-1.5 text-[12px] text-muted hover:text-fg"><Icon name="ArrowLeft" className="h-3.5 w-3.5" />The Newsroom</Link>
        <div className="nr-kicker mt-5 flex flex-wrap items-center gap-x-2 gap-y-1"><span style={{ color: hueOf(s.tags) }}>{s.filing?.form || s.categoryLabel}</span><span className="text-faint">·</span><span className="font-medium normal-case tracking-normal text-muted">{date}</span><span className="text-faint">·</span><span className="font-medium normal-case tracking-normal text-muted">{s.sourceCount} source{s.sourceCount === 1 ? "" : "s"}</span></div>
        <motion.h1 initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="nr-head nr-lead mt-3 text-fg">{s.headline}</motion.h1>
        {s.tickers.length > 0 && <div className="mt-3 flex flex-wrap gap-1">{s.tickers.slice(0, 5).map((t) => <span key={t} className="num rounded-[4px] bg-elevated px-1.5 py-px text-[11px] text-fg">{t}{s.spark?.ticker === t && s.spark.change !== null ? <span className={s.spark.change >= 0 ? " text-pos" : " text-neg"}> {fmtPct(s.spark.change, 1)}</span> : null}</span>)}</div>}
        <div className="mt-4"><ShareButtons url={url} title={s.headline} /></div>
        <div className="mt-6"><Chart s={s} now={now} /></div>

        {s.summary?.bullets?.length ? (
          <Section title="What happened">
            <ul className="nr-body space-y-2.5 text-fg/90">{s.summary.bullets.map((b) => <li key={b} className="flex gap-2.5"><span className="mt-[0.6em] h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />{b}</li>)}</ul>
          </Section>
        ) : null}
        {s.summary?.numbers?.length ? <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3">{s.summary.numbers.map((n) => <div key={n.label} className="nr-card p-3"><div className="text-[10.5px] text-muted">{n.label}</div><div className="num mt-0.5 text-[16px] font-semibold text-fg">{n.value}</div></div>)}</div> : null}
        {s.summary?.why && (
          <Section title="Why it matters">
            <p className="nr-body text-fg/85">{s.summary.why}</p>
            {s.summary.watch && <p className="nr-body mt-3 text-muted"><b className="text-fg">What to watch. </b>{s.summary.watch}</p>}
          </Section>
        )}
        {s.deal && (
          <Section title="Deal terms">
            <div className="nr-card grid gap-3 p-4 sm:grid-cols-2">
              <div><div className="text-[10.5px] text-muted">{s.deal.kind.replace("_", " ")}</div><div className="mt-0.5 text-[13px] text-fg">{[s.deal.acquirer, s.deal.target].filter(Boolean).join(" → ")}</div></div>
              <div><div className="text-[10.5px] text-muted">Value</div><div className="num mt-0.5 text-[15px] font-semibold text-fg">{fmtUsd(s.deal.valueUsd)}{s.deal.perShare ? <span className="text-[12px] font-normal text-muted"> · ${s.deal.perShare.toFixed(2)}/share</span> : null}</div></div>
              {s.deal.premium !== null && <div><div className="text-[10.5px] text-muted">Premium to unaffected close</div><div className="num mt-0.5 text-[15px] font-semibold text-pos">{fmtPct(s.deal.premium, 1)}</div></div>}
              {s.deal.investors.length > 0 && <div className="sm:col-span-2"><div className="text-[10.5px] text-muted">Investors</div><div className="mt-0.5 text-[12.5px] text-fg">{s.deal.investors.join(", ")}</div></div>}
            </div>
          </Section>
        )}

        <div className="mt-10"><Cta id={s.id} /></div>

        {s.timeline.length > 1 && <Section title="Timeline"><StoryTimeline events={s.timeline} now={now} hrefFor={(id) => `/news/${slugOf.get(id) ?? id}`} /></Section>}
        {s.graph.nodes.length > 2 && <Section title="Who is involved"><RelationshipMap graph={s.graph} /></Section>}

        <Section title={`Sources (${s.sources.length})`}>
          <ol className="space-y-2">{s.sources.map((i) => (
            <li key={`${i.url}-${i.at}`} className="nr-card p-3">
              <div className="flex items-center justify-between gap-2 text-[11px] text-muted"><span className="font-semibold text-fg">{i.name}</span><span>{ago(i.at, now)}</span></div>
              <a href={i.url} target="_blank" rel="noopener noreferrer nofollow" className="mt-1 flex items-start gap-1.5 text-[12.5px] leading-snug text-fg hover:text-accent">{i.title}<Icon name="ExternalLink" className="mt-0.5 h-3 w-3 shrink-0 text-muted" /></a>
            </li>
          ))}</ol>
        </Section>

        {s.related.length > 0 && (
          <Section title="Related">
            <ul className="space-y-1">{s.related.map((r) => <li key={r.id}><Link href={`/news/${r.slug}`} className="block rounded-md px-2 py-1.5 text-[13px] text-fg hover:bg-elevated hover:text-accent"><span className="text-muted">{ago(r.at, now)} · </span>{r.headline}</Link></li>)}</ul>
          </Section>
        )}
        <div className="mt-12"><Cta id={s.id} big /></div>
      </main>
    </Shell>
  );
}

export function PublicIndex({ stories, now }: { stories: PublicCard[]; now: number }) {
  const [lead, ...rest] = stories;
  return (
    <Shell>
      <main className="mx-auto max-w-[1180px] px-4 pb-16 pt-8 sm:px-5 sm:pt-12">
        <div className="nr-kicker">YouBank Newsroom</div>
        <h1 className="nr-head mt-2 text-[clamp(34px,5vw,64px)] leading-[1.02] text-fg">What moved markets and deals today</h1>
        <p className="mt-3 max-w-[64ch] text-[14px] leading-relaxed text-muted">The day&apos;s most important stories from about ninety free sources, filings and regulators, each summarized with its numbers, chart, timeline and every source linked. Sign in to get them ranked for your desk.</p>
        {!lead && <p className="mt-10 text-[13px] text-muted">The first stories arrive as sources are read, every ten minutes.</p>}
        {lead && (
          <Link href={`/news/${lead.slug}`} className="nr-card group mt-8 grid gap-5 overflow-hidden p-3 sm:p-4 md:grid-cols-[1.1fr_1fr]">
            <ArtThumb story={{ ...lead, filing: null, deal: lead.dealUsd ? { valueUsd: lead.dealUsd, kind: "deal" } : null }} sparks={NO_SPARKS} height={260} />
            <div className="flex flex-col justify-center p-2">
              <div className="nr-kicker" style={{ color: hueOf(lead.tags) }}>{lead.categoryLabel} · {ago(lead.updatedAt, now)}</div>
              <h2 className="nr-head mt-2 text-[clamp(24px,3vw,36px)] leading-[1.08] text-fg group-hover:text-accent">{lead.headline}</h2>
              {lead.bullet && <p className="nr-body mt-3 line-clamp-3 text-fg/75">{lead.bullet}</p>}
            </div>
          </Link>
        )}
        <div className="mt-8 grid gap-[var(--nr-gap)] sm:grid-cols-2 lg:grid-cols-3">
          {rest.slice(0, 12).map((s) => (
            <Link key={s.id} href={`/news/${s.slug}`} className="nr-card group flex flex-col overflow-hidden">
              <ArtThumb story={{ ...s, filing: null, deal: s.dealUsd ? { valueUsd: s.dealUsd, kind: "deal" } : null }} sparks={NO_SPARKS} height={130} className="m-2 mb-0" />
              <div className="flex flex-1 flex-col gap-2 p-[var(--nr-pad)] pt-3">
                <div className="nr-kicker" style={{ color: hueOf(s.tags) }}>{s.categoryLabel} · <span className="font-medium normal-case tracking-normal text-muted">{ago(s.updatedAt, now)}</span></div>
                <h3 className="nr-head nr-h3 text-fg group-hover:text-accent">{s.headline}</h3>
                {s.bullet && <p className="line-clamp-2 text-[12.5px] leading-relaxed text-fg/70">{s.bullet}</p>}
              </div>
            </Link>
          ))}
        </div>
        <div className="mt-12"><Cta big /></div>
        {rest.length > 12 && (
          <section className="mt-12">
            <h2 className="nr-kicker mb-3">More stories</h2>
            <ul className="divide-y divide-line">{rest.slice(12).map((s) => <li key={s.id}><Link href={`/news/${s.slug}`} className="flex items-baseline gap-3 py-2.5 text-[13.5px] text-fg hover:text-accent"><span className="num w-12 shrink-0 text-[11px] text-muted">{ago(s.updatedAt, now)}</span>{s.headline}</Link></li>)}</ul>
          </section>
        )}
      </main>
    </Shell>
  );
}
