/**
 * Crypto signals for the Newsroom, from free structured sources rather than articles. Server only.
 *
 * - Venture rounds (DefiLlama's raises), $5M and up from the last three days, linked to the
 *   announcement each one cites.
 * - Token unlocks in the next week that add at least 1% to circulating supply or $25M at today's
 *   price (DefiLlama's emissions).
 * - SEC filings that mention digital-asset treasuries or bitcoin purchases, from EDGAR full-text
 *   search over the last three days (8-Ks and their exhibits).
 * Each runs on the Newsroom's own schedule (every few hours) and uses only the free APIs: nothing
 * here touches a paid feed.
 */
import { fullTextSearch } from "@/lib/edgar/fulltext";
import { tickerMap } from "@/lib/edgar/tickers";
import { canonicalUrl, keyOf } from "@/lib/news/normalize";
import type { FetchResult, RawItem } from "@/lib/news/types";
import { cryptoRaises, tokenUnlocks, type Raise, type Unlock } from "./deals";

const money = (v: number) => (v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(v >= 1e8 ? 0 : 1)}M` : `$${Math.round(v / 1e3)}K`);

/** Recent rounds as stories. Pure, for tests. */
export function raiseItems(raises: Raise[], now = new Date(), days = 3, minUsd = 5e6): RawItem[] {
  const cut = new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
  return raises.filter((r) => r.date >= cut && (r.amountUsd ?? 0) >= minUsd).map((r) => {
    const url = canonicalUrl(r.source && /^https?:\/\//.test(r.source) ? r.source : `https://defillama.com/raises?name=${encodeURIComponent(r.name)}`);
    const lead = r.leads.length ? ` led by ${r.leads.slice(0, 3).join(", ")}` : "";
    return {
      key: keyOf(`llama-raise:${r.name}:${r.date}:${r.round}`), url, title: `${r.name} raises ${money(r.amountUsd!)}${r.round ? ` in a ${r.round} round` : ""}${lead}`.slice(0, 280),
      snippet: [r.category || r.sector, r.chains.length ? `Chains: ${r.chains.slice(0, 4).join(", ")}` : "", r.valuationUsd ? `Valuation ${money(r.valuationUsd)}` : "", r.others.length ? `Also: ${r.others.slice(0, 5).join(", ")}` : ""].filter(Boolean).join(". "),
      source: "DefiLlama raises", domain: "defillama.com", kind: "article", publishedAt: new Date(`${r.date}T12:00:00Z`), tags: ["crypto", "vc"], tickers: [], tier: 3,
      meta: { category: "funding", amountUsd: r.amountUsd, round: r.round, investors: [...r.leads, ...r.others].slice(0, 12), weight: Math.min(0.6, 0.2 + Math.log10((r.amountUsd ?? 1e6) / 1e6) * 0.15) },
    };
  });
}

/** Upcoming unlocks that matter, as stories. Pure, for tests. */
export function unlockItems(unlocks: Unlock[], now = new Date(), days = 7): RawItem[] {
  const horizon = new Date(now.getTime() + days * 86_400_000).toISOString().slice(0, 10);
  return unlocks.filter((u) => u.nextDate && u.nextDate <= horizon && ((u.nextShare ?? 0) >= 0.01 || (u.nextUsd ?? 0) >= 25e6)).map((u) => {
    const share = u.nextShare !== null ? `${(u.nextShare * 100).toFixed(1)}% of circulating supply` : "new supply";
    return {
      key: keyOf(`llama-unlock:${u.name}:${u.nextDate}`), url: canonicalUrl(`https://defillama.com/unlocks/${encodeURIComponent(u.name.toLowerCase().replace(/\s+/g, "-"))}`),
      title: `${u.name} unlocks ${share}${u.nextUsd ? ` (about ${money(u.nextUsd)})` : ""} on ${u.nextDate}`, snippet: "Scheduled token unlock from the project's published vesting schedule, valued at today's price.",
      source: "DefiLlama unlocks", domain: "defillama.com", kind: "article", publishedAt: now, tags: ["crypto", "markets"], tickers: [], tier: 3,
      meta: { category: "markets", amountUsd: u.nextUsd, weight: Math.min(0.55, 0.2 + (u.nextShare ?? 0) * 5) },
    };
  });
}

export async function fetchCryptoSignals(now = new Date()): Promise<FetchResult> {
  const items: RawItem[] = [];
  const errors: string[] = [];
  await cryptoRaises().then((r) => items.push(...raiseItems(r, now))).catch((e) => errors.push(`raises: ${e instanceof Error ? e.message : e}`));
  await tokenUnlocks().then((u) => items.push(...unlockItems(u, now))).catch((e) => errors.push(`unlocks: ${e instanceof Error ? e.message : e}`));
  const from = new Date(now.getTime() - 3 * 86_400_000).toISOString().slice(0, 10);
  const byCik = new Map<string, string>();
  for (const t of (await tickerMap().catch(() => new Map())).values()) if (!byCik.has(t.cik)) byCik.set(t.cik, t.ticker);
  for (const q of ['"digital asset treasury"', '"bitcoin treasury"', '"purchased bitcoin"']) {
    const hits = await fullTextSearch({ q, forms: ["8-K"], from, limit: 20 }).catch((e) => { errors.push(`edgar: ${e instanceof Error ? e.message : e}`); return { total: 0, hits: [] }; });
    for (const h of hits.hits) {
      const ticker = byCik.get(h.cik.padStart(10, "0")) ?? "";
      items.push({
        key: `sec:${h.accession}`, url: h.url, title: `${h.entity}${ticker ? ` (${ticker})` : ""} files an 8-K on its crypto holdings`, snippet: `${h.form}${h.description ? `: ${h.description}` : ""}. Matched ${q} in EDGAR full-text search.`,
        source: "SEC EDGAR", domain: "sec.gov", kind: "filing", publishedAt: new Date(`${h.filed}T12:00:00Z`), tags: ["crypto", "markets", "corpfin"], tickers: ticker ? [ticker] : [], tier: 1,
        meta: { category: "filings", form: h.form, weight: 0.4 },
      });
    }
  }
  const seen = new Set<string>();
  const unique = items.filter((i) => (seen.has(i.key) ? false : (seen.add(i.key), true)));
  return { status: unique.length || !errors.length ? "ok" : "error", items: unique, ...(errors.length && !unique.length ? { error: errors.join("; ").slice(0, 300) } : {}) };
}
