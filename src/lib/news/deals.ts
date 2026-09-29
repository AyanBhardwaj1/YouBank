/**
 * The deal tracker: every announced deal, raise, IPO, financing and bankruptcy the Newsroom reads
 * becomes a row, so YouBank builds its own deal database over time. For public targets it works out
 * what a banker would: the premium to the unaffected price (the last close before the news broke) and
 * the implied EV/EBITDA and EV/revenue from the target's SEC figures. League tables count advisors
 * named in announcements.
 */
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import type { DealAdvisor, NewsEntity } from "@/db/schema";
import { getCompanyData } from "@/lib/company";
import { searchTickers } from "@/lib/edgar/tickers";
import { history } from "@/lib/market/data";
import type { Reading } from "./enrich";
import type { ClusterRow, ItemRow } from "./store";

type Deal = NonNullable<Reading["deal"]>;

/** Premium to the unaffected close: the offer per share against the last close before `announced`. Pure, for tests. */
export function premiumOf(perShare: number | null, bars: { date: string; close: number }[], announced: Date): { unaffected: number; premium: number } | null {
  if (!perShare || perShare <= 0 || !bars.length) return null;
  const day = announced.toISOString().slice(0, 10);
  const before = bars.filter((b) => b.date < day);
  const unaffected = before[before.length - 1]?.close;
  if (!unaffected || unaffected <= 0) return null;
  const premium = perShare / unaffected - 1;
  // Outside this band it is almost always a misread (a different class, a per-unit price, a split).
  return premium > -0.6 && premium < 4 ? { unaffected, premium } : null;
}

/** Implied multiples from an equity or headline value and the target's SEC figures (USD millions). Pure, for tests. */
export function impliedMultiples(opts: { perShare: number | null; valueUsd: number | null; sharesMm: number | null; debtMm: number | null; cashMm: number | null; ebitdaMm: number | null; revenueMm: number | null }): { ev: number; evEbitda: number | null; evRevenue: number | null; basis: "per share" | "headline" } | null {
  const bridge = (opts.debtMm ?? 0) - (opts.cashMm ?? 0);
  let ev: number | null = null, basis: "per share" | "headline" = "headline";
  if (opts.perShare && opts.sharesMm) { ev = opts.perShare * opts.sharesMm + bridge; basis = "per share"; }
  else if (opts.valueUsd) ev = opts.valueUsd / 1e6;
  if (!ev || ev <= 0) return null;
  const m = (d: number | null) => (d && d > 0 ? ev! / d : null);
  const evEbitda = m(opts.ebitdaMm), evRevenue = m(opts.revenueMm);
  return { ev, evEbitda: evEbitda && evEbitda < 200 ? evEbitda : null, evRevenue: evRevenue && evRevenue < 100 ? evRevenue : null, basis };
}

async function tickerFor(name: string | null, entities: NewsEntity[]): Promise<string> {
  if (!name) return "";
  const e = entities.find((x) => x.ticker && (x.name.toLowerCase().includes(name.toLowerCase().split(" ")[0]) || name.toLowerCase().includes(x.name.toLowerCase().split(" ")[0])));
  if (e?.ticker) return e.ticker;
  const hits = await searchTickers(name.replace(/,?\s+(inc|corp|corporation|co|ltd|plc|llc|holdings|group)\.?$/i, ""), 1).catch(() => []);
  // Only a confident name match: the SEC name must start with the first word of the deal's name.
  return hits[0] && hits[0].name.toLowerCase().startsWith(name.toLowerCase().split(" ")[0]) ? hits[0].ticker : "";
}

