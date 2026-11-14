/**
 * The markets browser's search, filters and sorting, shared by the API route and the page's address bar
 * (/app/predict?q=fed&venue=kalshi&cat=fed&sort=change). Pure, safe on the client.
 */
import { FINANCE_CATEGORIES } from "./categories";
import { CATEGORIES, VENUES, type Category, type Market, type Venue } from "./types";

export type Sort = "volume" | "change" | "closing" | "prob";
export const SORTS: { id: Sort; label: string }[] = [
  { id: "volume", label: "Most traded today" }, { id: "change", label: "Biggest 24h move" }, { id: "closing", label: "Closing soonest" }, { id: "prob", label: "Highest probability" },
];

export type Filters = {
  q: string;
  venues: Venue[];
  /** "finance" is the default set (macro, policy, companies, crypto, tech, energy, world); "all" is everything. */
  cat: Category | "finance" | "all";
  sort: Sort;
  /** Leave out markets that trade little: under this many dollars in 24 hours. */
  minVolume: number;
};

export const DEFAULT_FILTERS: Filters = { q: "", venues: [], cat: "finance", sort: "volume", minVolume: 0 };

const isVenue = (v: string): v is Venue => (VENUES as string[]).includes(v);
const isCat = (v: string): v is Category => (CATEGORIES as string[]).includes(v);
const isSort = (v: string): v is Sort => ["volume", "change", "closing", "prob"].includes(v);

/** Filters from URL parameters, cleaned (unknown values fall back to the defaults). Pure. */
export function parseFilters(p: URLSearchParams | Record<string, string | string[] | undefined>): Filters {
  const get = (k: string): string => {
    if (p instanceof URLSearchParams) return p.get(k) ?? "";
    const v = p[k];
    return typeof v === "string" ? v : Array.isArray(v) ? v[0] ?? "" : "";
  };
  const venues = get("venue").split(",").map((s) => s.trim().toLowerCase()).filter(isVenue);
  const cat = get("cat").toLowerCase();
  const sort = get("sort").toLowerCase();
  const minVolume = Number(get("min"));
  return {
    q: get("q").replace(/\s+/g, " ").trim().slice(0, 80),
    venues: [...new Set(venues)],
    cat: cat === "all" || cat === "finance" ? cat : isCat(cat) ? cat : "finance",
    sort: isSort(sort) ? sort : "volume",
    minVolume: Number.isFinite(minVolume) && minVolume > 0 ? Math.min(minVolume, 1e9) : 0,
  };
}

/** The filters as URL parameters, defaults left out. Pure. */
export function filtersToParams(f: Filters): URLSearchParams {
  const u = new URLSearchParams();
  if (f.q) u.set("q", f.q);
  if (f.venues.length) u.set("venue", f.venues.join(","));
  if (f.cat !== "finance") u.set("cat", f.cat);
  if (f.sort !== "volume") u.set("sort", f.sort);
  if (f.minVolume) u.set("min", String(f.minVolume));
  return u;
}

const words = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9.%$ ]+/g, " ").split(/\s+/).filter(Boolean);

/** Whether a market answers a search: every word of the query starts a word of its title, outcome, question or venue. Pure. */
export function matchesQuery(m: Pick<Market, "title" | "outcome" | "question" | "venue" | "id">, q: string): boolean {
  const terms = words(q);
  if (!terms.length) return true;
  const hay = words(`${m.title} ${m.outcome} ${m.question} ${m.venue} ${m.id}`);
  return terms.every((t) => hay.some((w) => w.startsWith(t)));
}

/** The browser's list: filtered, then sorted. Closed and resolved markets are left out. Pure. */
export function filterMarkets(markets: Market[], f: Filters, now = Date.now()): Market[] {
  const list = markets.filter((m) => m.status === "open" && m.prob !== null
    && (!f.venues.length || f.venues.includes(m.venue))
    && (f.cat === "all" || (f.cat === "finance" ? FINANCE_CATEGORIES.includes(m.category) : m.category === f.cat))
    && (!f.minVolume || (m.volume24h ?? 0) >= f.minVolume)
    && (!m.closeTime || Date.parse(m.closeTime) > now)
    && matchesQuery(m, f.q));
  const vol = (m: Market) => m.volume24h ?? (m.volume ?? 0) / 30;
  const close = (m: Market) => (m.closeTime ? Date.parse(m.closeTime) : Number.POSITIVE_INFINITY);
  const by: Record<Sort, (a: Market, b: Market) => number> = {
    volume: (a, b) => vol(b) - vol(a),
    change: (a, b) => Math.abs(b.change24h ?? 0) - Math.abs(a.change24h ?? 0) || vol(b) - vol(a),
    closing: (a, b) => close(a) - close(b) || vol(b) - vol(a),
    prob: (a, b) => (b.prob ?? 0) - (a.prob ?? 0) || vol(b) - vol(a),
  };
  return list.sort(by[f.sort]);
}
