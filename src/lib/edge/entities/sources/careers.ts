/**
 * A company's job boards, from its own website: the home page and up to two of its careers or jobs pages,
 * searched for Greenhouse, Lever, Ashby and SmartRecruiters links and embeds. The page that showed the
 * board is kept as the evidence, so a person can check it ("Is this the right jobs board?"). Boards on
 * Workday or SuccessFactors are noted, not read: neither has a public API and their terms forbid
 * scraping, so large incumbents have thin hiring coverage and the Pulse says so.
 */
import { atsBoardsIn, careersLinks, type BoardHit } from "../crosswalk";
import { fetchText } from "../http";

export async function boardsFromSite(domain: string, deadline: number): Promise<{ hits: BoardHit[]; pages: string[] }> {
  const pages: string[] = [], hits = new Map<string, BoardHit>();
  const add = (list: BoardHit[]) => { for (const h of list) if (!hits.has(`${h.scheme}:${h.value}`)) hits.set(`${h.scheme}:${h.value}`, h); };
  const home = `https://${domain}/`;
  let html = "";
  try { html = await fetchText(home, { timeoutMs: 12_000 }); pages.push(home); } catch { return { hits: [], pages }; }
  add(atsBoardsIn(html, home));
  for (const link of careersLinks(html, home).slice(0, 2)) {
    if (Date.now() > deadline || [...hits.values()].some((h) => h.scheme === "greenhouse" || h.scheme === "lever" || h.scheme === "ashby")) break;
    try { const page = await fetchText(link, { timeoutMs: 12_000 }); pages.push(link); add(atsBoardsIn(page, link)); } catch { /* a careers page that will not load is skipped */ }
  }
  return { hits: [...hits.values()], pages };
}