export async function saveDeal(c: ClusterRow, d: Deal, entities: NewsEntity[], items: ItemRow[]) {
  const targetTicker = await tickerFor(d.target, entities);
  const acquirerTicker = await tickerFor(d.acquirer, entities);
  let premium: number | null = null, unaffected: number | null = null, evEbitda: number | null = null, evRevenue: number | null = null;
  const takeover = ["acquisition", "merger", "take_private", "tender"].includes(d.kind);
  if (takeover && targetTicker) {
    const from = new Date(c.firstSeenAt.getTime() - 20 * 86_400_000).toISOString().slice(0, 10);
    const bars = await history(targetTicker, from).catch(() => []);
    const p = premiumOf(d.perShare, bars, c.firstSeenAt);
    if (p) { premium = p.premium; unaffected = p.unaffected; }
    const co = await getCompanyData(targetTicker).catch(() => null);
    if (co) {
      const m = impliedMultiples({ perShare: d.perShare, valueUsd: d.valueUsd, sharesMm: co.balance.sharesOut, debtMm: co.balance.debt, cashMm: co.balance.cash, ebitdaMm: co.ltm.ebitda, revenueMm: co.ltm.revenue });
      if (m) { evEbitda = m.evEbitda; evRevenue = m.evRevenue; }
    }
  }
  const sector = c.desks.find((t) => ["tech", "healthcare", "energy", "financials", "consumer", "industrials", "media", "realestate"].includes(t)) ?? "";
  const source = items.find((i) => i.kind === "release") ?? items.find((i) => i.kind === "filing") ?? items[0];
  const values = {
    clusterId: c.id, kind: d.kind, acquirer: (d.acquirer ?? "").slice(0, 160), acquirerTicker, target: (d.target ?? "").slice(0, 160), targetTicker,
    valueUsd: d.valueUsd && d.valueUsd > 0 ? d.valueUsd : null, perShare: d.perShare && d.perShare > 0 ? d.perShare : null, consideration: (d.consideration ?? "").slice(0, 40),
    premium, unaffectedPrice: unaffected, evEbitda, evRevenue, round: (d.round ?? "").slice(0, 40), investors: d.investors.slice(0, 8).map((s) => s.slice(0, 80)),
    advisors: d.advisors.slice(0, 10).map((a): DealAdvisor => ({ firm: a.firm.slice(0, 80), side: a.side.slice(0, 20), role: a.role.slice(0, 20) })),
    sector, announcedAt: c.firstSeenAt, sourceUrl: source?.url ?? "",
  };
  await requireDb().insert(schema.newsDeals).values(values).onConflictDoUpdate({ target: schema.newsDeals.clusterId, set: values });
}

export type DealRow = typeof schema.newsDeals.$inferSelect;

export async function recentDeals(opts: { days?: number; kinds?: string[]; sectors?: string[]; limit?: number } = {}): Promise<(DealRow & { headline: string })[]> {
  const since = new Date(Date.now() - (opts.days ?? 30) * 86_400_000);
  const conds = [gte(schema.newsDeals.announcedAt, since)];
  if (opts.kinds?.length) conds.push(inArray(schema.newsDeals.kind, opts.kinds));
  if (opts.sectors?.length) conds.push(inArray(schema.newsDeals.sector, opts.sectors));
  const rows = await requireDb().select({ d: schema.newsDeals, headline: schema.newsClusters.headline }).from(schema.newsDeals)
    .innerJoin(schema.newsClusters, eq(schema.newsClusters.id, schema.newsDeals.clusterId)).where(and(...conds)).orderBy(desc(schema.newsDeals.announcedAt)).limit(opts.limit ?? 60);
  return rows.map((r) => ({ ...r.d, headline: r.headline }));
}

export type LeagueRow = { firm: string; deals: number; valueUsd: number; roles: string[] };

/** "Goldman Sachs & Co. LLC" and "Goldman Sachs & Co." are both Goldman Sachs: legal suffixes come off until none is left. */
export function firmName(raw: string): string {
  let s = raw.trim(), prev = "";
  while (s !== prev) { prev = s; s = s.replace(/,?\s+(LLC|LLP|L\.L\.P\.|L\.P\.|LP|Inc\.?|Incorporated|Ltd\.?|plc|& Co\.?|and Company|Co\.)$/i, "").trim(); }
  return s;
}

/** Advisors ranked by deals and disclosed value over the window. Pure over rows, for tests. */
export function leagueTable(deals: Pick<DealRow, "advisors" | "valueUsd" | "kind">[], role: "financial" | "legal" = "financial"): LeagueRow[] {
  const by = new Map<string, LeagueRow>();
  for (const d of deals) {
    const firms = new Set(d.advisors.filter((a) => a.role.toLowerCase().startsWith(role.slice(0, 5))).map((a) => firmName(a.firm)));
    for (const f of firms) {
      const r = by.get(f) ?? { firm: f, deals: 0, valueUsd: 0, roles: [] };
      r.deals++; r.valueUsd += d.valueUsd ?? 0;
      if (!r.roles.includes(d.kind)) r.roles.push(d.kind);
      by.set(f, r);
    }
  }
  return [...by.values()].sort((a, b) => b.deals - a.deals || b.valueUsd - a.valueUsd).slice(0, 15);
}
