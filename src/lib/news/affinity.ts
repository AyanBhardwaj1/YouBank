/**
 * The personal front page's model: what this person reads, saves, follows and hides, turned into an
 * affinity for each desk tag (sectors and lenses), company, ticker and kind of story, so stories like
 * the ones they engage with rise and stories like the ones they hide sink.
 *
 * Deliberately simple and explainable, never a black box:
 * - each action is a weighted vote (read 1, save 3, follow 4, hide -4) for every feature of its story;
 * - votes fade with a 14-day half-life, so last month's obsession does not run this week's page;
 * - a feature's affinity is tanh(votes / 4), between -1 and 1, so a handful of reads counts and a
 *   hundred does not drown everything else;
 * - a story's learned score blends its best tag, company and category affinities, and the reason it
 *   is shown names the evidence in words ("You read 6 energy stories lately").
 * A greedy re-rank then keeps the top of the page varied (no wall of one company or one category).
 * Pure, for tests; the signals are read from news_user_items and news_follows (reader.ts).
 */
import type { NewsEntity } from "@/db/schema";
import { CATEGORY_LABEL, type Category } from "./classify";
import { LENS_LABEL, SECTOR_LABEL, type Lens, type SectorKey } from "./desks";

export type SignalKind = "read" | "save" | "follow" | "hide";
export type Signal = { kind: SignalKind; at: Date; tags: string[]; tickers: string[]; companies: string[]; category: string };

export const SIGNAL_WEIGHT: Record<SignalKind, number> = { read: 1, save: 3, follow: 4, hide: -4 };
export const HALF_LIFE_DAYS = 14;
/** Votes that make an affinity of tanh(1), about 0.76. */
const SCALE = 4;
/** Actions older than this are not read at all. */
export const WINDOW_DAYS = 60;

type Evidence = { read: number; save: number; follow: number; hide: number };
export type Feature = { key: string; label: string; affinity: number; evidence: Evidence };
export type Affinity = { features: Map<string, Feature>; signals: number };

export const EMPTY_AFFINITY: Affinity = { features: new Map(), signals: 0 };

