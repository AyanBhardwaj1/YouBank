/**
 * One pass of the Newsroom, run every ten minutes: poll the sources that are due, cluster what is new
 * into stories, have the model read the important ones, raise alerts, write and deliver the morning
 * briefs, run the research briefs, and prune. A lock keeps passes from overlapping; every stage runs
 * inside a time budget so a slow source or model cannot make the pass overrun its function limit.
 */
import { and, eq } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { cacheGet, cacheSet } from "@/lib/cache";
import { alertsFor, newsUsers } from "./alerts";
import { briefSlot, deskBrief, forYou } from "./brief";
import { bestCluster, embed } from "./cluster";
import { briefEmail, briefSlack, emailSelf, pushToUser, slackPost } from "./deliver";
import { FEEDS, FILING_FORMS, allDesks, type Desk } from "./desks";
import { enrichCluster } from "./enrich";
import { briefDue, localParts } from "./prefs";
import { readerFor } from "./reader";
import { currentFeedUrl, fetchFilings } from "./sources/edgar";
import { fetchGdelt } from "./sources/gdelt";
import { federalRegisterUrl, fetchFederalRegister } from "./sources/gov";
import { fetchRadar } from "./sources/radar";
import { warmRadars } from "./radar";
import { fetchRss } from "./sources/rss";
import { fetchCryptoSignals } from "@/lib/crypto/news";
import { researchDesk } from "./sources/research";
import { assignItems, clusterCandidates, clustersToEnrich, createCluster, feedStates, insertItems, itemsOf, mergeDuplicates, prune, recentClusters, refreshCluster, saveFeedState, setEmbeddings, unclusteredItems } from "./store";
import type { FetchResult } from "./types";

type Source = { url: string; kind: string; everyMin: number; priority: number; run: (state: { etag?: string; lastModified?: string }) => Promise<FetchResult> };

/** Every scheduled source: publisher feeds, EDGAR by form, the Federal Register, GDELT, the radar. */
export function sources(): Source[] {
  const edgarEvery = (form: string) => (form === "8-K" ? 10 : form === "D" ? 30 : 20);
  return [
    ...FEEDS.map((f) => ({ url: f.url, kind: "rss", everyMin: f.everyMin, priority: f.tier, run: (s: { etag?: string; lastModified?: string }) => fetchRss(f, s) })),
    ...[...new Set(FILING_FORMS.map((f) => f.form))].map((form) => ({ url: currentFeedUrl(form), kind: "edgar", everyMin: edgarEvery(form), priority: 1, run: () => fetchFilings(form) })),
    { url: federalRegisterUrl(), kind: "gov", everyMin: 180, priority: 2, run: () => fetchFederalRegister() },
    { url: "gdelt:rotation", kind: "gdelt", everyMin: 15, priority: 2, run: () => fetchGdelt() },
    { url: "radar:weekly", kind: "radar", everyMin: 360, priority: 3, run: () => fetchRadar() },
    // Crypto rounds, unlocks and SEC filings on crypto holdings (src/lib/crypto/news.ts), free sources only.
    { url: "crypto:signals", kind: "crypto", everyMin: 180, priority: 3, run: () => fetchCryptoSignals() },
  ];
}

async function pool<T>(xs: T[], n: number, deadline: number, f: (x: T) => Promise<void>) {
  const queue = [...xs];
  await Promise.all(Array.from({ length: Math.min(n, queue.length) }, async () => {
    while (queue.length && Date.now() < deadline) await f(queue.shift() as T);
  }));
}

export type TickReport = { ms: number; fetched: number; failed: number; newItems: number; clustered: number; newStories: number; enriched: number; merged: number; alerts: number; briefs: number; delivered: number; researched: number; radars: number; pruned: boolean; errors: string[] };

/** Poll due sources and store what is new. */
async function ingest(deadline: number, report: TickReport) {
  const states = await feedStates();
  const now = Date.now();
  const due = sources().filter((s) => { const st = states.get(s.url); return !st || st.nextFetchAt.getTime() <= now; }).sort((a, b) => a.priority - b.priority);
  // SEC asks for no more than ten requests a second: its forms go one at a time in their own lane.
  const run = async (s: Source) => {
    const st = states.get(s.url);
    const r = await s.run({ etag: st?.etag || undefined, lastModified: st?.lastModified || undefined }).catch((e): FetchResult => ({ status: "error", items: [], error: e instanceof Error ? e.message : String(e) }));
    const fresh = r.items.length ? await insertItems(r.items).catch((e) => { report.errors.push(`insert ${s.kind}: ${e instanceof Error ? e.message.slice(0, 80) : e}`); return 0; }) : 0;
    report.newItems += fresh;
    if (r.status === "error") report.failed++; else report.fetched++;
    await saveFeedState(s.url, s.kind, { ok: r.status !== "error", etag: r.etag, lastModified: r.lastModified, error: r.error, everyMin: s.everyMin, itemsSeen: fresh, failCount: st?.failCount ?? 0 }).catch(() => undefined);
  };
  await Promise.all([pool(due.filter((s) => s.kind !== "edgar"), 8, deadline, run), pool(due.filter((s) => s.kind === "edgar"), 1, deadline, run)]);
}

