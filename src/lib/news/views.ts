/** What the Newsroom's screens and the terminal read: stories ranked for a person, one story in full, the brief, deals. The radar is in ./radar/view.ts. */
import { and, desc, eq, gte, ilike, inArray, sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import type { NewsSummary } from "@/db/schema";
import { memo } from "@/lib/memo";
import { deskBrief, forYou } from "./brief";
import { CATEGORY_LABEL, type Category } from "./classify";
import { recentDeals, leagueTable, type DealRow } from "./deals";
import { allDesks, SECTOR_LABEL, LENS_LABEL, type Desk } from "./desks";
import { publicPrefs } from "./prefs";
import { rank } from "./rank";
import { readerFor, type ReaderContext } from "./reader";
import { itemsOf, sharedRecentClusters, type ClusterRow, type ItemRow } from "./store";

export type SourceRef = { name: string; domain: string; kind: string; url: string; at: string; via?: string };
export type DealBrief = Pick<DealRow, "kind" | "acquirer" | "acquirerTicker" | "target" | "targetTicker" | "valueUsd" | "perShare" | "consideration" | "premium" | "evEbitda" | "evRevenue" | "round" | "investors" | "advisors" | "status">;
export type StoryCard = {
  id: number; headline: string; category: string; categoryLabel: string; importance: number; tickers: string[]; tags: string[];
  sources: SourceRef[]; sourceCount: number; kinds: string[]; firstSeenAt: string; updatedAt: string;
  summary: NewsSummary | null; reasons: string[]; score: number; deal: DealBrief | null; saved: boolean; read: boolean; filing: { form: string; items: string[] } | null;
  /** The main companies in the story, for its monogram. */
  names: string[];
};
export type DeskRef = { id: string; label: string; lenses: string[]; sectors: string[]; tagLabels: string[] };

const deskRef = (d: Desk): DeskRef => ({ id: d.id, label: d.label, lenses: d.lenses, sectors: d.sectors, tagLabels: [...d.lenses.map((l) => LENS_LABEL[l]), ...d.sectors.map((s) => SECTOR_LABEL[s])] });

function sourcesOf(items: ItemRow[]): SourceRef[] {
  const seen = new Set<string>();
  const out: SourceRef[] = [];
  for (const i of [...items].sort((a, b) => (Number(a.meta.tier) || 3) - (Number(b.meta.tier) || 3) || a.publishedAt.getTime() - b.publishedAt.getTime())) {
    const k = i.kind === "filing" ? `sec:${String(i.meta.accession ?? i.key)}` : i.source.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ name: i.source, domain: i.domain, kind: i.kind, url: i.url, at: i.publishedAt.toISOString(), ...(i.meta.via ? { via: String(i.meta.via) } : {}) });
  }
  return out;
}

async function cardsFor(userId: string | null, clusters: (ClusterRow & { reasons?: string[]; score?: number })[]): Promise<StoryCard[]> {
  if (!clusters.length) return [];
  const ids = clusters.map((c) => c.id);
  const db = requireDb();
  const [items, states, deals] = await Promise.all([
    itemsOf(ids),
    userId ? db.select().from(schema.newsUserItems).where(and(eq(schema.newsUserItems.userId, userId), inArray(schema.newsUserItems.clusterId, ids))) : Promise.resolve([]),
    db.select().from(schema.newsDeals).where(inArray(schema.newsDeals.clusterId, ids)),
  ]);
  return clusters.map((c) => {
    const mine = items.filter((i) => i.clusterId === c.id);
    const st = states.find((s) => s.clusterId === c.id);
    const d = deals.find((x) => x.clusterId === c.id);
    const f = mine.find((i) => i.kind === "filing");
    return {
      id: c.id, headline: c.headline, category: c.category, categoryLabel: CATEGORY_LABEL[c.category as Category] ?? "News", importance: c.importance, tickers: c.tickers, tags: c.desks,
      sources: sourcesOf(mine).slice(0, 6), sourceCount: c.sourceCount, kinds: c.kinds, firstSeenAt: c.firstSeenAt.toISOString(), updatedAt: c.updatedAt.toISOString(),
      summary: c.summary?.bullets?.length ? c.summary : (mine.find((i) => i.snippet)?.snippet ? { bullets: [mine.find((i) => i.snippet)!.snippet], numbers: [], why: c.summary?.why ?? "" } : null), reasons: c.reasons ?? [], score: c.score ?? c.importance,
      names: c.entities.filter((e) => e.kind !== "person").map((e) => e.name).slice(0, 3),
      deal: d ? { kind: d.kind, acquirer: d.acquirer, acquirerTicker: d.acquirerTicker, target: d.target, targetTicker: d.targetTicker, valueUsd: d.valueUsd, perShare: d.perShare, consideration: d.consideration, premium: d.premium, evEbitda: d.evEbitda, evRevenue: d.evRevenue, round: d.round, investors: d.investors, advisors: d.advisors, status: d.status } : null,
      saved: !!st?.savedAt, read: !!st?.readAt, filing: f ? { form: String(f.meta.form ?? ""), items: (f.meta.items as string[] | undefined) ?? [] } : null,
    };
  });
}

