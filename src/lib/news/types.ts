import type { ItemKind, Tag, Tier } from "./desks";
import { siteUrl } from "@/lib/site";

/** One thing a source reported, before it is stored and clustered. */
export type RawItem = {
  /** Stable identity: the canonical URL's hash, or "sec:<accession>" for a filing. */
  key: string;
  url: string;
  title: string;
  snippet: string;
  /** Publisher or registry, as a reader would name it ("Bloomberg", "SEC EDGAR"). */
  source: string;
  domain: string;
  kind: ItemKind;
  publishedAt: Date;
  tags: Tag[];
  tickers: string[];
  tier: Tier;
  meta: Record<string, unknown>;
};

export type FetchResult = { status: "ok" | "not-modified" | "error"; items: RawItem[]; etag?: string; lastModified?: string; error?: string };

/** The User-Agent for feeds and open pages, in the "compatible" form crawlers use (some publishers refuse bare bot strings), still naming YouBank and a contact page. */
export const NEWS_UA = `Mozilla/5.0 (compatible; YouBankNews/1.0; +${siteUrl()})`;
