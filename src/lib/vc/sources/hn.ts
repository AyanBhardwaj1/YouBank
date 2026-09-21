import type { NewStartup } from "../directory";
import { slugify } from "../directory";

type Hit = { objectID: string; title: string; url?: string | null; author: string; points: number; num_comments: number; created_at: string; created_at_i: number };

/** "Show HN" launches from the Algolia HN API: indie and often unfunded projects from around the world. */
export async function fetchShowHn(days: number, minPoints = 3): Promise<NewStartup[]> {
  // Algolia caps pagination at 1,000 hits per query, so walk backwards in 7-day windows.
  const now = Math.floor(Date.now() / 1000);
  const out: NewStartup[] = [];
  const seen = new Set<string>();
  for (let end = now; end > now - days * 86400; end -= 7 * 86400) {
    const start = Math.max(end - 7 * 86400, now - days * 86400);
    for (let page = 0; page < 5; page++) {
      const p = new URLSearchParams({ tags: "show_hn", numericFilters: `created_at_i>${start},created_at_i<=${end},points>${minPoints - 1}`, hitsPerPage: "1000", page: String(page) });
      const res = await fetch(`https://hn.algolia.com/api/v1/search_by_date?${p}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HN Algolia ${res.status}`);
      const j = (await res.json()) as { hits: Hit[]; nbPages: number };
      for (const h of j.hits) {
        if (seen.has(h.objectID)) continue;
        seen.add(h.objectID);
        out.push(toStartup(h));
      }
      if (page + 1 >= j.nbPages) break;
    }
  }
  return out;
}

function toStartup(h: Hit): NewStartup {
  const t = h.title.replace(/^Show HN:\s*/i, "").trim();
  const m = /^(.{2,80}?)\s*(?:[–—:]|-\s)\s*(.+)$/.exec(t);
  const name = (m ? m[1] : t).replace(/^I (built|made|created|wrote)\s+/i, "").trim().slice(0, 120);
  let host = ""; try { host = h.url ? new URL(h.url).hostname.replace(/^www\./, "") : ""; } catch { /* ignore */ }
  return {
    source: "hn", sourceId: h.objectID, name: name || t.slice(0, 120), oneLiner: (m ? m[2] : "").slice(0, 300), description: t, website: h.url ?? "", url: `https://news.ycombinator.com/item?id=${h.objectID}`, logo: "",
    program: "Show HN", status: "Launched", foundedYear: Number(h.created_at.slice(0, 4)), founders: h.author, location: "", country: "", industries: host.endsWith("github.com") ? ["Open source"] : [], tags: host ? [host] : [],
    teamSize: null, fundingStage: "Bootstrapped / unknown", investors: [], raised: "", raisedUsd: null, isHiring: 0, sourceDate: h.created_at.slice(0, 10), data: { points: h.points, comments: h.num_comments, slug: slugify(name) },
  };
}
