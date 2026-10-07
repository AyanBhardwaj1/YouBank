/**
 * Following a developing story. A follow remembers how many outlets had the story and when it last
 * moved at the time the person last heard about it; each Newsroom pass compares that with the story
 * now, and a real development (another outlet, or new reporting hours later) becomes one alert in the
 * bell and, on devices with push on, a push (held in quiet hours). At most one alert per story every
 * two hours, at most five a pass per person; a follow that has been quiet for 30 days lapses.
 *
 * Five follows are free; more is a premium feature (news.follows), checked here, on the server.
 */
import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { canUse } from "@/lib/billing/entitlements";
import { featureById } from "@/lib/billing/features";
import { PLANS } from "@/lib/billing/plans";
import { pushToUser } from "./deliver";
import { inQuietHours } from "./prefs";
import { readerFor } from "./reader";
import { itemsOf, type ClusterRow } from "./store";

export const FREE_FOLLOWS = 5;
/** No more than one alert per followed story in this window. */
export const FOLLOW_COOLDOWN_MS = 2 * 3_600_000;
/** New reporting this long after the last alert counts as an update even from an outlet already counted. */
const LATE_UPDATE_MS = 3 * 3_600_000;

export type FollowRow = typeof schema.newsFollows.$inferSelect;

/** Whether a followed story has moved enough to tell the person, and how to say it. Pure, for tests. */
export function followUpdate(f: Pick<FollowRow, "seenSources" | "seenAt" | "notifiedAt">, c: Pick<ClusterRow, "sourceCount" | "updatedAt">, now = new Date()): { due: boolean; newSources: number } {
  const newSources = Math.max(0, c.sourceCount - f.seenSources);
  if (f.notifiedAt && now.getTime() - f.notifiedAt.getTime() < FOLLOW_COOLDOWN_MS) return { due: false, newSources };
  const later = c.updatedAt.getTime() - f.seenAt.getTime();
  return { due: newSources >= 1 || later >= LATE_UPDATE_MS, newSources };
}

/** Whether one more follow is allowed. Pure. */
export const canFollowMore = (current: number, unlimited: boolean) => unlimited || current < FREE_FOLLOWS;

export async function followCount(userId: string): Promise<number> {
  const [r] = await requireDb().select({ n: sql<number>`count(*)::int` }).from(schema.newsFollows).where(eq(schema.newsFollows.userId, userId));
  return r?.n ?? 0;
}

export async function isFollowing(userId: string, clusterId: number): Promise<boolean> {
  const [r] = await requireDb().select({ id: schema.newsFollows.clusterId }).from(schema.newsFollows).where(and(eq(schema.newsFollows.userId, userId), eq(schema.newsFollows.clusterId, clusterId)));
  return !!r;
}

/**
 * Follow a story. Past the free five, only people whose plan includes unlimited follows may add more;
 * everyone else gets a plain message (status 402) saying how to get more.
 */
export async function follow(user: { id: string; email: string }, c: Pick<ClusterRow, "id" | "sourceCount" | "updatedAt">): Promise<{ following: true; count: number; limit: number | null }> {
  const db = requireDb();
  if (await isFollowing(user.id, c.id)) return { following: true, count: await followCount(user.id), limit: null };
  const [n, unlimited] = await Promise.all([followCount(user.id), canUse(user, "news.follows")]);
  if (!canFollowMore(n, unlimited)) {
    const f = featureById("news.follows");
    throw Object.assign(new Error(`You follow ${FREE_FOLLOWS} stories, the most on your plan. Unfollow one, or get ${f?.name.toLowerCase() ?? "unlimited follows"} with ${PLANS[f?.minPlan ?? "pro"].name} (Settings, under Plan).`), { status: 402 });
  }
  await db.insert(schema.newsFollows).values({ userId: user.id, clusterId: c.id, seenSources: c.sourceCount, seenAt: c.updatedAt }).onConflictDoNothing();
  return { following: true, count: n + 1, limit: unlimited ? null : FREE_FOLLOWS };
}

export async function unfollow(userId: string, clusterId: number): Promise<void> {
  await requireDb().delete(schema.newsFollows).where(and(eq(schema.newsFollows.userId, userId), eq(schema.newsFollows.clusterId, clusterId)));
}

