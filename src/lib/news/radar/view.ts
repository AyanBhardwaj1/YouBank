/**
 * A radar as the screen reads it: the sector's lanes, its deals of the last month, and the map of
 * where things are happening. The map counts the places the lanes name (a trial's countries, the
 * states in a bank application, a trade case's exporters) and the places named in the week's stories
 * for the sector; flows are movements the sources state outright (exporters to the US, one state's
 * bank buying another's, where a recalled product was made).
 */
import { and, desc, gte, sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { recentDeals } from "../deals";
import { SECTOR_KEYS, SECTOR_LABEL, SECTOR_OF, type SectorKey } from "../desks";
import { readerFor } from "../reader";
import { isSectorRadar, radarLanes, RADARS, type RadarLane } from "./index";
import { PLACE_BY_ID, placesIn, project, type PlaceKind } from "./places";

export type MapItem = { title: string; url?: string; clusterId?: number; source: string };
export type MapPoint = { id: string; name: string; x: number; y: number; kind: PlaceKind; us: boolean; count: number; items: MapItem[] };
export type MapFlow = { from: string; to: string; count: number };
export type RadarMap = { points: MapPoint[]; flows: MapFlow[] };

/** Regions inside the United States, shown on the US map and folded into it on the world map. */
const US_REGIONS = new Set(["r:permian", "r:gulf"]);
const isUs = (id: string) => id.startsWith("us:") || US_REGIONS.has(id);

/** Places and flows from lanes and stories. Pure, for tests. */
export function radarMap(lanes: RadarLane[], stories: { id: number; headline: string; text: string }[]): RadarMap {
  const acc = new Map<string, { count: number; items: MapItem[] }>();
  const add = (id: string, item: MapItem) => {
    if (!PLACE_BY_ID.has(id)) return;
    const a = acc.get(id) ?? { count: 0, items: [] };
    a.count++;
    if (a.items.length < 6 && !a.items.some((i) => i.title === item.title)) a.items.push(item);
    acc.set(id, a);
  };
  const flows = new Map<string, MapFlow>();
  for (const lane of lanes) for (const e of lane.entries) {
    for (const id of e.places) add(id, { title: e.title, url: e.url, source: e.source });
    for (const from of e.flow?.from ?? []) {
      const k = `${from}>${e.flow!.to}`;
      const f = flows.get(k) ?? { from, to: e.flow!.to, count: 0 };
      f.count++;
      flows.set(k, f);
    }
  }
  for (const s of stories) for (const id of placesIn(s.text)) add(id, { title: s.headline, clusterId: s.id, source: "News" });
  const points = [...acc.entries()].map(([id, a]) => {
    const p = PLACE_BY_ID.get(id)!;
    return { id, name: p.name, ...project(p.lat, p.lon), kind: p.kind, us: isUs(id), count: a.count, items: a.items };
  }).sort((a, b) => b.count - a.count);
  return { points, flows: [...flows.values()].filter((f) => PLACE_BY_ID.has(f.from) && PLACE_BY_ID.has(f.to)).sort((a, b) => b.count - a.count).slice(0, 40) };
}

export type SectorOption = { id: SectorKey; label: string };
type Common = { sectors: SectorOption[]; own: SectorKey; chosen: string };
export type SectorRadarView = Common & {
  kind: "sector"; sector: SectorKey; title: string; blurb: string; region: "world" | "us"; builtAt: string;
  lanes: RadarLane[]; deals: Awaited<ReturnType<typeof recentDeals>>; map: RadarMap;
};
export type TechRadarView = Common & { kind: "tech"; sector: "tech"; title: string; blurb: string } & Awaited<ReturnType<typeof techRadar>>;
export type RadarScreen = SectorRadarView | TechRadarView;

/** The tech radar's lists, from the items the pass already gathers. */
export async function techRadar() {
  const since = new Date(Date.now() - 8 * 86_400_000);
  const rows = await requireDb().select().from(schema.newsItems).where(and(gte(schema.newsItems.publishedAt, since), sql`${schema.newsItems.kind} in ('paper', 'repo', 'model', 'launch')`)).orderBy(desc(schema.newsItems.publishedAt)).limit(400);
  const byWeight = (a: (typeof rows)[number], b: (typeof rows)[number]) => Number(b.meta.weight ?? 0) - Number(a.meta.weight ?? 0);
  const pick = (kind: string, n: number) => rows.filter((r) => r.kind === kind).sort(byWeight).slice(0, n).map((r) => ({ id: r.id, title: r.title, snippet: r.snippet, url: r.url, source: r.source, at: r.publishedAt.toISOString(), meta: r.meta, clusterId: r.clusterId }));
  return { papers: pick("paper", 12), repos: pick("repo", 12), models: pick("model", 10), launches: pick("launch", 12) };
}

const SECTORS: SectorOption[] = SECTOR_KEYS.map((id) => ({ id, label: SECTOR_LABEL[id] }));

/** The radar a person sees: the one they chose, else their desk's first sector, else their profile's, else technology. */
export async function radarScreen(userId: string, requested?: string): Promise<RadarScreen | null> {
  const ctx = await readerFor(userId);
  if (!ctx) return null;
  const fromProfile = ctx.profile.sectors.map((s) => SECTOR_OF[s]).find(Boolean);
  const own: SectorKey = ctx.desk.sectors[0] ?? ctx.ownDesk.sectors[0] ?? fromProfile ?? "tech";
  const chosen = ctx.prefs.radar;
  const sector: SectorKey = requested && (requested === "tech" || isSectorRadar(requested)) ? (requested as SectorKey) : chosen || own;
  const common: Common = { sectors: SECTORS, own, chosen };
  if (sector === "tech" || !isSectorRadar(sector)) {
    return { ...common, kind: "tech", sector: "tech", title: "Tech radar", blurb: "What researchers and builders are paying attention to this week, before it is news: Hugging Face daily papers and trending models, GitHub's fastest-rising repositories, and Show HN launches.", ...(await techRadar()) };
  }
  const def = RADARS[sector];
  const [build, deals, stories] = await Promise.all([
    radarLanes(sector),
    recentDeals({ days: 30, sectors: [sector], limit: 40 }).then((d) => d.filter((x) => x.kind !== "stake").slice(0, 10)).catch(() => []),
    requireDb().select({ id: schema.newsClusters.id, headline: schema.newsClusters.headline, summary: schema.newsClusters.summary }).from(schema.newsClusters)
      .where(and(gte(schema.newsClusters.updatedAt, new Date(Date.now() - 7 * 86_400_000)), sql`${schema.newsClusters.desks} @> ${JSON.stringify([sector])}::jsonb`))
      .orderBy(desc(schema.newsClusters.importance)).limit(250).catch(() => []),
  ]);
  const map = radarMap(build.lanes, stories.map((s) => ({ id: s.id, headline: s.headline, text: `${s.headline} ${(s.summary?.bullets ?? []).join(" ")}` })));
  return { ...common, kind: "sector", sector, title: def.title, blurb: def.blurb, region: def.region, builtAt: build.builtAt, lanes: build.lanes, deals, map };
}
