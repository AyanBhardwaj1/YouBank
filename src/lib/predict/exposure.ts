/**
 * From markets to holdings: which open markets touch what a person holds (the Book's event exposure), and the
 * per-ticker view other features read (predictSignalsFor: Edge, Home, MCP). Pure: callers pass the markets
 * (./store.ts loads them) and the positions.
 */
import { mapMarket, touched, validTicker, type Dir, type Mapping } from "./mapping";
import { features, matchScore, MATCH_MIN, type Features } from "./match";
import { marketLabel } from "./normalize";
import { FINANCE_CATEGORIES } from "./categories";
import type { Market, Venue } from "./types";

/** A market's link to one ticker. */
export type TickerEvent = {
  ticker: string;
  key: string; venue: Venue; label: string; url: string;
  prob: number; change24h: number | null; closeTime: string | null;
  /** How the ticker tends to move as YES becomes more likely: 1 up, -1 down, 0 mixed. */
  dir: Dir;
  why: string;
  /** "named in the question", a rule's sector name, or "suggested by the AI". */
  via: string;
  /** The day's move in the ticker's favour: dir x change24h (positive: the market moved toward what helps it). Null when unknown or mixed. */
  pressure: number | null;
  volume24h: number | null;
};

/** Markets a ticker list should consider: open, priced, real money, macro or company categories, some trading. */
export const relevant = (m: Market) => m.status === "open" && m.prob !== null && m.realMoney && FINANCE_CATEGORIES.includes(m.category) && (m.volume24h ?? m.volume ?? 0) > 0;

/** The mapping of each market, computed once per list (the rules are cheap, but lists are long). */
export function mappings(markets: Market[], cache = new Map<string, Mapping>()): Map<string, Mapping> {
  for (const m of markets) if (!cache.has(m.key)) cache.set(m.key, mapMarket(m));
  return cache;
}

/**
 * For each ticker, the open prediction markets that move it, strongest first: named in the question before
 * rules, then by how much the market moved in a day and how much it trades. At most `perTicker` each.
 *
 *   predictSignalsFor(["JPM", "NVDA"], markets) → { JPM: [{ label: "Fed decision in December 2026?: Cut 25bps", prob: 0.62, dir: 0, … }], NVDA: […] }
 *
 * Pure: `markets` comes from loadMarkets() (./store.ts) or any list of normalised markets. Tickers that
 * are not tickers ("CPI", "$$$") are dropped.
 */
export function predictSignalsFor(tickers: string[], markets: Market[], opts: { perTicker?: number; maps?: Map<string, Mapping> } = {}): Record<string, TickerEvent[]> {
  const want = new Set(tickers.map((t) => validTicker(t)).filter((t): t is string => !!t));
  const out: Record<string, TickerEvent[]> = {};
  for (const t of want) out[t] = [];
  if (!want.size) return out;
  const maps = mappings(markets.filter(relevant), opts.maps);
  for (const m of markets) {
    if (!relevant(m)) continue;
    const hits = touched(maps.get(m.key)!);
    for (const [t, h] of hits) {
      if (!want.has(t)) continue;
      out[t].push({
        ticker: t, key: m.key, venue: m.venue, label: marketLabel(m), url: m.url, prob: m.prob!, change24h: m.change24h, closeTime: m.closeTime,
        dir: h.dir, why: h.why, via: h.via, pressure: m.change24h !== null && h.dir !== 0 ? Math.round(h.dir * m.change24h * 10_000) / 10_000 : null, volume24h: m.volume24h,
      });
    }
  }
  const strength = (e: TickerEvent) => (e.via === "named in the question" ? 10 : 0) + Math.abs(e.change24h ?? 0) * 20 + Math.log10(1 + (e.volume24h ?? 0)) / 2;
  const byKey = new Map(markets.map((m) => [m.key, m]));
  const feats = new Map<string, Features>();
  const feat = (m: Market) => { let f = feats.get(m.key); if (!f) { f = features(m); feats.set(m.key, f); } return f; };
  for (const t of Object.keys(out)) {
    // One per event across venues (the same question on Kalshi and Polymarket is one signal): the most traded.
    const kept: TickerEvent[] = [];
    for (const e of out[t].sort((a, b) => (b.volume24h ?? 0) - (a.volume24h ?? 0))) {
      const m = byKey.get(e.key)!;
      const dup = kept.some((k) => { const o = byKey.get(k.key)!; if (o.venue === m.venue) return false; const r = matchScore(m, o, feat(m), feat(o)); return !r.rejected && r.confidence >= MATCH_MIN; });
      if (!dup) kept.push(e);
    }
    out[t] = kept.sort((a, b) => strength(b) - strength(a)).slice(0, opts.perTicker ?? 5);
  }
  return out;
}

