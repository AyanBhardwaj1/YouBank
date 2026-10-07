/**
 * Public story pages (/news/<id>-<slug>), for people who are not signed in and for search engines and
 * link previews. What a public page may show is exactly what the Newsroom builds from public sources
 * and nothing about any person:
 * - the headline, our own summary, key figures and general "why it matters", deal terms, filings;
 * - every source as a link to its publisher (articles are never copied, as in the app);
 * - the timeline and the relationship map of public entities (never anyone's contacts);
 * - the company's public price line.
 * Never: reasons a story was shown to someone, "why it matters to you", saved, read or followed state,
 * anyone's watchlist, network, pipeline or Edge watches. These functions take no user at all, so they
 * cannot leak one. Results are cached per instance for a few minutes.
 */
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db as maybeDb, requireDb, schema } from "@/db";
import type { NewsSummary } from "@/db/schema";
import { historyFrom } from "@/lib/market/data";
import { memo } from "@/lib/memo";
import { CATEGORY_LABEL, type Category } from "./classify";
import { slugFor } from "./slug";
import { itemsOf, type ClusterRow } from "./store";
import { storyGraph, storyTimeline, type StoryGraph, type TimelineEvent } from "./storyviz";

export const SITE = "https://youbank-nu.vercel.app";

/** Item kinds that come from public sources (all of the Newsroom's do; anything new must be added here on purpose). */
const PUBLIC_KINDS = new Set(["article", "filing", "release", "gov", "paper", "repo", "model", "launch", "research"]);

export type PublicSpark = { ticker: string; closes: number[]; change: number | null; month: number | null };
export type PublicDeal = { kind: string; acquirer: string; target: string; valueUsd: number | null; perShare: number | null; consideration: string; premium: number | null; evEbitda: number | null; evRevenue: number | null; round: string; investors: string[]; advisors: { firm: string; side: string; role: string }[] };
export type PublicStory = {
  id: number; slug: string; headline: string; category: string; categoryLabel: string; tags: string[]; tickers: string[]; names: string[];
  firstSeenAt: string; updatedAt: string; sourceCount: number; importance: number;
  summary: NewsSummary | null; deal: PublicDeal | null; filing: { form: string; items: string[] } | null;
  sources: { name: string; url: string; at: string; kind: string; title: string; form?: string }[];
  timeline: TimelineEvent[]; graph: StoryGraph; spark: PublicSpark | null;
  related: { id: number; slug: string; headline: string; at: string }[];
};
export type PublicCard = Pick<PublicStory, "id" | "slug" | "headline" | "category" | "categoryLabel" | "tags" | "tickers" | "names" | "updatedAt" | "sourceCount" | "importance"> & { bullet: string; dealUsd: number | null };

/** Whether a story may have a public page: it exists, has sources, and every source is a public one. Pure. */
export function isPublicStory(c: Pick<ClusterRow, "headline">, items: { kind: string; url: string }[]): boolean {
  return c.headline.trim().length >= 12 && items.length > 0 && items.every((i) => PUBLIC_KINDS.has(i.kind) && /^https?:\/\//.test(i.url));
}

/** Thirty-day closes for one ticker, cached for half an hour; null when there is no price. */
export async function publicSpark(ticker: string): Promise<PublicSpark | null> {
  if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(ticker)) return null;
  return memo(`news:public-spark:${ticker}`, 30 * 60_000, async () => {
    const from = new Date(Date.now() - 50 * 86_400_000).toISOString().slice(0, 10);
    const h = await historyFrom(ticker, from, true).catch(() => null);
    const c = (h?.data ?? []).map((b) => b.close).filter((x) => Number.isFinite(x)).slice(-30);
    return c.length > 1 ? { ticker, closes: c, change: c[c.length - 1] / c[c.length - 2] - 1, month: c[c.length - 1] / c[0] - 1 } : null;
  }).catch(() => null);
}

const cardOf = (c: ClusterRow, dealUsd: number | null, bullet: string): PublicCard => ({
  id: c.id, slug: slugFor(c.id, c.headline), headline: c.headline, category: c.category, categoryLabel: CATEGORY_LABEL[c.category as Category] ?? "News",
  tags: c.desks, tickers: c.tickers, names: c.entities.filter((e) => e.kind !== "person").map((e) => e.name).slice(0, 3),
  updatedAt: c.updatedAt.toISOString(), sourceCount: c.sourceCount, importance: c.importance, bullet, dealUsd,
});

