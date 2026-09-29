/**
 * Reading an open article to summarize it well. Only for pages that are free to read and that the
 * site's robots.txt allows; paywalled publishers are never fetched, and a page that marks itself as
 * not free (schema.org isAccessibleForFree: false) is dropped. The text feeds the model's summary and
 * is never stored or shown: readers get our summary and a link to the publisher.
 */
import { PAYWALLED } from "./desks";
import { decodeEntities, domainOf } from "./normalize";
import { allowedToFetch } from "./robots";
import { NEWS_UA } from "./types";

/** The main text of an article page: <article> if there is one, else substantial paragraphs. Pure, for tests. */
export function mainText(html: string, max = 8000): string {
  const clean = html.replace(/<(script|style|noscript|svg|nav|header|footer|aside|form|figure)[\s\S]*?<\/\1>/gi, " ");
  const article = /<article[\s\S]*?>([\s\S]*?)<\/article>/i.exec(clean)?.[1];
  const scope = article && article.length > 500 ? article : clean;
  const paras = [...scope.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((m) => decodeEntities(m[1].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim())
    .filter((p) => p.length > 60 && !/^(advertisement|subscribe|sign up|read more|related:)/i.test(p));
  let out = "";
  for (const p of paras) { if (out.length + p.length > max) break; out += `${p}\n`; }
  return out.trim();
}

/** Does the page say it is not free to read? */
export const markedPaywalled = (html: string) => /"isAccessibleForFree"\s*:\s*(false|"false"|"False")/.test(html);

/** The readable text of an open article, or null when it is paywalled, disallowed, or unreadable. */
export async function openArticleText(url: string): Promise<string | null> {
  const domain = domainOf(url);
  if (!domain || PAYWALLED.test(domain) || domain.endsWith("sec.gov")) return null;
  if (!(await allowedToFetch(url))) return null;
  try {
    const res = await fetch(url, { headers: { "User-Agent": NEWS_UA, Accept: "text/html" }, cache: "no-store", redirect: "follow", signal: AbortSignal.timeout(10_000) });
    if (!res.ok || !/text\/html/i.test(res.headers.get("content-type") ?? "")) return null;
    const html = (await res.text()).slice(0, 1_500_000);
    if (markedPaywalled(html)) return null;
    const text = mainText(html);
    return text.length >= 400 ? text : null;
  } catch {
    return null;
  }
}
