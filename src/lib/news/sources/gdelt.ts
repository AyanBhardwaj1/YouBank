/**
 * GDELT's global news index, used only for what has no public feed: Reuters and AP headlines. GDELT
 * asks for one request per five seconds and throttles shared addresses hard, so this runs one rotating
 * query per pipeline run and backs off for half an hour whenever GDELT says to slow down.
 */
import { cacheGet, cacheSet } from "@/lib/cache";
import { GDELT_DOMAINS, GDELT_QUERIES } from "../desks";
import { canonicalUrl, cleanTitle, keyOf, tickersIn } from "../normalize";
import { NEWS_UA, type FetchResult, type RawItem } from "../types";

const PUBLISHER: Record<string, string> = { "reuters.com": "Reuters", "apnews.com": "AP" };

type Article = { url: string; title: string; seendate: string; domain: string; language?: string };

/** "20260928T181500Z" as a Date. */
export const gdeltDate = (s: string) => new Date(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(9, 11)}:${s.slice(11, 13)}:${s.slice(13, 15)}Z`);

export function gdeltItems(articles: Article[], tags: RawItem["tags"]): RawItem[] {
  return articles.filter((a) => a.url && a.title && GDELT_DOMAINS.some((d) => a.domain === d || a.domain.endsWith(`.${d}`))).map((a) => {
    const url = canonicalUrl(a.url), title = cleanTitle(a.title);
    const d = GDELT_DOMAINS.find((x) => a.domain === x || a.domain.endsWith(`.${x}`)) ?? a.domain;
    return { key: keyOf(url), url, title, snippet: "", source: PUBLISHER[d] ?? d, domain: d, kind: "article" as const, publishedAt: gdeltDate(a.seendate), tags, tickers: tickersIn(title), tier: 1 as const, meta: { via: "gdelt" } };
  });
}

export async function fetchGdelt(): Promise<FetchResult> {
  if (await cacheGet("news:gdelt:backoff")) return { status: "not-modified", items: [] };
  const turn = Number((await cacheGet("news:gdelt:turn")) ?? "0") || 0;
  const q = GDELT_QUERIES[turn % GDELT_QUERIES.length];
  await cacheSet("news:gdelt:turn", String(turn + 1), 7 * 86_400_000);
  const query = `${q.q} (${GDELT_DOMAINS.map((d) => `domainis:${d}`).join(" OR ")})`;
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?${new URLSearchParams({ query, mode: "artlist", format: "json", maxrecords: "60", timespan: "12h", sort: "datedesc" })}`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": NEWS_UA }, cache: "no-store", signal: AbortSignal.timeout(20_000) });
    const text = await res.text();
    if (!res.ok || !text.trim().startsWith("{")) {
      await cacheSet("news:gdelt:backoff", "1", 30 * 60_000);
      return { status: "error", items: [], error: /limit requests/i.test(text) ? "GDELT is throttling; backing off" : `HTTP ${res.status}` };
    }
    const j = JSON.parse(text) as { articles?: Article[] };
    return { status: "ok", items: gdeltItems(j.articles ?? [], q.tags) };
  } catch (e) {
    return { status: "error", items: [], error: e instanceof Error ? e.message : String(e) };
  }
}