/** One story's public page, or null when it does not exist or may not be public. */
export async function publicStory(id: number): Promise<PublicStory | null> {
  if (!maybeDb) return null;
  return memo(`news:public-story:${id}`, 5 * 60_000, async () => {
    const db = requireDb();
    const [c] = await db.select().from(schema.newsClusters).where(eq(schema.newsClusters.id, id));
    if (!c) return null;
    const items = await itemsOf([id]);
    if (!isPublicStory(c, items)) return null;
    const [[d], related] = await Promise.all([
      db.select().from(schema.newsDeals).where(eq(schema.newsDeals.clusterId, id)),
      c.tickers.length
        ? db.select({ id: schema.newsClusters.id, headline: schema.newsClusters.headline, firstSeenAt: schema.newsClusters.firstSeenAt }).from(schema.newsClusters)
          .where(and(gte(schema.newsClusters.updatedAt, new Date(Date.now() - 30 * 86_400_000)), sql`${schema.newsClusters.tickers} ?| array[${sql.join(c.tickers.slice(0, 4).map((t) => sql`${t}`), sql`, `)}]`, sql`${schema.newsClusters.id} <> ${id}`))
          .orderBy(desc(schema.newsClusters.updatedAt)).limit(6)
        : Promise.resolve([]),
    ]);
    const f = items.find((i) => i.kind === "filing");
    const deal: PublicDeal | null = d ? { kind: d.kind, acquirer: d.acquirer, target: d.target, valueUsd: d.valueUsd, perShare: d.perShare, consideration: d.consideration, premium: d.premium, evEbitda: d.evEbitda, evRevenue: d.evRevenue, round: d.round, investors: d.investors, advisors: d.advisors } : null;
    // One entry per outlet (the same outlet's later headlines stay in the timeline).
    const seen = new Set<string>();
    const sources = items.filter((i) => { const k = i.kind === "filing" ? i.url : i.source.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
      .map((i) => ({ name: i.source, url: i.url, at: i.publishedAt.toISOString(), kind: i.kind, title: i.title, ...(i.meta.form ? { form: String(i.meta.form) } : {}) }));
    const timelineItems = items.map((i) => ({ title: i.title, source: i.source, kind: i.kind, url: i.url, at: i.publishedAt.toISOString(), ...(i.meta.form ? { form: String(i.meta.form) } : {}) }));
    const spark = c.tickers[0] ? await publicSpark(c.tickers[0]) : null;
    const story: PublicStory = {
      id: c.id, slug: slugFor(c.id, c.headline), headline: c.headline, category: c.category, categoryLabel: CATEGORY_LABEL[c.category as Category] ?? "News", tags: c.desks, tickers: c.tickers,
      names: c.entities.filter((e) => e.kind !== "person").map((e) => e.name).slice(0, 3), firstSeenAt: c.firstSeenAt.toISOString(), updatedAt: c.updatedAt.toISOString(), sourceCount: c.sourceCount, importance: c.importance,
      summary: c.summary?.bullets?.length ? { bullets: c.summary.bullets, numbers: c.summary.numbers ?? [], why: c.summary.why ?? "", ...(c.summary.watch ? { watch: c.summary.watch } : {}) } : null,
      deal, filing: f ? { form: String(f.meta.form ?? ""), items: (f.meta.items as string[] | undefined) ?? [] } : null,
      sources, timeline: storyTimeline(timelineItems, related.map((r) => ({ id: r.id, headline: r.headline, at: r.firstSeenAt.toISOString() }))),
      // The public map: public entities and the deal only, never anyone's contacts.
      graph: storyGraph(c.headline, c.entities, deal),
      spark, related: related.map((r) => ({ id: r.id, slug: slugFor(r.id, r.headline), headline: r.headline, at: r.firstSeenAt.toISOString() })),
    };
    return story;
  }).catch(() => null);
}

/** The most important recent public stories, for /news and the sitemap. Cached five minutes. */
export async function publicStories(hours = 72, limit = 60, minImportance = 0.3): Promise<PublicCard[]> {
  if (!maybeDb) return [];
  return memo(`news:public-list:${hours}:${limit}:${minImportance}`, 5 * 60_000, async () => {
    const db = requireDb();
    const rows = await db.select().from(schema.newsClusters)
      .where(and(gte(schema.newsClusters.updatedAt, new Date(Date.now() - hours * 3_600_000)), gte(schema.newsClusters.importance, minImportance)))
      .orderBy(desc(schema.newsClusters.importance)).limit(limit * 2);
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const [items, deals] = await Promise.all([itemsOf(ids), db.select({ clusterId: schema.newsDeals.clusterId, valueUsd: schema.newsDeals.valueUsd }).from(schema.newsDeals).where(inArray(schema.newsDeals.clusterId, ids))]);
    return rows.filter((c) => isPublicStory(c, items.filter((i) => i.clusterId === c.id))).slice(0, limit)
      .map((c) => cardOf(c, deals.find((d) => d.clusterId === c.id)?.valueUsd ?? null, c.summary?.bullets?.[0] ?? items.find((i) => i.clusterId === c.id && i.snippet)?.snippet ?? ""));
  }).catch(() => []);
}
