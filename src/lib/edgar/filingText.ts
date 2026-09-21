import { DAY, edgarText } from "./client";
import { cacheGet, cacheSet } from "@/lib/cache";

/** Plain text of a filing's primary document (HTML or inline XBRL), cached 30 days. */
export async function getFilingText(url: string): Promise<string> {
  const key = "filingtext:" + url.replace(/[^a-zA-Z0-9]+/g, "_").slice(-140);
  const hit = await cacheGet(key);
  if (hit) return hit;
  const html = await edgarText(url, "raw-" + key + ".json", 60_000); // raw HTML only briefly in memory
  const text = htmlToText(html);
  await cacheSet(key, text, 30 * DAY);
  return text;
}

export function htmlToText(html: string): string {
  let s = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<ix:header[\s\S]*?<\/ix:header>/gi, " ")
    .replace(/<(br|\/p|\/div|\/tr|\/li|\/h[1-6]|\/table)[^>]*>/gi, "\n")
    .replace(/<\/t[dh]>/gi, " \t ")
    .replace(/<[^>]+>/g, " ");
  s = s
    .replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#8217;/g, "'").replace(/&#8220;|&#8221;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&[a-z]+;/gi, " ");
  return s.replace(/[ \t ]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export type Hit = { offset: number; snippet: string };

/** Case-insensitive search: exact phrase first, then lines containing most of the query terms. */
export function searchText(text: string, query: string, maxHits = 6, window = 450): Hit[] {
  const lower = text.toLowerCase();
  const q = query.toLowerCase().trim();
  const hits: Hit[] = [];
  const push = (idx: number) => {
    if (hits.some((h) => Math.abs(h.offset - idx) < window)) return;
    const start = Math.max(0, idx - Math.floor(window / 3));
    hits.push({ offset: start, snippet: text.slice(start, start + window).replace(/\s+/g, " ") });
  };
  let from = 0;
  while (hits.length < maxHits) {
    const idx = lower.indexOf(q, from);
    if (idx < 0) break;
    push(idx); from = idx + q.length;
  }
  if (hits.length < maxHits) {
    const terms = q.split(/\W+/).filter((t) => t.length > 2);
    if (terms.length > 1) {
      const scored: { idx: number; score: number }[] = [];
      const step = 400;
      for (let i = 0; i < lower.length; i += step) {
        const chunk = lower.slice(i, i + window);
        const score = terms.filter((t) => chunk.includes(t)).length;
        if (score >= Math.max(2, Math.ceil(terms.length * 0.6))) scored.push({ idx: i, score });
      }
      scored.sort((a, b) => b.score - a.score);
      for (const s of scored) { if (hits.length >= maxHits) break; push(s.idx); }
    }
  }
  return hits;
}
