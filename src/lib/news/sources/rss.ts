/**
 * RSS 2.0, Atom and RSS 1.0 (RDF) feeds, fetched with conditional requests (ETag, Last-Modified) so an
 * unchanged feed costs the publisher almost nothing. Headlines, links and the publisher's own summary
 * only; article text is never taken from a feed.
 */
import { XMLParser } from "fast-xml-parser";
import type { Feed } from "../desks";
import { canonicalUrl, cleanTitle, domainOf, keyOf, parseFeedDate, stripHtml, tickersIn } from "../normalize";
import { NEWS_UA, type FetchResult, type RawItem } from "../types";

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@", textNodeName: "#text", parseTagValue: false, trimValues: true, processEntities: true, htmlEntities: true });
const arr = <T,>(x: T | T[] | undefined | null): T[] => (x == null ? [] : Array.isArray(x) ? x : [x]);

/** The text of a node that may be a string, a {#text} object, or a list of either. */
export function textOf(x: unknown): string {
  if (x == null) return "";
  if (typeof x === "string" || typeof x === "number") return String(x);
  if (Array.isArray(x)) return textOf(x[0]);
  if (typeof x === "object") return textOf((x as Record<string, unknown>)["#text"]);
  return "";
}

function atomLink(links: unknown): string {
  const ls = arr(links as Record<string, string> | Record<string, string>[]);
  const alt = ls.find((l) => typeof l === "object" && (!l["@rel"] || l["@rel"] === "alternate")) ?? ls[0];
  return typeof alt === "string" ? alt : (alt as Record<string, string> | undefined)?.["@href"] ?? "";
}

type Entry = { title: string; link: string; summary: string; date: unknown; categories: string[] };

/** Entries of any of the three feed formats, oldest-format quirks included. Pure, for tests. */
export function parseFeed(xml: string): Entry[] {
  const x = parser.parse(xml) as Record<string, Record<string, unknown>>;
  const rss = x.rss?.channel as Record<string, unknown> | undefined;
  if (rss) {
    return arr(rss.item as Record<string, unknown>[]).map((i) => ({
      title: textOf(i.title),
      link: textOf(i.link) || (typeof i.guid === "object" && (i.guid as Record<string, string>)["@isPermaLink"] !== "false" ? textOf(i.guid) : typeof i.guid === "string" && /^https?:/.test(i.guid) ? i.guid : ""),
      summary: textOf(i.description) || textOf(i["content:encoded"]),
      date: i.pubDate ?? i["dc:date"] ?? i.published ?? i.updated,
      categories: arr(i.category as unknown[]).map(textOf).filter(Boolean),
    }));
  }
  const feed = x.feed as Record<string, unknown> | undefined;
  if (feed) {
    return arr(feed.entry as Record<string, unknown>[]).map((e) => ({
      title: textOf(e.title), link: atomLink(e.link), summary: textOf(e.summary) || textOf(e.content),
      date: e.published ?? e.updated, categories: arr(e.category as Record<string, string>[]).map((c) => (typeof c === "object" ? c["@term"] ?? c["@label"] ?? "" : String(c))).filter(Boolean),
    }));
  }
  const rdf = x["rdf:RDF"] as Record<string, unknown> | undefined;
  if (rdf) {
    return arr(rdf.item as Record<string, unknown>[]).map((i) => ({ title: textOf(i.title), link: textOf(i.link), summary: textOf(i.description), date: i["dc:date"], categories: [] }));
  }
  return [];
}

export async function fetchRss(feed: Feed, state: { etag?: string; lastModified?: string }, now = new Date()): Promise<FetchResult> {
  // SEC asks every automated client for a contact address, its own feeds included.
  const ua = /(^|\.)sec\.gov$/i.test(new URL(feed.url).hostname) ? (process.env.EDGAR_USER_AGENT ?? NEWS_UA) : NEWS_UA;
  const headers: Record<string, string> = { "User-Agent": ua, Accept: "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5" };
  if (state.etag) headers["If-None-Match"] = state.etag;
  if (state.lastModified) headers["If-Modified-Since"] = state.lastModified;
  let res: Response;
  try {
    res = await fetch(feed.url, { headers, cache: "no-store", redirect: "follow", signal: AbortSignal.timeout(12_000) });
  } catch (e) {
    return { status: "error", items: [], error: e instanceof Error ? e.message : "fetch failed" };
  }
  if (res.status === 304) return { status: "not-modified", items: [], etag: state.etag, lastModified: state.lastModified };
  if (!res.ok) return { status: "error", items: [], error: `HTTP ${res.status}` };
  let entries: Entry[];
  try { entries = parseFeed(await res.text()); } catch (e) { return { status: "error", items: [], error: `unreadable feed: ${e instanceof Error ? e.message : ""}`.slice(0, 200) }; }
  const items: RawItem[] = [];
  for (const e of entries.slice(0, 60)) {
    const title = cleanTitle(e.title);
    if (!title || !/^https?:\/\//.test(e.link)) continue;
    const url = canonicalUrl(e.link);
    const snippet = stripHtml(e.summary, 420);
    items.push({
      key: keyOf(url), url, title, snippet: snippet === title ? "" : snippet, source: feed.name, domain: domainOf(url), kind: feed.kind,
      publishedAt: parseFeedDate(e.date, now), tags: feed.tags, tickers: tickersIn(`${title} ${snippet}`), tier: feed.tier,
      meta: { feed: feed.id, ...(e.categories.length ? { categories: e.categories.slice(0, 6) } : {}) },
    });
  }
  return { status: "ok", items, etag: res.headers.get("etag") ?? "", lastModified: res.headers.get("last-modified") ?? "" };
}
