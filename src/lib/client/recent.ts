/**
 * Where the person has been (Home's "Jump back in"): the last pages, tools and tickers they opened, in
 * this browser only (localStorage), newest first, one entry per place. The labelling is pure and tested
 * (scripts/test-recent.ts); reading and writing tolerate a browser that refuses storage.
 */
export type Visit = { href: string; label: string; icon: string; at: number };
export const RECENT_KEY = "yb-recent-pages";
export const RECENT_MAX = 12;

type Feature = { href: string; label: string; icon: string };
type Tool = { id: string; title: string; icon: string };

/** A visit for `path` + `search`, or null for places not worth returning to (Home itself, settings, sign-in). */
export function visitFor(path: string, search: string, features: Feature[], tools: Tool[], at: number): Visit | null {
  if (!path.startsWith("/app") || path === "/app" || path.startsWith("/app/settings") || path.startsWith("/app/profile")) return null;
  const q = new URLSearchParams(search);
  const tool = /^\/app\/tools\/([\w-]+)$/.exec(path);
  if (tool) { const t = tools.find((x) => x.id === tool[1]); return t ? { href: path, label: t.title, icon: t.icon, at } : null; }
  if (path === "/app/terminal") {
    const ticker = (q.get("ticker") ?? "").toUpperCase();
    if (/^[A-Z][A-Z0-9.-]{0,9}$/.test(ticker)) return { href: `/app/terminal?ticker=${ticker}`, label: `${ticker} in the terminal`, icon: "Terminal", at };
  }
  const f = [...features].sort((a, b) => b.href.length - a.href.length).find((x) => path === x.href || path.startsWith(`${x.href}/`));
  if (!f) return null;
  const tab = q.get("tab");
  const sub = path !== f.href ? decodeURIComponent(path.slice(f.href.length + 1)).replace(/[-_/]+/g, " ").slice(0, 40) : tab ? tab.replace(/[-_]+/g, " ") : "";
  const href = `${path}${tab ? `?tab=${encodeURIComponent(tab)}` : ""}`;
  return { href, label: sub ? `${f.label} · ${sub}` : f.label, icon: f.icon, at };
}

/** The list with `v` first, without its earlier entry, at most RECENT_MAX. */
export const pushVisit = (list: Visit[], v: Visit) => [v, ...list.filter((x) => x.href !== v.href)].slice(0, RECENT_MAX);

export function readVisits(): Visit[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as unknown;
    return Array.isArray(v) ? v.filter((x): x is Visit => !!x && typeof x.href === "string" && x.href.startsWith("/app") && !x.href.startsWith("//") && typeof x.label === "string").slice(0, RECENT_MAX) : [];
  } catch { return []; }
}
export function recordVisit(v: Visit): void {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(pushVisit(readVisits(), v))); } catch { /* storage refused: nothing to remember */ }
}
