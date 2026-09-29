/**
 * Cleaning what feeds send: canonical URLs (so one story is one key), readable titles and snippets,
 * tickers named in the text, and the word sets used to tell whether two headlines are the same story.
 * Pure functions, tested in scripts/test-news.ts.
 */
import { createHash } from "node:crypto";

const TRACKING = /^(utm_|mc_|fbclid$|gclid$|dclid$|msclkid$|cmpid$|cmp$|guccounter$|guce_|mod$|ref$|ref_src$|src$|smid$|partner$|taid$|yptr$|ncid$|soc_src$|soc_trk$|sr_share$|trk$|tpcc$|mbid$|rss$|feed$|link_source$|dicbo$|ocid$|__twitter_impression$|_hsenc$|_hsmi$)/i;

/** A URL with tracking parameters, fragments and "amp" variants removed, lowercased host. */
export function canonicalUrl(raw: string): string {
  try {
    const u = new URL(raw.trim());
    u.hash = "";
    u.hostname = u.hostname.toLowerCase().replace(/^amp\./, "www.");
    for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
    u.pathname = u.pathname.replace(/\/amp\/?$/, "/").replace(/\/+$/, "") || "/";
    if ((u.protocol === "http:" && u.port === "80") || (u.protocol === "https:" && u.port === "443")) u.port = "";
    const s = u.toString();
    return u.search ? s : s.replace(/\?$/, "");
  } catch {
    return raw.trim();
  }
}

export const keyOf = (canonical: string) => createHash("sha1").update(canonical).digest("hex").slice(0, 24);

export function domainOf(url: string): string {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; }
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", trade: "™", reg: "®", copy: "©" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Text of an HTML fragment: tags dropped, entities decoded, whitespace collapsed, cut at `max`. */
export function stripHtml(html: string, max = 420): string {
  const text = decodeEntities(String(html ?? "").replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<br\s*\/?>/gi, " ").replace(/<\/p>/gi, " ").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max - 40))}…`;
}

/** A headline without the publisher's name tacked on, entities decoded, whitespace collapsed. */
export function cleanTitle(raw: string): string {
  return stripHtml(raw, 300)
    .replace(/\s+[|–—-]\s+(Reuters|AP News|The Associated Press|Business Wire|PR Newswire|GlobeNewswire|Bloomberg|CNBC|Yahoo Finance|MarketWatch)$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

const EXCHANGE = "(?:NYSE(?:\\s+American|\\s+Arca|\\s+MKT)?|NASDAQ(?:GS|GM|CM)?|Nasdaq(?:\\s+(?:Global\\s+Select|Global|Capital)\\s+Market)?|NYSEAMERICAN|Cboe(?:\\s+BZX)?|TSX(?:V)?|OTCQX|OTCQB|OTC(?:\\s+Markets)?)";
const TICKER_IN_PARENS = new RegExp(`${EXCHANGE}\\s*:\\s*([A-Z][A-Z0-9]{0,5}(?:[.\\-][A-Z])?)`, "g");
const CASHTAG = /(?:^|[\s(])\$([A-Z]{1,5})(?![A-Za-z0-9])/g;

/** Tickers named in text: "(NYSE: XOM)", "Nasdaq: SNOW", "$NVDA". Unique, in order of appearance. */
export function tickersIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(TICKER_IN_PARENS)) out.push(m[1].replace("-", "."));
  for (const m of text.matchAll(CASHTAG)) out.push(m[1]);
  return [...new Set(out)].slice(0, 8);
}

const STOP = new Set(("a an and are as at be by for from has have in into is it its of on or that the their this to was were will with after amid over says said new up down its it's inc corp co ltd llc plc group holdings company companies " +
  "announces announced reports reported report update updates today week year per million billion percent vs versus q1 q2 q3 q4 first second third fourth").split(" "));

/** Content words of a headline, lightly stemmed, for comparing headlines. */
export function tokens(title: string): string[] {
  return [...new Set(title.toLowerCase().replace(/['’]s\b/g, "").split(/[^a-z0-9$.]+/).map((w) => w.replace(/^\.+|\.+$/g, ""))
    .filter((w) => w.length > 2 && !STOP.has(w))
    .map((w) => (w.length > 4 && w.endsWith("ies") ? `${w.slice(0, -3)}y` : w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w)))];
}

export function jaccard(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const B = new Set(b);
  const inter = a.filter((x) => B.has(x)).length;
  return inter / (a.length + b.length - inter);
}

/** Parse a feed date; anything unparseable, or more than a day in the future, becomes `fallback`. */
export function parseFeedDate(raw: unknown, fallback: Date): Date {
  const t = Date.parse(String(raw ?? ""));
  if (Number.isNaN(t) || t > Date.now() + 86_400_000) return fallback;
  return new Date(t);
}