export type FeedView = { desk: DeskRef; ownDesk: DeskRef; desks: DeskRef[]; prefs: ReturnType<typeof publicPrefs>; watchlist: string[]; stories: StoryCard[]; counts: Record<string, number>; generatedAt: string };

export async function feedView(userId: string, opts: { desk?: string; category?: string; kind?: string; q?: string; saved?: boolean; hours?: number; limit?: number } = {}): Promise<FeedView | null> {
  const ctx = await readerFor(userId);
  if (!ctx) return null;
  const desk = (opts.desk && allDesks().find((d) => d.id === opts.desk)) || ctx.desk;
  const reader = { ...ctx.reader, desk };
  let clusters: ClusterRow[];
  if (opts.saved) {
    const saved = await requireDb().select({ id: schema.newsUserItems.clusterId }).from(schema.newsUserItems).where(and(eq(schema.newsUserItems.userId, userId), sql`${schema.newsUserItems.savedAt} is not null`)).orderBy(desc(schema.newsUserItems.savedAt)).limit(200);
    clusters = saved.length ? await requireDb().select().from(schema.newsClusters).where(inArray(schema.newsClusters.id, saved.map((s) => s.id))) : [];
  } else if (opts.q?.trim()) {
    const q = `%${opts.q.trim().replace(/[%_]/g, "")}%`;
    clusters = await requireDb().select().from(schema.newsClusters).where(and(gte(schema.newsClusters.updatedAt, new Date(Date.now() - 30 * 86_400_000)), ilike(schema.newsClusters.headline, q))).orderBy(desc(schema.newsClusters.updatedAt)).limit(200);
  } else {
    clusters = await sharedRecentClusters(Math.min(Math.max(Math.round(opts.hours ?? 72), 1), 168), 800, 0.12);
  }
  const hidden = new Set((await requireDb().select({ id: schema.newsUserItems.clusterId }).from(schema.newsUserItems).where(and(eq(schema.newsUserItems.userId, userId), sql`${schema.newsUserItems.hiddenAt} is not null`))).map((r) => r.id));
  let ranked = rank(reader, clusters.filter((c) => !hidden.has(c.id)));
  const counts: Record<string, number> = {};
  for (const c of ranked) counts[c.category] = (counts[c.category] ?? 0) + 1;
  if (opts.category) ranked = ranked.filter((c) => c.category === opts.category);
  if (opts.kind) ranked = ranked.filter((c) => c.kinds.includes(opts.kind!));
  const stories = await cardsFor(userId, ranked.slice(0, opts.limit ?? 120));
  const desks = allDesks();
  return { desk: deskRef(desk), ownDesk: deskRef(ctx.ownDesk), desks: desks.map(deskRef), prefs: publicPrefs(ctx.prefs), watchlist: ctx.watchlist, stories, counts, generatedAt: new Date().toISOString() };
}

export type StoryView = StoryCard & { items: { title: string; snippet: string; source: string; domain: string; kind: string; url: string; at: string; via?: string; form?: string }[]; related: StoryCard[]; why: string | null; entities: ClusterRow["entities"] };

