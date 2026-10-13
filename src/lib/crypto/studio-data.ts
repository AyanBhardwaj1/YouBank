/**
 * Data for the Studio crypto templates: a token, and peers for comps, as `TokenFin` (USD millions,
 * supplies in millions of tokens). Server only. Free sources: CoinGecko for price and supply,
 * DefiLlama for fees, revenue, holders' revenue (the last 30 days annualised) and value locked.
 */
import { ILLUSTRATIVE_PEERS, ILLUSTRATIVE_TOKEN, type TokenFin } from "@/lib/studio/crypto-templates";
import { cashflows, protocols, type Cashflow, type Protocol } from "./defi";
import { tokenMarkets, type TokenRow } from "./market";
import { tokenView } from "./token";

const ann = (v: number | null | undefined) => (typeof v === "number" && v > 0 ? (v * 365) / 30 / 1e6 : 0);
const mm = (v: number | null | undefined) => (typeof v === "number" && v > 0 ? v / 1e6 : 0);

/** A token for a template, or illustrative inputs when none is given. */
export async function tokenFinFor(q?: string | null): Promise<TokenFin> {
  if (!q?.trim()) return ILLUSTRATIVE_TOKEN;
  const v = await tokenView(q.trim());
  const i = v.info;
  const circ = i.circulating ?? 0;
  return {
    id: i.id, symbol: i.symbol, name: i.name, category: v.protocol?.category ?? i.categories[0] ?? "",
    price: i.price ?? 0, circulating: circ / 1e6, fullyDiluted: (i.max ?? i.total ?? circ) / 1e6, maxSupply: i.max ? i.max / 1e6 : null,
    fees: ann(v.cash?.fees30d), revenue: ann(v.cash?.revenue30d), holdersRevenue: ann(v.cash?.holdersRevenue30d), tvl: mm(v.protocol?.tvl),
    source: `https://www.coingecko.com/en/coins/${i.id}`, asOf: i.updatedAt, illustrative: false,
  };
}

/** Peers in a list: a market row joined to its protocol's cash flows. Pure, for tests. */
export function peerFin(row: TokenRow, p: Protocol | undefined, c: Cashflow | undefined): TokenFin {
  const circ = row.circulating ?? 0;
  return {
    id: row.id, symbol: row.symbol, name: row.name, category: p?.category ?? "", price: row.price ?? 0, circulating: circ / 1e6, fullyDiluted: (row.max ?? row.total ?? circ) / 1e6,
    fees: ann(c?.fees30d), revenue: ann(c?.revenue30d), holdersRevenue: ann(c?.holdersRevenue30d), tvl: mm(p?.tvl),
    source: `https://www.coingecko.com/en/coins/${row.id}`, asOf: new Date().toISOString(), illustrative: false,
  };
}

/**
 * Comparable tokens: the ones named, else the protocols in the target's category earning the most
 * fees that have a token. Up to eight.
 */
export async function cryptoPeersFor(target: TokenFin, named?: string[]): Promise<TokenFin[]> {
  if (target.illustrative && !named?.length) return ILLUSTRATIVE_PEERS;
  const [all, flows] = await Promise.all([protocols(), cashflows().catch(() => [] as Cashflow[])]);
  const flowBy = new Map(flows.map((c) => [c.slug, c]));
  let picks: Protocol[];
  if (named?.length) {
    const want = named.map((n) => n.trim().toLowerCase()).filter(Boolean);
    picks = all.filter((p) => p.geckoId && (want.includes(p.geckoId) || want.includes(p.symbol.toLowerCase()) || want.includes(p.slug)));
  } else {
    picks = all.filter((p) => p.geckoId && p.geckoId !== target.id && p.category === target.category).sort((a, b) => (flowBy.get(b.slug)?.fees30d ?? 0) - (flowBy.get(a.slug)?.fees30d ?? 0));
  }
  const seen = new Set<string>();
  picks = picks.filter((p) => (seen.has(p.geckoId!) || p.geckoId === target.id ? false : (seen.add(p.geckoId!), true))).slice(0, 8);
  if (!picks.length) return [];
  const rows = await tokenMarkets({ ids: picks.map((p) => p.geckoId!), perPage: 50 });
  return picks.map((p) => { const r = rows.find((x) => x.id === p.geckoId); return r ? peerFin(r, p, flowBy.get(p.slug)) : null; }).filter((x): x is TokenFin => !!x && x.price > 0);
}
