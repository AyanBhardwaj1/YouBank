/**
 * The Newsroom's database work. Every write is idempotent on its own (the Neon HTTP driver has no
 * interactive transactions): items insert once by key, a story's figures are recomputed from its
 * items rather than incremented, and retention deletes by age.
 */
import { and, desc, eq, getTableColumns, gte, inArray, isNull, lt, notInArray, or, sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { amountIn, importanceOf, readWords, type Category } from "./classify";
import { cosine as cosineOf, figures, mergeCentroid, packVector, sharesFigure, unpackVector, type ClusterCand } from "./cluster";
import type { Tag, Tier } from "./desks";
import type { RawItem } from "./types";
import { memo } from "@/lib/memo";

export type ItemRow = typeof schema.newsItems.$inferSelect;
export type ClusterRow = typeof schema.newsClusters.$inferSelect;

/* ---------------- Feeds ---------------- */

export async function feedStates(): Promise<Map<string, typeof schema.newsFeeds.$inferSelect>> {
  const rows = await requireDb().select().from(schema.newsFeeds);
  return new Map(rows.map((r) => [r.url, r]));
}

export async function saveFeedState(url: string, kind: string, patch: { etag?: string; lastModified?: string; ok: boolean; error?: string; everyMin: number; itemsSeen?: number; failCount: number }) {
  // Back off on failures: double the wait per consecutive failure, capped at a day.
  const waitMin = patch.ok ? patch.everyMin : Math.min(24 * 60, patch.everyMin * 2 ** Math.min(6, patch.failCount + 1));
  const values = {
    url, kind, etag: patch.etag ?? "", lastModified: patch.lastModified ?? "", lastFetchedAt: new Date(), nextFetchAt: new Date(Date.now() + waitMin * 60_000),
    failCount: patch.ok ? 0 : patch.failCount + 1, lastError: patch.ok ? "" : (patch.error ?? "").slice(0, 300), itemsSeen: patch.itemsSeen ?? 0,
  };
  await requireDb().insert(schema.newsFeeds).values(values).onConflictDoUpdate({
    target: schema.newsFeeds.url,
    set: { ...values, itemsSeen: sql`${schema.newsFeeds.itemsSeen} + ${patch.itemsSeen ?? 0}`, ...(patch.ok ? {} : { etag: sql`${schema.newsFeeds.etag}`, lastModified: sql`${schema.newsFeeds.lastModified}` }) },
  });
}

/* ---------------- Items ---------------- */

/** Store new items (known keys are skipped). Returns how many were new. */
export async function insertItems(items: RawItem[]): Promise<number> {
  if (!items.length) return 0;
  const seen = new Set<string>();
  const rows = items.filter((i) => (seen.has(i.key) ? false : (seen.add(i.key), true))).map((i) => {
    const words = readWords(i.title, i.snippet);
    return {
      key: i.key, url: i.url.slice(0, 2000), title: i.title.slice(0, 400), snippet: i.snippet.slice(0, 600), source: i.source.slice(0, 80), domain: i.domain.slice(0, 120),
      kind: i.kind, publishedAt: i.publishedAt, desks: [...new Set([...i.tags, ...words.tags])], tickers: i.tickers.slice(0, 8),
      meta: { ...i.meta, tier: i.tier, category: (i.meta.category as string | undefined) ?? words.category },
    };
  });
  let n = 0;
  for (let k = 0; k < rows.length; k += 200) {
    const res = await requireDb().insert(schema.newsItems).values(rows.slice(k, k + 200)).onConflictDoNothing({ target: schema.newsItems.key }).returning({ id: schema.newsItems.id });
    n += res.length;
  }
  return n;
}

export async function unclusteredItems(limit = 300): Promise<ItemRow[]> {
  return requireDb().select().from(schema.newsItems).where(isNull(schema.newsItems.clusterId)).orderBy(schema.newsItems.publishedAt).limit(limit);
}

export async function setEmbeddings(pairs: { id: number; vec: Float32Array }[]) {
  for (let k = 0; k < pairs.length; k += 300) {
    const chunk = pairs.slice(k, k + 300);
    await requireDb().execute(sql`update news_items as i set embedding = v.e from (values ${sql.join(chunk.map((p) => sql`(${p.id}::int, ${packVector(p.vec)}::text)`), sql`, `)}) as v(id, e) where i.id = v.id`);
  }
}

/* ---------------- Stories ---------------- */

export async function clusterCandidates(hours = 60): Promise<ClusterCand[]> {
  const since = new Date(Date.now() - hours * 3_600_000);
  const rows = await requireDb().select({ id: schema.newsClusters.id, headline: schema.newsClusters.headline, centroid: schema.newsClusters.centroid, tickers: schema.newsClusters.tickers, category: schema.newsClusters.category, kinds: schema.newsClusters.kinds, updatedAt: schema.newsClusters.updatedAt })
    .from(schema.newsClusters).where(gte(schema.newsClusters.updatedAt, since)).orderBy(desc(schema.newsClusters.updatedAt)).limit(4000);
  // Each story's recent headlines, so a new item can match any outlet's wording, not just the lead's.
  const titles = new Map<number, string[]>();
  const ids = rows.filter((r) => r.kinds.some((k) => k !== "filing")).map((r) => r.id);
  for (let k = 0; k < ids.length; k += 1000) {
    const t = await requireDb().select({ c: schema.newsItems.clusterId, title: schema.newsItems.title }).from(schema.newsItems).where(inArray(schema.newsItems.clusterId, ids.slice(k, k + 1000)));
    for (const r of t) if (r.c !== null) { const l = titles.get(r.c) ?? []; if (l.length < 6) l.push(r.title); titles.set(r.c, l); }
  }
  return rows.map((r) => ({ id: r.id, headline: r.headline, centroid: unpackVector(r.centroid), tickers: r.tickers, category: r.category, kinds: r.kinds, lastAt: r.updatedAt.getTime(), titles: titles.get(r.id) ?? [] }));
}

/** A new one-item story, scored from its item so it needs no refresh until another source joins. */
export async function createCluster(item: ItemRow, vec: Float32Array | null): Promise<number> {
  const category = String(item.meta.category ?? "general") as Category;
  const importance = importanceOf({
    tiers: [(Number(item.meta.tier) || 3) as Tier], sourceCount: 1, category,
    amountUsd: amountIn(item.title) ?? (typeof item.meta.amountUsd === "number" ? (item.meta.amountUsd as number) : null),
    filingWeight: typeof item.meta.weight === "number" ? (item.meta.weight as number) : null,
  });
  const [c] = await requireDb().insert(schema.newsClusters).values({
    headline: item.title, category, importance, desks: item.desks, tickers: item.tickers, kinds: [item.kind],
    firstSeenAt: item.publishedAt, updatedAt: item.publishedAt, centroid: vec ? packVector(vec) : null, sourceCount: 1,
  }).returning({ id: schema.newsClusters.id });
  return c.id;
}

/** Point many items at their stories in one statement per 500. */
export async function assignItems(pairs: { itemId: number; clusterId: number }[]) {
  for (let k = 0; k < pairs.length; k += 500) {
    const chunk = pairs.slice(k, k + 500);
    await requireDb().execute(sql`update news_items as i set cluster_id = v.cid from (values ${sql.join(chunk.map((p) => sql`(${p.itemId}::int, ${p.clusterId}::int)`), sql`, `)}) as v(id, cid) where i.id = v.id`);
  }
}

const TIER_RANK = (t: unknown) => (t === 1 ? 3 : t === 2 ? 2 : 1);
const KIND_RANK: Record<string, number> = { article: 3, research: 3, gov: 2, release: 2, filing: 1, paper: 2, repo: 2, model: 1, launch: 2 };

/**
 * Recompute a story from its items: the headline from its best source (national press over trade
 * press over wires and filings, earliest first), outlets counted once each, tags and tickers merged,
 * importance re-scored unless a model has scored it, and the centroid of member embeddings.
 */
export async function refreshCluster(clusterId: number): Promise<ClusterRow | null> {
  const db = requireDb();
  const items = await db.select().from(schema.newsItems).where(eq(schema.newsItems.clusterId, clusterId));
  if (!items.length) return null;
  const [c] = await db.select().from(schema.newsClusters).where(eq(schema.newsClusters.id, clusterId));
  if (!c) return null;
  const ranked = [...items].sort((a, b) => TIER_RANK(b.meta.tier) - TIER_RANK(a.meta.tier) || (KIND_RANK[b.kind] ?? 0) - (KIND_RANK[a.kind] ?? 0) || a.publishedAt.getTime() - b.publishedAt.getTime());
  const lead = ranked[0];
  const outlets = new Set(items.map((i) => (i.kind === "filing" ? `sec:${i.meta.accession ?? i.key}` : i.source.toLowerCase())));
  const tiers = items.map((i) => (Number(i.meta.tier) || 3) as Tier);
  const categories = items.map((i) => String(i.meta.category ?? "general")).filter((x) => x !== "general");
  const category = (c.enrichedAt ? c.category : categories.sort((a, b) => categories.filter((x) => x === b).length - categories.filter((x) => x === a).length)[0] ?? "general") as Category;
  const filingWeight = items.filter((i) => typeof i.meta.weight === "number").reduce<number | null>((m, i) => Math.max(m ?? 0, i.meta.weight as number), null);
  const amount = items.reduce<number | null>((m, i) => { const a = amountIn(i.title) ?? (typeof i.meta.amountUsd === "number" ? (i.meta.amountUsd as number) : null); return a !== null && (m === null || a > m) ? a : m; }, null);
  const heuristic = importanceOf({ tiers, sourceCount: outlets.size, category, amountUsd: amount, filingWeight });
  let centroid: Float32Array | null = null, n = 0;
  for (const i of items) { const v = unpackVector(i.embedding); if (v) { centroid = mergeCentroid(centroid, n, v); n++; } }
  const [updated] = await db.update(schema.newsClusters).set({
    headline: lead.title,
    category, sourceCount: outlets.size, kinds: [...new Set(items.map((i) => i.kind))],
    desks: [...new Set([...(c.enrichedAt ? c.desks : []), ...items.flatMap((i) => i.desks)])] as Tag[],
    tickers: [...new Set([...(c.enrichedAt ? c.tickers : []), ...items.flatMap((i) => i.tickers)])].slice(0, 10),
    // A model's score is kept, but a story that keeps spreading can still rise.
    importance: c.enrichedAt ? Math.max(c.importance, heuristic * 0.9) : heuristic,
    firstSeenAt: new Date(Math.min(...items.map((i) => i.publishedAt.getTime()))),
    updatedAt: new Date(Math.max(...items.map((i) => i.publishedAt.getTime()), c.updatedAt.getTime())),
    centroid: centroid ? packVector(centroid) : c.centroid,
  }).where(eq(schema.newsClusters.id, clusterId)).returning();
  return updated ?? null;
}

/** Stories worth a model's reading: important enough, and new or grown since last read. */
export async function clustersToEnrich(limit: number, minImportance = 0.42): Promise<ClusterRow[]> {
  const since = new Date(Date.now() - 36 * 3_600_000);
  return requireDb().select().from(schema.newsClusters)
    .where(and(gte(schema.newsClusters.updatedAt, since), gte(schema.newsClusters.importance, minImportance), or(
      isNull(schema.newsClusters.enrichedAt),
      // A failed reading is retried after half an hour (enrich.ts gives up after three tries).
      sql`${schema.newsClusters.summary} is null and ${schema.newsClusters.enrichedAt} < now() - interval '30 minutes'`,
      sql`${schema.newsClusters.sourceCount} >= 3 and ${schema.newsClusters.updatedAt} > ${schema.newsClusters.enrichedAt} + interval '6 hours'`,
    )))
    .orderBy(desc(schema.newsClusters.importance)).limit(limit);
}

/** A story's items for display, without the embedding (clustering reads that with its own query). */
export async function itemsOf(clusterIds: number[]): Promise<ItemRow[]> {
  if (!clusterIds.length) return [];
  return requireDb().select({ ...getTableColumns(schema.newsItems), embedding: sql<string | null>`null` }).from(schema.newsItems)
    .where(inArray(schema.newsItems.clusterId, clusterIds)).orderBy(schema.newsItems.publishedAt);
}

/**
 * Recent stories for ranking: everything that moved in the window, most recent first, without the
 * centroid (clustering reads that with its own query). The feed and brief ask with the same window for
 * everyone, so one read per instance a minute serves them all; results are shared, never mutated.
 */
export async function recentClusters(hours: number, limit = 600, minImportance = 0): Promise<ClusterRow[]> {
  const since = new Date(Date.now() - hours * 3_600_000);
  return requireDb().select({ ...getTableColumns(schema.newsClusters), centroid: sql<string | null>`null` }).from(schema.newsClusters)
    .where(and(gte(schema.newsClusters.updatedAt, since), gte(schema.newsClusters.importance, minImportance)))
    .orderBy(desc(schema.newsClusters.updatedAt)).limit(limit);
}

export const sharedRecentClusters = (hours: number, limit: number, minImportance: number) =>
  memo(`news:recent:${hours}:${limit}:${minImportance}`, 60_000, () => recentClusters(hours, limit, minImportance));

/* ---------------- Retention ---------------- */

/** Keep the tables small: items 30 days, embeddings 4 days, stories 120 days unless saved or a deal, briefs 60 days, read alerts 60 days, audio briefings 7 days. */
export async function prune(now = new Date()) {
  const db = requireDb();
  const day = 86_400_000;
  await db.update(schema.newsItems).set({ embedding: null }).where(and(lt(schema.newsItems.fetchedAt, new Date(now.getTime() - 4 * day)), sql`${schema.newsItems.embedding} is not null`));
  await db.update(schema.newsClusters).set({ centroid: null }).where(and(lt(schema.newsClusters.updatedAt, new Date(now.getTime() - 4 * day)), sql`${schema.newsClusters.centroid} is not null`));
  await db.delete(schema.newsItems).where(lt(schema.newsItems.publishedAt, new Date(now.getTime() - 30 * day)));
  const keep = db.select({ id: schema.newsUserItems.clusterId }).from(schema.newsUserItems).where(sql`${schema.newsUserItems.savedAt} is not null`);
  const deals = db.select({ id: schema.newsDeals.clusterId }).from(schema.newsDeals);
  await db.delete(schema.newsClusters).where(and(lt(schema.newsClusters.updatedAt, new Date(now.getTime() - 120 * day)), notInArray(schema.newsClusters.id, keep), notInArray(schema.newsClusters.id, deals)));
  await db.delete(schema.newsBriefs).where(lt(schema.newsBriefs.createdAt, new Date(now.getTime() - 60 * day)));
  await db.delete(schema.newsNotifications).where(and(lt(schema.newsNotifications.createdAt, new Date(now.getTime() - 60 * day)), sql`${schema.newsNotifications.readAt} is not null`));
  await db.delete(schema.newsNotifications).where(lt(schema.newsNotifications.createdAt, new Date(now.getTime() - 120 * day)));
  // Audio briefings: their chapters are kept a week (the audio itself, in object storage, is overwritten daily).
  await db.delete(schema.newsBriefings).where(lt(schema.newsBriefings.createdAt, new Date(now.getTime() - 7 * day))).catch(() => undefined);
}

/* ---------------- Duplicates ---------------- */

/**
 * Fold stories that turned out to be one event into the earliest of them: the same deal once both
 * were read (kind, buyer and target), or near-identical meaning (cosine 0.8 and up) that shares a
 * company. Items, saved state and alert links move to the surviving story; its deal row stays.
 */
export async function mergeDuplicates(hours = 36): Promise<number> {
  const db = requireDb();
  const since = new Date(Date.now() - hours * 3_600_000);
  const rows = await db.select({ id: schema.newsClusters.id, headline: schema.newsClusters.headline, centroid: schema.newsClusters.centroid, tickers: schema.newsClusters.tickers, entities: schema.newsClusters.entities, firstSeenAt: schema.newsClusters.firstSeenAt, kinds: schema.newsClusters.kinds })
    .from(schema.newsClusters).where(gte(schema.newsClusters.updatedAt, since)).orderBy(schema.newsClusters.firstSeenAt).limit(1200);
  const deals = await db.select({ clusterId: schema.newsDeals.clusterId, kind: schema.newsDeals.kind, acquirer: schema.newsDeals.acquirer, target: schema.newsDeals.target }).from(schema.newsDeals).where(gte(schema.newsDeals.announcedAt, new Date(since.getTime() - 86_400_000)));
  const into = new Map<number, number>();
  const root = (id: number): number => { let r = id; while (into.has(r)) r = into.get(r)!; return r; };
  const order = new Map(rows.map((r, i) => [r.id, i]));
  const link = (a: number, b: number) => {
    const ra = root(a), rb = root(b);
    if (ra === rb) return;
    const [keep, drop] = (order.get(ra) ?? 0) <= (order.get(rb) ?? 0) ? [ra, rb] : [rb, ra];
    into.set(drop, keep);
  };
  const norm = (s: string) => s.toLowerCase().replace(/[.,'’]/g, " ").replace(/\b(inc|corp|corporation|co|ltd|limited|llc|plc|holdings?|group|sa|se|ag|nv)\b/g, " ").replace(/\s+/g, " ").trim();
  // Names match when one contains the other: "World Labs" and "Fei-Fei Li s World Labs", "AMD" and "AMD Inc".
  const sameName = (a: string, b: string) => !!a && !!b && (a === b || (a.length > 2 && b.includes(a)) || (b.length > 2 && a.includes(b)));
  const TAKEOVER = new Set(["acquisition", "merger", "take_private", "tender"]);
  const sameKind = (a: string, b: string) => a === b || (TAKEOVER.has(a) && TAKEOVER.has(b));
  const nd = deals.filter((d) => d.target && order.has(d.clusterId)).map((d) => ({ ...d, t: norm(d.target), a: norm(d.acquirer) }));
  for (let i = 0; i < nd.length; i++) for (let j = i + 1; j < nd.length; j++) {
    const x = nd[i], y = nd[j];
    if (x.clusterId !== y.clusterId && sameKind(x.kind, y.kind) && sameName(x.t, y.t) && (!x.a || !y.a || sameName(x.a, y.a))) link(x.clusterId, y.clusterId);
  }
  // A headline that names a story's company counts as sharing it ("...joining AMD in an $8 billion deal"
  // has no ticker until it is read). Tickers of three letters or more that are not everyday acronyms.
  const ACRONYM = new Set(["CEO", "CFO", "COO", "IPO", "SEC", "FDA", "FTC", "DOJ", "EPA", "FCC", "USA", "GDP", "CPI", "PCE", "ETF", "LNG", "API", "EPS", "ECB", "BOE", "BOJ", "IMF", "OPEC", "NYSE", "SPAC", "LBO", "ESG", "EBITDA", "NASA", "NATO", "CNBC", "AWS", "GPU", "EV", "EVS", "NEW", "ALL", "BIG", "ONE", "NOW", "FOR", "ARE", "CAN", "HAS", "WAS"]);
  const namedIn = (tickers: Set<string>, headline: string) => {
    const words = new Set(headline.split(/[^A-Za-z0-9.]+/).map((w) => w.replace(/\.+$/, "")));
    return [...tickers].some((t) => t.length >= 3 && !ACRONYM.has(t) && words.has(t));
  };
  const vecs = rows.map((r) => ({ id: r.id, headline: r.headline, v: unpackVector(r.centroid), tickers: new Set(r.tickers), figs: figures(r.headline), names: new Set(r.entities.filter((e) => e.kind !== "person").map((e) => norm(e.name)).filter((n) => n.length > 2)), distinct: r.kinds.every((k) => ["paper", "repo", "model", "launch"].includes(k)) }));
  for (let i = 0; i < vecs.length; i++) {
    const a = vecs[i];
    if (!a.v || a.distinct) continue;
    for (let j = i + 1; j < vecs.length; j++) {
      const b = vecs[j];
      if (!b.v || b.distinct) continue;
      const cos = cosineOf(a.v, b.v);
      if (cos < 0.72) continue;
      const sharesCompany = [...a.tickers].some((t) => b.tickers.has(t)) || [...a.names].some((n) => [...b.names].some((m) => sameName(n, m))) || namedIn(a.tickers, b.headline) || namedIn(b.tickers, a.headline);
      const exactFigure = [...a.figs].some((f) => b.figs.has(f));
      if ((sharesCompany && cos >= 0.78) || (cos >= 0.76 && sharesFigure(a.figs, b.figs)) || (sharesCompany && exactFigure)) link(a.id, b.id);
    }
  }
  let merged = 0;
  for (const drop of into.keys()) {
    const keep = root(drop);
    await db.update(schema.newsItems).set({ clusterId: keep }).where(eq(schema.newsItems.clusterId, drop));
    await db.execute(sql`insert into news_user_items (user_id, cluster_id, read_at, saved_at, hidden_at, why, updated_at) select user_id, ${keep}, read_at, saved_at, hidden_at, why, updated_at from news_user_items where cluster_id = ${drop} on conflict (user_id, cluster_id) do nothing`);
    await db.delete(schema.newsUserItems).where(eq(schema.newsUserItems.clusterId, drop));
    // Followers of the dropped story now follow the one that survives, keeping their place in it.
    await db.execute(sql`insert into news_follows (user_id, cluster_id, seen_sources, seen_at, notified_at, updates, created_at) select user_id, ${keep}, seen_sources, seen_at, notified_at, updates, created_at from news_follows where cluster_id = ${drop} on conflict (user_id, cluster_id) do nothing`).catch(() => undefined);
    await db.delete(schema.newsFollows).where(eq(schema.newsFollows.clusterId, drop)).catch(() => undefined);
    await db.update(schema.newsNotifications).set({ clusterId: keep, url: `/app/news/story/${keep}` }).where(eq(schema.newsNotifications.clusterId, drop));
    await db.delete(schema.newsDeals).where(eq(schema.newsDeals.clusterId, drop));
    await db.delete(schema.newsClusters).where(eq(schema.newsClusters.id, drop));
    merged++;
  }
  for (const keep of new Set([...into.keys()].map(root))) await refreshCluster(keep).catch(() => null);
  return merged;
}