export async function storyView(userId: string, id: number): Promise<StoryView | null> {
  const db = requireDb();
  const [c] = await db.select().from(schema.newsClusters).where(eq(schema.newsClusters.id, id));
  if (!c) return null;
  const ctx = await readerFor(userId);
  const ranked = ctx ? rank(ctx.reader, [c])[0] : undefined;
  const [card] = await cardsFor(userId, [ranked ?? c]);
  const items = await itemsOf([id]);
  const related = c.tickers.length
    ? (await db.select().from(schema.newsClusters).where(and(gte(schema.newsClusters.updatedAt, new Date(Date.now() - 30 * 86_400_000)), sql`${schema.newsClusters.tickers} ?| array[${sql.join(c.tickers.slice(0, 4).map((t) => sql`${t}`), sql`, `)}]`, sql`${schema.newsClusters.id} <> ${id}`)).orderBy(desc(schema.newsClusters.updatedAt)).limit(6))
    : [];
  const [st] = await db.select().from(schema.newsUserItems).where(and(eq(schema.newsUserItems.userId, userId), eq(schema.newsUserItems.clusterId, id)));
  return {
    ...card, entities: c.entities, why: st?.why?.text ?? null, related: await cardsFor(userId, related),
    items: items.map((i) => ({ title: i.title, snippet: i.snippet, source: i.source, domain: i.domain, kind: i.kind, url: i.url, at: i.publishedAt.toISOString(), ...(i.meta.via ? { via: String(i.meta.via) } : {}), ...(i.meta.form ? { form: String(i.meta.form) } : {}) })),
  };
}

export async function briefView(userId: string, deskId?: string) {
  const ctx = await readerFor(userId);
  if (!ctx) return null;
  const desk = (deskId && allDesks().find((d) => d.id === deskId)) || ctx.desk;
  const brief = await deskBrief(desk);
  const mine = forYou({ ...ctx.reader, desk }, await sharedRecentClusters(30, 600, 0.2), 5);
  const cards = await cardsFor(userId, [...mine, ...(await requireDb().select().from(schema.newsClusters).where(inArray(schema.newsClusters.id, brief.items.map((i) => i.clusterId).length ? brief.items.map((i) => i.clusterId) : [-1])))]);
  return { brief, forYou: cards.slice(0, mine.length), cards: Object.fromEntries(cards.slice(mine.length).map((c) => [c.id, c])) };
}

/** The deal tracker and the year's league tables: the same for everyone, so built once per instance every two minutes. */
export async function dealsView(opts: { days?: number; kinds?: string[]; sectors?: string[] } = {}) {
  const days = Math.min(Math.max(Math.round(opts.days ?? 30), 1), 365);
  const kinds = [...(opts.kinds ?? [])].sort(), sectors = [...(opts.sectors ?? [])].sort();
  return memo(`news:deals:${days}:${kinds.join(",")}:${sectors.join(",")}`, 120_000, async () => {
    // Ownership stakes (13D filers) stay in the database but out of the tracker unless asked for.
    const deals = (await recentDeals({ days, kinds: kinds.length ? kinds : undefined, sectors: sectors.length ? sectors : undefined, limit: 200 })).filter((d) => kinds.includes("stake") || d.kind !== "stake").slice(0, 150);
    const { financial, legal } = await memo("news:league", 600_000, async () => {
      const year = await recentDeals({ days: 365, limit: 2000 });
      return { financial: leagueTable(year, "financial"), legal: leagueTable(year, "legal") };
    });
    return { deals, league: { financial, legal } };
  });
}

/** News about one company (terminal CN and the DES strip). */
export async function companyNews(userId: string | null, ticker: string, days = 30, limit = 30): Promise<StoryCard[]> {
  const rows = await requireDb().select().from(schema.newsClusters).where(and(gte(schema.newsClusters.updatedAt, new Date(Date.now() - days * 86_400_000)), sql`${schema.newsClusters.tickers} @> ${JSON.stringify([ticker.toUpperCase()])}::jsonb`)).orderBy(desc(schema.newsClusters.updatedAt)).limit(limit);
  return cardsFor(userId, rows);
}

/** News by topic (terminal NI): a desk tag ("energy", "ma") or words in headlines. */
export async function topicNews(userId: string | null, topic: string, days = 7, limit = 60): Promise<StoryCard[]> {
  const t = topic.trim().toLowerCase();
  const db = requireDb();
  const since = gte(schema.newsClusters.updatedAt, new Date(Date.now() - days * 86_400_000));
  const rows = /^[a-z]+$/.test(t) && (t in SECTOR_LABEL || t in LENS_LABEL)
    ? await db.select().from(schema.newsClusters).where(and(since, sql`${schema.newsClusters.desks} @> ${JSON.stringify([t])}::jsonb`)).orderBy(desc(schema.newsClusters.importance)).limit(limit)
    : await db.select().from(schema.newsClusters).where(and(since, ilike(schema.newsClusters.headline, `%${t.replace(/[%_]/g, "")}%`))).orderBy(desc(schema.newsClusters.importance)).limit(limit);
  return cardsFor(userId, rows.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()));
}

export type { ReaderContext };