/** "Acme Holdings, Inc." and "ACME HOLDINGS" share a key; same normalization as the ranking's network match. */
const companyKey = (name: string) => name.toLowerCase().replace(/[.,'’]/g, " ").replace(/\b(inc|incorporated|corp|corporation|co|company|ltd|limited|llc|lp|plc|holdings?|group|the|sa|nv|ag|se)\b/g, " ").replace(/\s+/g, " ").trim();

export function tagLabel(tag: string): string {
  return SECTOR_LABEL[tag as SectorKey] ?? LENS_LABEL[tag as Lens] ?? tag;
}

/** The features a story contributes: its desk tags, tickers, named companies and category. */
export function featuresOf(s: { tags: string[]; tickers: string[]; companies: string[]; category: string }): { key: string; label: string }[] {
  const out = new Map<string, string>();
  for (const t of s.tags) out.set(`tag:${t}`, tagLabel(t));
  for (const t of s.tickers) out.set(`tk:${t.toUpperCase()}`, t.toUpperCase());
  for (const c of s.companies) { const k = companyKey(c); if (k.length >= 3) out.set(`co:${k}`, c); }
  if (s.category && s.category !== "general") out.set(`cat:${s.category}`, CATEGORY_LABEL[s.category as Category] ?? s.category);
  return [...out.entries()].map(([key, label]) => ({ key, label }));
}

/** The companies a story names, for its features (people are left out: they say little about taste). */
export const companiesOf = (entities: NewsEntity[]) => entities.filter((e) => e.kind !== "person").map((e) => e.name);

/** Learn affinities from actions. `now` is passed so results are reproducible. */
export function learnAffinity(signals: Signal[], now = new Date()): Affinity {
  const votes = new Map<string, { label: string; v: number; evidence: Evidence }>();
  let used = 0;
  for (const s of signals) {
    const ageDays = (now.getTime() - s.at.getTime()) / 86_400_000;
    if (ageDays < 0 || ageDays > WINDOW_DAYS) continue;
    used++;
    const w = SIGNAL_WEIGHT[s.kind] * Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
    for (const f of featuresOf(s)) {
      const cur = votes.get(f.key) ?? { label: f.label, v: 0, evidence: { read: 0, save: 0, follow: 0, hide: 0 } };
      cur.v += w;
      // Evidence counts only the last month, so a reason never cites something long forgotten.
      if (ageDays <= 30) cur.evidence[s.kind]++;
      votes.set(f.key, cur);
    }
  }
  const features = new Map<string, Feature>();
  for (const [key, x] of votes) features.set(key, { key, label: x.label, affinity: Math.tanh(x.v / SCALE), evidence: x.evidence });
  return { features, signals: used };
}

export type Learned = { score: number; reason: string | null; top: Feature | null };

/** The sentence a learned boost shows on its card. */
export function reasonFor(f: Feature): string | null {
  const e = f.evidence;
  const kind = f.key.slice(0, f.key.indexOf(":"));
  const about = kind === "cat" ? `${f.label.toLowerCase()} stories` : kind === "tag" ? `${f.label} stories` : `stories on ${f.label}`;
  if (f.affinity > 0) {
    if (e.follow) return `You follow ${e.follow === 1 ? "a story" : `${e.follow} stories`} ${kind === "tk" || kind === "co" ? `on ${f.label}` : `like this (${f.label})`}`;
    if (e.save >= 2 || (e.save && !e.read)) return `You saved ${e.save === 1 ? "a story" : `${e.save} stories`} ${kind === "tk" || kind === "co" ? `on ${f.label}` : `like this (${f.label})`}`;
    if (e.read >= 2) return `You read ${e.read} ${about} lately`;
    if (e.read + e.save >= 1) return `You read ${about} lately`;
    return null;
  }
  if (e.hide) return `Fewer like this: you hid ${e.hide === 1 ? "a story" : `${e.hide} stories`} ${kind === "tk" || kind === "co" ? `on ${f.label}` : `about ${f.label}`}`;
  return null;
}

/**
 * How much this person's history favours a story, between -1 and 1, and the one feature most
 * responsible. Tags and categories are broad, so they count for less than a company or ticker the
 * person keeps coming back to; a strong dislike of any one feature pulls the story down.
 */
export function learnedScore(a: Affinity, s: { tags: string[]; tickers: string[]; companies: string[]; category: string }): Learned {
  if (!a.features.size) return { score: 0, reason: null, top: null };
  const hits = featuresOf(s).map((f) => a.features.get(f.key)).filter((f): f is Feature => !!f);
  if (!hits.length) return { score: 0, reason: null, top: null };
  const weight = (f: Feature) => (f.key.startsWith("tk:") || f.key.startsWith("co:") ? 1 : f.key.startsWith("tag:") ? 0.6 : 0.4);
  const pos = hits.filter((f) => f.affinity > 0).sort((x, y) => y.affinity * weight(y) - x.affinity * weight(x));
  const neg = hits.filter((f) => f.affinity < 0).sort((x, y) => x.affinity * weight(x) - y.affinity * weight(y));
  // The best feature counts in full and the second for half; the worst dislike subtracts in full.
  const up = (pos[0] ? pos[0].affinity * weight(pos[0]) : 0) + (pos[1] ? 0.5 * pos[1].affinity * weight(pos[1]) : 0);
  const down = neg[0] ? neg[0].affinity * weight(neg[0]) : 0;
  const score = Math.max(-1, Math.min(1, up + down));
  const top = score >= 0 ? pos[0] ?? null : neg[0] ?? null;
  return { score, reason: top && Math.abs(score) >= 0.15 ? reasonFor(top) : null, top };
}

/** The keys diversity looks at: a story's category, its lead company (ticker or name) and its first sector. */
export type Diverse = { id: number; score: number; category: string; tickers: string[]; names?: string[]; desks: string[] };

/**
 * Keep the top of the page varied: walk the first `window` stories in score order and, at each slot,
 * take the best remaining story after a penalty for repeating what is already above it (the same lead
 * company -25%, the same category -10% for each one beyond the second, the same sector -5% each beyond
 * the third). Stories below the window keep their order. Pure.
 */
export function diversify<T extends Diverse>(stories: T[], window = 40): T[] {
  const head = stories.slice(0, window), tail = stories.slice(window);
  const picked: T[] = [];
  const cats = new Map<string, number>(), leads = new Set<string>(), sectors = new Map<string, number>();
  const leadOf = (s: T) => s.tickers[0] ?? (s.names?.[0] ? companyKey(s.names[0]) : "");
  const SECTORS = new Set(Object.keys(SECTOR_LABEL));
  const sectorOf = (s: T) => s.desks.find((d) => SECTORS.has(d)) ?? "";
  while (head.length) {
    let best = 0, bestScore = -Infinity;
    for (let i = 0; i < head.length; i++) {
      const s = head[i];
      const lead = leadOf(s), sector = sectorOf(s);
      let k = 1;
      if (lead && leads.has(lead)) k -= 0.25;
      k -= 0.1 * Math.max(0, (cats.get(s.category) ?? 0) - 1);
      if (sector) k -= 0.05 * Math.max(0, (sectors.get(sector) ?? 0) - 2);
      const adj = s.score * Math.max(0.4, k);
      if (adj > bestScore) { bestScore = adj; best = i; }
    }
    const [s] = head.splice(best, 1);
    picked.push(s);
    cats.set(s.category, (cats.get(s.category) ?? 0) + 1);
    const lead = leadOf(s), sector = sectorOf(s);
    if (lead) leads.add(lead);
    if (sector) sectors.set(sector, (sectors.get(sector) ?? 0) + 1);
  }
  return [...picked, ...tail];
}

/** What the person's page has learned, strongest first, for Settings and the "why" panel. */
export function topFeatures(a: Affinity, n = 6): { liked: Feature[]; avoided: Feature[] } {
  const all = [...a.features.values()];
  return {
    liked: all.filter((f) => f.affinity >= 0.2).sort((x, y) => y.affinity - x.affinity).slice(0, n),
    avoided: all.filter((f) => f.affinity <= -0.2).sort((x, y) => x.affinity - y.affinity).slice(0, n),
  };
}
