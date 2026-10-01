/**
 * The Edge feed: every finding that touches what a person watches (their own watches, their team's) and
 * what is trending across Edge (how many people watch it, never who), ranked by a blend of four signals
 * each person can tune: relevance to their watches, size of the change, novelty (not yet in the news)
 * and confidence. Recent findings lead; history goes back twelve months.
 */
import { sql, type SQL } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { memo } from "@/lib/memo";
import type { Blend } from "./access";
import { trailFor } from "./provenance";
import type { Bbox } from "./sources/eia";
import type { Watch } from "./watches";

export type Scope = "mine" | "team" | "trending";
export type Signals = { relevance: number; size: number; novelty: number; confidence: number };
export type CardSource = { name: string; url: string; license: string; method: string; modelVersion: string; retrievedAt: string };
export type EdgeCard = {
  id: number; kind: string; module: string; title: string; summary: string; why: string;
  confidence: number; magnitude: number; tickers: string[]; bbox: Bbox | null; visual: Record<string, unknown>;
  observedAt: string | null; detectedAt: string;
  scope: Scope; reasons: string[]; score: number; signals: Signals; sources: CardSource[];
};

type Row = typeof schema.edgeDetections.$inferSelect;
const DAY = 86_400_000;

const overlaps = (a: Bbox, b: Bbox) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];

/** The watches a finding matches: a watched company among its tickers, or a watched place it lies in. Pure. */
export function matches(d: { tickers: string[]; bbox: Bbox | null }, watches: Pick<Watch, "kind" | "label" | "target" | "mine">[]) {
  return watches.filter((w) => (w.kind === "company" && !!w.target.ticker && d.tickers.includes(w.target.ticker)) || (w.kind === "place" && !!w.target.bbox && !!d.bbox && overlaps(d.bbox, w.target.bbox)));
}

/** How big a finding is, 0 to 1: hectares of ground for a change, the stored score for a pro-forma. Pure. */
export function sizeOf(kind: string, magnitude: number): number {
  if (kind === "ground_change") return Math.min(1, magnitude / 5);
  return Math.max(0, Math.min(1, magnitude));
}

/** Satellite changes are rarely in the news; a deal is, though not its map; a filing is public, its edits rarely reported. Fades over a month. Pure. */
export function noveltyOf(kind: string, ageDays: number): number {
  const base = kind === "ground_change" ? 0.9 : kind === "deal_proforma" ? 0.45 : kind === "filing_change" ? 0.7 : 0.6;
  return base * (0.5 + 0.5 * Math.exp(-ageDays / 30));
}

/** The blended score: the weighted mean of the signals, faded by age over about six weeks. Pure. */
export function score(s: Signals, blend: Blend, ageDays: number): number {
  const w = blend.relevance + blend.size + blend.novelty + blend.confidence || 1;
  const mean = (blend.relevance * s.relevance + blend.size * s.size + blend.novelty * s.novelty + blend.confidence * s.confidence) / w;
  return Math.round(mean * (0.35 + 0.65 * Math.exp(-ageDays / 45)) * 1000) / 1000;
}

const since = (days: number) => sql`${schema.edgeDetections.detectedAt} > now() - make_interval(days => ${days})`;

/** Findings that touch any of these watches (a year back), newest first. */
async function candidates(userId: string, watches: Watch[]): Promise<Row[]> {
  const tickers = [...new Set(watches.filter((w) => w.kind === "company" && w.target.ticker).map((w) => w.target.ticker!))];
  const boxes = watches.filter((w) => w.kind === "place" && w.target.bbox).map((w) => w.target.bbox!);
  const any: SQL[] = [];
  if (tickers.length) any.push(sql`${schema.edgeDetections.tickers} ?| array[${sql.join(tickers.map((t) => sql`${t}`), sql`, `)}]::text[]`);
  for (const [x0, y0, x1, y1] of boxes) {
    any.push(sql`(${schema.edgeDetections.bbox} is not null and (${schema.edgeDetections.bbox}->>0)::float < ${x1} and (${schema.edgeDetections.bbox}->>2)::float > ${x0} and (${schema.edgeDetections.bbox}->>1)::float < ${y1} and (${schema.edgeDetections.bbox}->>3)::float > ${y0})`);
  }
  if (!any.length) return [];
  return requireDb().select().from(schema.edgeDetections)
    .where(sql`${since(365)} and (${schema.edgeDetections.ownerId} is null or ${schema.edgeDetections.ownerId} = ${userId}) and (${sql.join(any, sql` or `)})`)
    .orderBy(sql`${schema.edgeDetections.detectedAt} desc`).limit(300);
}

/** What everyone with the beta on watches, as counts only (who watches what is never shown). Shared for five minutes. */
const watchCounts = () => memo("edge:watch-counts", 5 * 60_000, async () => {
  const rows = await requireDb().execute(sql`
    select w.kind, w.target, count(distinct w.user_id)::int as people from edge_watches w join profiles p on p.user_id = w.user_id
    where p.extra->'edge'->>'beta' = 'true' group by w.kind, w.target`);
  return (rows.rows as { kind: string; target: Watch["target"]; people: number }[]);
});