export type HoldingLike = { ticker: string; direction?: "long" | "short"; weight?: number | null };

/** One market's touch on the book. */
export type MarketExposure = {
  key: string; venue: Venue; label: string; url: string; prob: number; change24h: number | null; closeTime: string | null;
  positions: { ticker: string; direction: "long" | "short"; weight: number | null; dir: Dir; why: string; via: string; /** +1: YES helps this position, -1: hurts, 0: mixed. */ effect: Dir }[];
  /** Book weight (% of NAV) that YES helps minus the weight it hurts; null when no position has a weight. */
  netWeight: number | null;
  /** Weight touched at all (helps, hurts or mixed). */
  grossWeight: number | null;
};

/**
 * The book's event exposure: every open market that touches a position, with whether YES helps or hurts
 * each one (a long helped by an up-move, a short by a down-move) and the book weight on each side. Most
 * weight first, then the markets that moved most today. Pure.
 */
export function bookExposure(positions: HoldingLike[], markets: Market[], maps?: Map<string, Mapping>): MarketExposure[] {
  const held = new Map<string, HoldingLike>();
  for (const p of positions) { const t = validTicker(p.ticker); if (t && !held.has(t)) held.set(t, p); }
  if (!held.size) return [];
  const mp = mappings(markets.filter(relevant), maps);
  const out: MarketExposure[] = [];
  for (const m of markets) {
    if (!relevant(m)) continue;
    const hits = touched(mp.get(m.key)!);
    const ps: MarketExposure["positions"] = [];
    for (const [t, h] of hits) {
      const p = held.get(t);
      if (!p) continue;
      const side = p.direction === "short" ? -1 : 1;
      ps.push({ ticker: t, direction: p.direction ?? "long", weight: typeof p.weight === "number" ? p.weight : null, dir: h.dir, why: h.why, via: h.via, effect: (h.dir * side || 0) as Dir });
    }
    if (!ps.length) continue;
    const weighted = ps.filter((x) => x.weight !== null);
    out.push({
      key: m.key, venue: m.venue, label: marketLabel(m), url: m.url, prob: m.prob!, change24h: m.change24h, closeTime: m.closeTime, positions: ps,
      netWeight: weighted.length ? Math.round(weighted.reduce((s, x) => s + x.effect * (x.weight as number), 0) * 100) / 100 : null,
      grossWeight: weighted.length ? Math.round(weighted.reduce((s, x) => s + (x.weight as number), 0) * 100) / 100 : null,
    });
  }
  return out.sort((a, b) => (b.grossWeight ?? 0) - (a.grossWeight ?? 0) || Math.abs(b.change24h ?? 0) - Math.abs(a.change24h ?? 0) || b.positions.length - a.positions.length);
}

/** One sentence for an exposure: "YES helps 4.5% of your book and hurts 2.0%". Pure. */
export function exposureLine(e: MarketExposure): string {
  const help = e.positions.filter((p) => p.effect === 1), hurt = e.positions.filter((p) => p.effect === -1), mixed = e.positions.filter((p) => p.effect === 0);
  const w = (xs: typeof help) => xs.reduce((s, x) => s + (x.weight ?? 0), 0);
  const names = (xs: typeof help) => xs.map((x) => x.ticker).slice(0, 4).join(", ");
  const parts: string[] = [];
  if (help.length) parts.push(`helps ${names(help)}${w(help) ? ` (${w(help).toFixed(1)}% of your book)` : ""}`);
  if (hurt.length) parts.push(`hurts ${names(hurt)}${w(hurt) ? ` (${w(hurt).toFixed(1)}%)` : ""}`);
  if (mixed.length) parts.push(`moves ${names(mixed)} either way`);
  return parts.length ? `If this resolves yes, it ${parts.join("; ")}.` : "No position is touched.";
}
