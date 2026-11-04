/**
 * The command palette's ranking (⌘K anywhere in the app). Pure, so it is tested on its own
 * (scripts/test-palette.ts): each command has a label, a group and some words it also answers to; a
 * query ranks them by how well it matches, best first. A query that looks like a ticker also offers to
 * open it, and any query can be asked of the AI.
 */

export type PaletteGroup = "Recent" | "Go to" | "Pages" | "Tools" | "Ask" | "Home" | "Style" | "Look" | "Features" | "Settings" | "App" | "People" | "Deals";

export type PaletteItem = {
  id: string;
  label: string;
  group: PaletteGroup;
  icon: string;
  /** Shown beside the label, muted. */
  hint?: string;
  /** Other words it answers to (not shown). */
  keywords?: string;
  /** Where it goes, for a command that is a link. */
  href?: string;
  /** Shown as current (a ticked style, the layout in use). */
  on?: boolean;
};

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");

/**
 * How well `q` matches `item`, 0 for not at all. Whole label first, then the start of the label, the
 * start of a word, a substring, the keywords, and last the initials of words in a row ("wcf" finds
 * "13-week cash flow").
 */
export function score(item: Pick<PaletteItem, "label" | "keywords" | "hint" | "group">, q: string): number {
  const query = norm(q.trim());
  if (!query) return 0;
  const label = norm(item.label);
  if (label === query) return 100;
  if (label.startsWith(query)) return 80 - Math.min(20, label.length - query.length) / 2;
  const words = label.split(/[^a-z0-9]+/).filter(Boolean);
  const terms = query.split(/\s+/).filter(Boolean);
  // Every word of the query starts a word of the label: "cash flow" finds "13-week cash flow engine".
  if (terms.every((t) => words.some((w) => w.startsWith(t)))) return 60 - Math.min(10, words.length);
  if (label.includes(query)) return 45;
  const extra = norm(`${item.keywords ?? ""} ${item.hint ?? ""} ${item.group}`);
  if (terms.every((t) => label.includes(t) || extra.split(/[^a-z0-9]+/).some((w) => w.startsWith(t)))) return 30;
  // The initials of words in a row: "wcf" finds "13-week cash flow", "dcf" "Discounted cash flow".
  if (query.length >= 2 && !query.includes(" ") && words.map((w) => w[0]).join("").includes(query)) return 20;
  return 0;
}

/** Up to `limit` items ranked for `q`; with no query, the given order. Stable for equal scores. */
export function rank<T extends PaletteItem>(items: T[], q: string, limit = 40): T[] {
  if (!q.trim()) return items.slice(0, limit);
  return items
    .map((it, i) => ({ it, i, s: score(it, q) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.it)
    .slice(0, limit);
}

/** A query that reads as a ticker: AAPL, brk.b, rds-a. Not a common English word typed in lower case. */
const NOT_TICKERS = new Set(["a", "i", "the", "and", "or", "to", "of", "in", "on", "go", "new", "home", "desk", "news", "help", "ask", "tool", "tools", "style", "dark", "light", "focus"]);
export function asTicker(q: string): string | null {
  const t = q.trim();
  if (!/^[A-Za-z]{1,5}([.-][A-Za-z]{1,2})?$/.test(t)) return null;
  if (t !== t.toUpperCase() && NOT_TICKERS.has(t.toLowerCase())) return null;
  return t.toUpperCase();
}

/**
 * Two to four tickers to compare: "snow vs mdb", "SNOW, MDB and DDOG", "nvda & amd". Null for anything
 * else, including a single ticker or a sentence.
 */
export function asComparison(q: string): string[] | null {
  // Separators need spaces around them ("M&A", "S&P", "AT&T" are names, not comparisons); a comma needs none.
  const text = q.trim();
  const saidVs = /\s(vs\.?|versus)\s/i.test(` ${text} `);
  const parts = text.split(/\s+(?:vs\.?|versus|and|&)\s+|\s*,\s*/i).filter(Boolean);
  if (parts.length < 2 || parts.length > 4) return null;
  // Without "vs", every name needs two letters, so "pros and cons" or "a, b" do not read as tickers.
  const tickers = parts.map((p) => (/^[A-Za-z]{1,5}([.-][A-Za-z]{1,2})?$/.test(p) && (saidVs || p.replace(/[.-]/g, "").length >= 2) && !/^(pros|cons|and|or|the)$/i.test(p) ? p.toUpperCase() : null));
  if (tickers.some((t) => t === null)) return null;
  const unique = [...new Set(tickers as string[])];
  return unique.length >= 2 ? unique : null;
}

/** Recently chosen commands, newest first, without repeats, at most `max`. */
export function pushRecent(recent: string[], id: string, max = 6): string[] {
  return [id, ...recent.filter((x) => x !== id)].slice(0, max);
}