/** Public findings from the last month, for trending. Shared for five minutes. */
const recentPublic = () => memo("edge:recent-public", 5 * 60_000, () => requireDb().select().from(schema.edgeDetections)
  .where(sql`${since(30)} and ${schema.edgeDetections.ownerId} is null`).orderBy(sql`${schema.edgeDetections.detectedAt} desc`).limit(200));

/** A finding as a feed card, scored with the person's blend (sources are added per page). */
function cardOf(d: Row, scope: Scope, relevance: number, reasons: string[], blend: Blend, now: number): Omit<EdgeCard, "sources"> {
  const ageDays = Math.max(0, (now - (d.observedAt ?? d.detectedAt).getTime()) / DAY);
  const signals: Signals = { relevance, size: sizeOf(d.kind, d.magnitude), novelty: noveltyOf(d.kind, ageDays), confidence: d.confidence };
  return {
    id: d.id, kind: d.kind, module: d.module, title: d.title, summary: d.summary, why: d.why, confidence: d.confidence, magnitude: d.magnitude,
    tickers: d.tickers, bbox: d.bbox, visual: d.visual, observedAt: d.observedAt?.toISOString() ?? null, detectedAt: d.detectedAt.toISOString(),
    scope, reasons, signals, score: score(signals, blend, ageDays),
  };
}

/** Cards with their provenance trail. */
async function withSources(page: Omit<EdgeCard, "sources">[]): Promise<EdgeCard[]> {
  const trail = await trailFor(page.map((c) => `detection:${c.id}`));
  return page.map((c) => ({
    ...c,
    sources: trail.filter((t) => t.subject === `detection:${c.id}`).map((t) => ({ name: t.sourceName, url: t.sourceUrl, license: t.license, method: t.method, modelVersion: t.modelVersion, retrievedAt: t.retrievedAt.toISOString() })),
  }));
}

/** Everything found about one company that the person may see (public findings and their own), newest first. */
export async function companyCards(userId: string, ticker: string, watches: Watch[], blend: Blend, limit = 8): Promise<EdgeCard[]> {
  const now = Date.now();
  const rows = await requireDb().select().from(schema.edgeDetections)
    .where(sql`${since(365)} and (${schema.edgeDetections.ownerId} is null or ${schema.edgeDetections.ownerId} = ${userId}) and ${schema.edgeDetections.tickers} ? ${ticker}`)
    .orderBy(sql`${schema.edgeDetections.detectedAt} desc`).limit(Math.max(1, Math.min(40, limit)));
  return withSources(rows.map((d) => {
    const mine = matches(d, watches).filter((w) => w.mine);
    return cardOf(d, mine.length ? "mine" : "trending", mine.length ? 1 : 0.5, mine.length ? [`You watch ${mine[0].label}`] : [], blend, now);
  }));
}

export async function edgeFeed(userId: string, watches: Watch[], blend: Blend, opts: { scope?: Scope | "all"; offset?: number; limit?: number } = {}): Promise<{ cards: EdgeCard[]; counts: Record<Scope, number>; total: number }> {
  const now = Date.now();
  const [own, pool, counts] = await Promise.all([candidates(userId, watches), recentPublic(), watchCounts()]);
  const scored = new Map<number, Omit<EdgeCard, "sources">>();
  const toCard = (d: Row, scope: Scope, relevance: number, reasons: string[]) => cardOf(d, scope, relevance, reasons, blend, now);
  for (const d of own) {
    const hit = matches(d, watches);
    if (!hit.length) continue;
    const mine = hit.filter((w) => w.mine);
    const best = mine.find((w) => w.kind === "company") ?? mine[0] ?? hit[0];
    const relevance = best.mine ? (best.kind === "company" ? 1 : 0.85) : 0.6;
    const reasons = hit.slice(0, 3).map((w) => w.mine ? (w.kind === "company" ? `You watch ${w.label}` : `In ${w.label}, which you watch`) : `Your team watches ${w.label}`);
    scored.set(d.id, toCard(d, mine.length ? "mine" : "team", relevance, reasons));
  }
  for (const d of pool) {
    if (scored.has(d.id)) continue;
    const people = counts.filter((c) => matches(d, [{ kind: c.kind as Watch["kind"], label: "", target: c.target, mine: false }]).length).reduce((s, c) => s + c.people, 0);
    if (!people) continue;
    scored.set(d.id, toCard(d, "trending", Math.min(0.8, 0.2 + 0.06 * people), [`Trending: ${people} ${people === 1 ? "person watches" : "people watch"} this across Edge`]));
  }
  const all = [...scored.values()];
  const tally: Record<Scope, number> = { mine: 0, team: 0, trending: 0 };
  for (const c of all) tally[c.scope]++;
  const scope = opts.scope ?? "all";
  const chosen = all.filter((c) => scope === "all" || c.scope === scope).sort((a, b) => b.score - a.score || b.detectedAt.localeCompare(a.detectedAt));
  const offset = Math.max(0, opts.offset ?? 0), limit = Math.max(1, Math.min(40, opts.limit ?? 20));
  const cards = await withSources(chosen.slice(offset, offset + limit));
  return { cards, counts: tally, total: chosen.length };
}