/** The person's follows with each story's headline, most recently moved first. */
export async function followsOf(userId: string) {
  return requireDb().select({ clusterId: schema.newsFollows.clusterId, headline: schema.newsClusters.headline, updatedAt: schema.newsClusters.updatedAt, sourceCount: schema.newsClusters.sourceCount, updates: schema.newsFollows.updates, createdAt: schema.newsFollows.createdAt })
    .from(schema.newsFollows).innerJoin(schema.newsClusters, eq(schema.newsClusters.id, schema.newsFollows.clusterId))
    .where(eq(schema.newsFollows.userId, userId)).orderBy(desc(schema.newsClusters.updatedAt)).limit(100);
}

/**
 * One pass: every follow whose story moved since the person last heard, turned into a bell alert and
 * a push. Returns how many alerts went out. Bounded by `deadline` and five alerts per person.
 */
export async function followUpdates(deadline: number, now = new Date()): Promise<number> {
  const db = requireDb();
  const rows = await db.select({ f: schema.newsFollows, c: schema.newsClusters }).from(schema.newsFollows)
    .innerJoin(schema.newsClusters, eq(schema.newsClusters.id, schema.newsFollows.clusterId))
    .where(sql`(${schema.newsClusters.sourceCount} > ${schema.newsFollows.seenSources} or ${schema.newsClusters.updatedAt} > ${schema.newsFollows.seenAt} + interval '3 hours')`)
    .limit(500);
  const due = rows.map((r) => ({ ...r, d: followUpdate(r.f, r.c, now) })).filter((r) => r.d.due);
  if (!due.length) return 0;
  const items = await itemsOf([...new Set(due.map((r) => r.c.id))]);
  const perUser = new Map<string, number>();
  let sent = 0;
  for (const { f, c, d } of due) {
    if (Date.now() > deadline) break;
    const n = perUser.get(f.userId) ?? 0;
    if (n >= 5) continue;
    // The newest report on the story is the update.
    const latest = items.filter((i) => i.clusterId === c.id && i.publishedAt.getTime() > f.seenAt.getTime()).sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime())[0];
    const body = d.newSources >= 1
      ? `${d.newSources === 1 ? "One more outlet" : `${d.newSources} more outlets`} on it${latest ? `. Latest, ${latest.source}: ${latest.title}` : "."}`
      : latest ? `New reporting from ${latest.source}: ${latest.title}` : "There is new reporting on this story.";
    const [row] = await db.insert(schema.newsNotifications).values({
      userId: f.userId, key: `follow:${c.id}:${c.sourceCount}:${c.updatedAt.getTime()}`, kind: "follow", title: `Update: ${c.headline}`.slice(0, 300), body: body.slice(0, 600), url: `/app/news/story/${c.id}`, clusterId: c.id,
    }).onConflictDoNothing().returning();
    await db.update(schema.newsFollows).set({ seenSources: c.sourceCount, seenAt: c.updatedAt, notifiedAt: now, updates: sql`${schema.newsFollows.updates} + 1` })
      .where(and(eq(schema.newsFollows.userId, f.userId), eq(schema.newsFollows.clusterId, c.id)));
    if (!row) continue;
    perUser.set(f.userId, n + 1);
    sent++;
    // Push to the person's devices (they asked to follow this story), unless it is their quiet hours.
    const ctx = await readerFor(f.userId).catch(() => null);
    if (ctx && !inQuietHours(now, ctx.prefs)) {
      const pushed = await pushToUser(f.userId, { title: row.title, body: row.body.slice(0, 180), url: row.url, tag: `follow:${c.id}` }).catch(() => 0);
      if (pushed) await db.update(schema.newsNotifications).set({ delivered: { push: new Date().toISOString() } }).where(eq(schema.newsNotifications.id, row.id));
    }
  }
  return sent;
}

/** Retention: follows quiet for 30 days lapse; follows of deleted stories go. */
export async function pruneFollows(now = new Date()) {
  const db = requireDb();
  await db.delete(schema.newsFollows).where(lt(schema.newsFollows.seenAt, new Date(now.getTime() - 30 * 86_400_000)));
  await db.execute(sql`delete from news_follows f where not exists (select 1 from news_clusters c where c.id = f.cluster_id)`);
}

/** Which of these stories the person follows. */
export async function followedAmong(userId: string, ids: number[]): Promise<Set<number>> {
  if (!ids.length) return new Set();
  const rows = await requireDb().select({ id: schema.newsFollows.clusterId }).from(schema.newsFollows).where(and(eq(schema.newsFollows.userId, userId), inArray(schema.newsFollows.clusterId, ids))).catch(() => []);
  return new Set(rows.map((r) => r.id));
}
