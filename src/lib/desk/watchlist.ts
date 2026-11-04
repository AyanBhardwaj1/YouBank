/**
 * The person's own watchlist (profiles.extra.watchlist). Until they change it, the watchlist is the one
 * their role and specialty suggest (src/lib/roles.ts); once they add or remove a name, theirs replaces it
 * everywhere the app reads `config.watchlist`: Home, the terminal's tape and rail, comps, the palette.
 * Pure.
 */
export const WATCHLIST_MAX = 30;

/** A ticker as stored: upper case, letters and digits with at most one . or - class suffix (BRK.B, RDS-A). */
export function asTicker(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim().toUpperCase().replace(/^\$/, "");
  return /^[A-Z][A-Z0-9]{0,9}([.-][A-Z0-9]{1,3})?$/.test(t) ? t : null;
}

/** A stored list, cleaned: valid tickers once each, in order, at most WATCHLIST_MAX. Null when there is no list of the person's own. */
export function normalizeWatchlist(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const out: string[] = [];
  for (const x of raw) { const t = asTicker(x); if (t && !out.includes(t)) out.push(t); }
  return out.slice(0, WATCHLIST_MAX);
}

/** Tickers typed together ("aapl, msft nvda;$TSLA"), as a list of valid ones and the words that were not. */
export function parseTickers(text: string): { tickers: string[]; rejected: string[] } {
  const tickers: string[] = [], rejected: string[] = [];
  for (const w of text.split(/[\s,;]+/).filter(Boolean)) { const t = asTicker(w); if (t) { if (!tickers.includes(t)) tickers.push(t); } else rejected.push(w); }
  return { tickers, rejected };
}

export const addTickers = (list: string[], add: string[]) => [...list, ...add.filter((t) => !list.includes(t))].slice(0, WATCHLIST_MAX);
export const removeTicker = (list: string[], t: string) => list.filter((x) => x !== t);
export function moveTicker(list: string[], t: string, by: -1 | 1): string[] {
  const i = list.indexOf(t), j = i + by;
  if (i < 0 || j < 0 || j >= list.length) return list;
  const out = [...list];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

/* ---------------- Starred tools ---------------- */

export const STARRED_MAX = 24;
/** Starred tool ids (profiles.extra.starredTools), cleaned: catalogue-shaped ids once each, newest kept. */
export function normalizeStarred(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const x of raw) if (typeof x === "string" && /^[a-z0-9][a-z0-9-]{0,79}$/.test(x) && !out.includes(x)) out.push(x);
  return out.slice(-STARRED_MAX);
}
export const toggleStar = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : normalizeStarred([...list, id]));