/**
 * Put new items into stories. Assignment happens in memory (a new story can gather later items of
 * the same batch), then the new stories and the item links are written in bulk, and only stories
 * that gained a second source are recomputed.
 */
async function clusterNew(deadline: number, report: TickReport) {
  let cands = await clusterCandidates();
  const BATCH = 400;
  while (Date.now() < deadline) {
    const batch = await unclusteredItems(BATCH);
    if (!batch.length) break;
    const vecs = await embed(batch.map((i) => i.title)).catch(() => null);
    if (vecs) await setEmbeddings(batch.map((i, k) => ({ id: i.id, vec: vecs[k] }))).catch(() => undefined);
    const pending = new Map<number, { lead: (typeof batch)[number]; vec: Float32Array | null; members: number[] }>();
    const links: { itemId: number; clusterId: number }[] = [];
    const touched = new Set<number>();
    let temp = -1;
    for (const [k, item] of batch.entries()) {
      const vec = vecs?.[k] ?? null;
      const category = String(item.meta.category ?? "general");
      const m = bestCluster({ title: item.title, vec, tickers: item.tickers, kind: item.kind, category, at: item.publishedAt.getTime() }, cands);
      if (m) { const c = cands.find((x) => x.id === m.id); if (c && (c.titles ??= []).length < 6) c.titles.push(item.title); }
      if (m && m.id < 0) pending.get(m.id)!.members.push(item.id);
      else if (m) { links.push({ itemId: item.id, clusterId: m.id }); touched.add(m.id); }
      else {
        const id = temp--;
        pending.set(id, { lead: item, vec, members: [] });
        cands = [{ id, headline: item.title, centroid: vec, tickers: item.tickers, category, kinds: [item.kind], lastAt: item.publishedAt.getTime(), titles: [item.title] }, ...cands];
        report.newStories++;
      }
      report.clustered++;
    }
    const real = new Map<number, number>();
    await pool([...pending.entries()], 10, Number.POSITIVE_INFINITY, async ([tmp, p]) => { real.set(tmp, await createCluster(p.lead, p.vec)); });
    for (const [tmp, p] of pending) {
      const id = real.get(tmp);
      if (!id) continue;
      links.push({ itemId: p.lead.id, clusterId: id }, ...p.members.map((itemId) => ({ itemId, clusterId: id })));
      if (p.members.length) touched.add(id);
    }
    await assignItems(links);
    cands = cands.map((c) => (c.id < 0 ? { ...c, id: real.get(c.id) ?? c.id } : c)).filter((c) => c.id > 0);
    await pool([...touched], 8, Number.POSITIVE_INFINITY, async (id) => {
      const c = await refreshCluster(id).catch(() => null);
      if (c) cands = cands.map((x) => (x.id === id ? { ...x, headline: c.headline, tickers: c.tickers, category: c.category, kinds: c.kinds, lastAt: c.updatedAt.getTime() } : x));
    });
    if (batch.length < BATCH) break;
  }
}

async function enrichTop(deadline: number, report: TickReport) {
  const todo = await clustersToEnrich(24);
  const items = await itemsOf(todo.map((c) => c.id));
  await pool(todo, 4, deadline, async (c) => {
    if (await enrichCluster(c, items.filter((i) => i.clusterId === c.id)).catch(() => false)) report.enriched++;
  });
}

/** The desks people are on (their own or the one they chose to read). */
async function activeDesks(users: string[]): Promise<Desk[]> {
  const byId = new Map<string, Desk>();
  for (const u of users) { const ctx = await readerFor(u).catch(() => null); if (ctx) byId.set(ctx.desk.id, ctx.desk); }
  return [...byId.values()];
}

