/**
 * Where the news is happening, for the globe: each story is placed by the places its headline,
 * summary and companies name (the radar's gazetteer, so "New Mexico" is not Mexico and "British
 * thermal units" is not Britain), then stories are gathered by place. A place's weight is the sum of
 * its stories' significance (importance, raised by breadth of coverage), which sizes its marker.
 *
 * Most US company news names no place at all ("Acme to buy Widget"); a story with a US-listed ticker or
 * an SEC filing and no other place is put in the United States, marked as inferred, so the globe does
 * not pretend all of finance happens abroad. Pure, safe on the client, tested.
 */
import { PLACE_BY_ID, placesIn } from "./radar/places";

export type GlobeStory = { id: number; headline: string; importance: number; sourceCount: number; tags: string[]; category: string; updatedAt: string };
export type GlobePoint = {
  id: string; name: string; lat: number; lon: number; kind: string;
  /** Sum of the stories' significance; sizes the marker. */
  weight: number;
  /** Stories here, most significant first (at most 8). */
  stories: GlobeStory[];
  /** Every desk tag among its stories, for the desk filter. */
  tags: string[];
  /** True when every story here was placed only because it is a US-listed company or a US filing. */
  inferred: boolean;
  /** Most recent story here (ISO). */
  latest: string;
};

/** A story's significance: importance raised a little with each doubling of outlets covering it. */
export const significance = (importance: number, sourceCount: number) => Math.max(0.05, importance) * (1 + 0.35 * Math.log2(Math.max(1, sourceCount)));

/** Places a story names, in order of mention; [] when none and nothing to infer. */
export function storyPlaces(s: { headline: string; text?: string; tickers: string[]; kinds?: string[] }): { ids: string[]; inferred: boolean } {
  const ids = placesIn(`${s.headline}. ${s.text ?? ""}`).filter((id) => PLACE_BY_ID.has(id));
  if (ids.length) return { ids: ids.slice(0, 4), inferred: false };
  if (s.tickers.length || s.kinds?.includes("filing")) return { ids: ["c:US"], inferred: true };
  return { ids: [], inferred: false };
}

/**
 * Stories gathered by place for the globe. A story naming several places counts at each (its
 * significance split between them, so a five-country roundup does not outweigh a deal). Places are
 * sorted by weight; at most `limit`.
 */
export function globePoints(stories: (GlobeStory & { text?: string; tickers: string[]; kinds?: string[] })[], limit = 160): GlobePoint[] {
  const acc = new Map<string, GlobePoint & { real: boolean }>();
  for (const s of stories) {
    const { ids, inferred } = storyPlaces(s);
    if (!ids.length) continue;
    const share = significance(s.importance, s.sourceCount) / ids.length;
    for (const id of ids) {
      const p = PLACE_BY_ID.get(id);
      if (!p) continue;
      const cur = acc.get(id) ?? { id, name: p.name.replace(" (country)", ""), lat: p.lat, lon: p.lon, kind: p.kind, weight: 0, stories: [], tags: [], inferred: true, real: false, latest: s.updatedAt };
      cur.weight += share;
      if (!inferred) cur.real = true;
      cur.inferred = !cur.real;
      const story: GlobeStory = { id: s.id, headline: s.headline, importance: s.importance, sourceCount: s.sourceCount, tags: s.tags, category: s.category, updatedAt: s.updatedAt };
      if (!cur.stories.some((x) => x.id === s.id)) cur.stories.push(story);
      for (const t of s.tags) if (!cur.tags.includes(t)) cur.tags.push(t);
      if (Date.parse(s.updatedAt) > Date.parse(cur.latest)) cur.latest = s.updatedAt;
      acc.set(id, cur);
    }
  }
  return [...acc.values()]
    .map(({ real, ...p }) => ({ ...p, inferred: !real, weight: Math.round(p.weight * 1000) / 1000, stories: p.stories.sort((a, b) => significance(b.importance, b.sourceCount) - significance(a.importance, a.sourceCount)).slice(0, 8) }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, limit);
}

/** Keep only what one desk would see: places with at least one story carrying any of `tags`, their stories filtered and reweighted. */
export function filterPoints(points: GlobePoint[], tags: string[] | null): GlobePoint[] {
  if (!tags?.length) return points;
  const want = new Set(tags);
  const out: GlobePoint[] = [];
  for (const p of points) {
    const stories = p.stories.filter((s) => s.tags.some((t) => want.has(t)));
    if (!stories.length) continue;
    out.push({ ...p, stories, weight: Math.round(stories.reduce((n, s) => n + significance(s.importance, s.sourceCount), 0) * 1000) / 1000 });
  }
  return out.sort((a, b) => b.weight - a.weight);
}

/** Marker radius in pixels: by the square root of weight against the heaviest place, 4 to 22. */
export const markerRadius = (weight: number, max: number) => 4 + 18 * Math.sqrt(Math.max(0, weight) / Math.max(max, 1e-6));
