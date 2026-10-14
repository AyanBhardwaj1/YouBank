/**
 * Wikipedia attention (E3): daily page views of the company's English article (the title comes from the
 * crosswalk's Wikidata link), summed by week. Wikimedia's analytics data is released CC0 (per the
 * pageviews API documentation; confirm before launch copy). Two years are read at once, so the change
 * detector has a history from the first day. Parsing is pure.
 */
import { fetchJson } from "../../entities/http";
import { weekOf } from "../../series/change";

export const pageviewsUrl = (title: string, from: string, to: string) =>
  `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/${encodeURIComponent(title.replace(/ /g, "_"))}/daily/${from.replace(/-/g, "")}00/${to.replace(/-/g, "")}00`;

/** Daily items as weekly sums (Monday weeks); the current, unfinished week is left out. Pure. */
export function weeklyViews(json: unknown, today = new Date()): { period: string; value: number }[] {
  const items = ((json as { items?: { timestamp?: string; views?: number }[] })?.items ?? []);
  const by = new Map<string, number>();
  for (const it of items) {
    const ts = it.timestamp ?? "";
    if (!/^\d{8}/.test(ts) || typeof it.views !== "number") continue;
    const w = weekOf(`${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}`);
    by.set(w, (by.get(w) ?? 0) + it.views);
  }
  const current = weekOf(today);
  return [...by.entries()].filter(([w]) => w < current).sort(([a], [b]) => a.localeCompare(b)).map(([period, value]) => ({ period, value }));
}

export async function readViews(title: string, years = 2): Promise<{ points: { period: string; value: number }[]; url: string }> {
  const to = new Date(), from = new Date(to.getTime() - years * 365 * 86_400_000);
  const url = pageviewsUrl(title, from.toISOString().slice(0, 10), to.toISOString().slice(0, 10));
  const json = await fetchJson<unknown>(url, { timeoutMs: 20_000, gapMs: 200 });
  return { points: weeklyViews(json, to), url: `https://pageviews.wmcloud.org/?project=en.wikipedia.org&pages=${encodeURIComponent(title)}` };
}