/** Morning briefs: written for each active desk from 05:30 New York time, delivered at each person's time. */
async function briefs(users: string[], origin: string, deadline: number, report: TickReport) {
  const now = new Date();
  const ny = localParts(now, "America/New_York");
  if (ny.hour * 60 + ny.minute < 5 * 60 + 30) return;
  for (const desk of await activeDesks(users)) {
    if (Date.now() > deadline) return;
    const slot = briefSlot(now);
    const [exists] = await requireDb().select({ id: schema.newsBriefs.id }).from(schema.newsBriefs).where(and(eq(schema.newsBriefs.desk, desk.id), eq(schema.newsBriefs.kind, "morning"), eq(schema.newsBriefs.slot, slot)));
    if (!exists) { await deskBrief(desk, { slot }).catch((e) => report.errors.push(`brief ${desk.id}: ${e instanceof Error ? e.message.slice(0, 80) : e}`)); report.briefs++; }
  }
  const recent = await recentClusters(30, 600, 0.2);
  for (const u of users) {
    if (Date.now() > deadline) return;
    const ctx = await readerFor(u).catch(() => null);
    if (!ctx?.prefs.brief.enabled) continue;
    const due = briefDue(now, ctx.prefs);
    if (!due.due) continue;
    const brief = await deskBrief(ctx.desk).catch(() => null);
    if (!brief?.items.length) continue;
    const mine = forYou(ctx.reader, recent, 5);
    const [row] = await requireDb().insert(schema.newsNotifications).values({
      userId: u, key: `brief:${due.date}`, kind: "brief", title: `${brief.deskLabel} brief: ${brief.title}`, body: brief.intro || brief.items[0]?.headline || "", url: "/app/news?view=brief",
    }).onConflictDoNothing().returning();
    if (!row) continue;
    const delivered: Record<string, string> = {};
    const dateLabel = new Date(`${due.date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
    for (const ch of ctx.prefs.brief.channels) {
      try {
        if (ch === "email") delivered.email = await emailSelf(u, origin, briefEmail(brief, mine.map((m) => ({ id: m.id, headline: m.headline, reasons: m.reasons })), origin, dateLabel)).then(() => new Date().toISOString());
        if (ch === "push") delivered.push = String(await pushToUser(u, { title: row.title, body: row.body.slice(0, 180), url: row.url, tag: row.key }));
        if (ch === "slack" && ctx.prefs.slack) { const s = briefSlack(brief, origin); await slackPost(ctx.prefs.slack, s.text, s.blocks); delivered.slack = new Date().toISOString(); }
      } catch (e) { delivered[ch] = `error: ${e instanceof Error ? e.message.slice(0, 120) : "failed"}`; }
    }
    if (Object.keys(delivered).length) await requireDb().update(schema.newsNotifications).set({ delivered }).where(eq(schema.newsNotifications.id, row.id));
    report.delivered++;
  }
}

/** Research briefs at 08:00 and 13:00 New York time, for active desks, two per pass. */
async function research(users: string[], deadline: number, report: TickReport) {
  const ny = localParts(new Date(), "America/New_York");
  if (![8, 13].includes(ny.hour) || ny.weekday === 0 || ny.weekday === 6) return;
  let done = 0;
  for (const desk of await activeDesks(users)) {
    if (done >= 2 || Date.now() > deadline) return;
    const key = `news:research:${desk.id}:${ny.date}:${ny.hour}`;
    if (await cacheGet(key)) continue;
    await cacheSet(key, "1", 20 * 3_600_000);
    const items = await researchDesk(desk).catch(() => []);
    report.newItems += await insertItems(items).catch(() => 0);
    report.researched++;
    done++;
  }
}

export async function tick(origin: string, budgetMs = 250_000): Promise<TickReport> {
  const started = Date.now();
  const report: TickReport = { ms: 0, fetched: 0, failed: 0, newItems: 0, clustered: 0, newStories: 0, enriched: 0, merged: 0, alerts: 0, briefs: 0, delivered: 0, researched: 0, radars: 0, pruned: false, errors: [] };
  if (await cacheGet("news:tick-lock")) { report.errors.push("another pass is running"); return report; }
  await cacheSet("news:tick-lock", String(started), Math.min(budgetMs + 30_000, 300_000));
  const at = (share: number) => started + budgetMs * share;
  // Each stage has its own end, and at least a minimum share even when an earlier stage ran long.
  const until = (share: number, min: number) => Math.max(at(share), Date.now() + budgetMs * min);
  try {
    await ingest(at(0.3), report).catch((e) => report.errors.push(`ingest: ${e instanceof Error ? e.message.slice(0, 120) : e}`));
    await clusterNew(until(0.52, 0.18), report).catch((e) => report.errors.push(`cluster: ${e instanceof Error ? e.message.slice(0, 120) : e}`));
    await enrichTop(until(0.7, 0.14), report).catch((e) => report.errors.push(`enrich: ${e instanceof Error ? e.message.slice(0, 120) : e}`));
    report.merged = await mergeDuplicates().catch((e) => { report.errors.push(`merge: ${e instanceof Error ? e.message.slice(0, 120) : e}`); return 0; });
    const users = await newsUsers().catch(() => [] as string[]);
    const alertsEnd = until(0.8, 0.06);
    for (const u of users) { if (Date.now() > alertsEnd) break; report.alerts += await alertsFor(u, origin).catch(() => 0); }
    await briefs(users, origin, until(0.92, 0.06), report).catch((e) => report.errors.push(`briefs: ${e instanceof Error ? e.message.slice(0, 120) : e}`));
    await research(users, until(0.97, 0.03), report).catch((e) => report.errors.push(`research: ${e instanceof Error ? e.message.slice(0, 120) : e}`));
    report.radars = await warmRadars(until(0.99, 0.08)).catch((e) => { report.errors.push(`radar: ${e instanceof Error ? e.message.slice(0, 120) : e}`); return 0; });
    const ny = localParts(new Date(), "America/New_York");
    const pruneKey = `news:pruned:${ny.date}`;
    if (ny.hour >= 3 && !(await cacheGet(pruneKey))) { await prune().catch(() => undefined); await cacheSet(pruneKey, "1", 2 * 86_400_000); report.pruned = true; }
  } finally {
    await cacheSet("news:tick-lock", "", 1).catch(() => undefined);
  }
  report.ms = Date.now() - started;
  return report;
}

export { allDesks };
