/**
 * One token, the way an analyst reads it: market data and supply, a year of price with volatility,
 * drawdown and its link to bitcoin, the protocol behind it (TVL, fees, revenue, what reaches holders),
 * the valuation multiples those imply, and the next unlock. Server only, except `priceStats`.
 */
import { protocolForGecko, cashflows, type Cashflow } from "./defi";
import { tokenUnlocks, type Unlock } from "./deals";
import { requireToken, tokenHistory, tokenInfo, type Close, type Tier, type TokenInfo } from "./market";
import { alignedReturns, maxDrawdown } from "./risk";
import { coingeckoCoin, llamaProtocol, type Cite } from "./sources";

export type PriceStats = { vol365: number | null; vol90: number | null; maxDrawdown: number | null; return1y: number | null; corrBtc90: number | null; betaBtc90: number | null; days: number };

const sd = (xs: number[]) => { if (xs.length < 2) return null; const m = xs.reduce((a, b) => a + b, 0) / xs.length; return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1)); };

/** Volatility (365-day annualisation: crypto trades every day), drawdown, and beta and correlation to bitcoin over 90 days. Pure, for tests. */
export function priceStats(closes: Close[], btc: Close[] | null): PriceStats {
  const px = closes.map((c) => c.close);
  const rets = px.slice(1).map((p, i) => p / px[i] - 1);
  const v = (xs: number[]) => { const s = sd(xs); return s === null ? null : s * Math.sqrt(365); };
  let corr: number | null = null, beta: number | null = null;
  if (btc && btc.length > 30) {
    const { returns } = alignedReturns({ t: closes, b: btc });
    const a = (returns.t ?? []).slice(-90), b = (returns.b ?? []).slice(-90);
    if (a.length >= 30 && a.length === b.length) {
      const ma = a.reduce((s, x) => s + x, 0) / a.length, mb = b.reduce((s, x) => s + x, 0) / b.length;
      let cov = 0, va = 0, vb = 0;
      for (let i = 0; i < a.length; i++) { cov += (a[i] - ma) * (b[i] - mb); va += (a[i] - ma) ** 2; vb += (b[i] - mb) ** 2; }
      corr = va && vb ? cov / Math.sqrt(va * vb) : null;
      beta = vb ? cov / vb : null;
    }
  }
  return { vol365: v(rets), vol90: v(rets.slice(-90)), maxDrawdown: maxDrawdown(px), return1y: px.length > 1 ? px[px.length - 1] / px[0] - 1 : null, corrBtc90: corr, betaBtc90: beta, days: px.length };
}

export type Multiples = { mcapToFees: number | null; fdvToFees: number | null; mcapToRevenue: number | null; fdvToRevenue: number | null; mcapToHoldersRevenue: number | null; mcapToTvl: number | null };

/** Price-to-sales for networks: market cap and FDV over annualised fees, revenue and holders' revenue (the last 30 days times 365/30). Pure, for tests. */
export function multiples(mcap: number | null, fdv: number | null, cash: Cashflow | null, tvl: number | null): Multiples {
  const ann = (v: number | null | undefined) => (typeof v === "number" && v > 0 ? (v * 365) / 30 : null);
  const div = (a: number | null, b: number | null) => (a !== null && b !== null && b > 0 ? a / b : null);
  const fees = ann(cash?.fees30d), rev = ann(cash?.revenue30d), hold = ann(cash?.holdersRevenue30d);
  return { mcapToFees: div(mcap, fees), fdvToFees: div(fdv, fees), mcapToRevenue: div(mcap, rev), fdvToRevenue: div(fdv, rev), mcapToHoldersRevenue: div(mcap, hold), mcapToTvl: div(mcap, tvl) };
}

export type TokenView = {
  info: TokenInfo;
  history: Close[];
  stats: PriceStats;
  protocol: { name: string; slug: string; category: string; tvl: number | null; chains: string[] } | null;
  cash: Cashflow | null;
  multiples: Multiples;
  unlock: Unlock | null;
  sources: Cite[];
  tier: Tier;
};

export async function tokenView(q: string, tier: Tier = "free"): Promise<TokenView> {
  const t = await requireToken(q);
  const [info, history, btc, protocol] = await Promise.all([
    tokenInfo(t.id, tier),
    tokenHistory(t.id, 365, tier).catch(() => [] as Close[]),
    t.id === "bitcoin" ? Promise.resolve(null) : tokenHistory("bitcoin", 365).catch(() => null),
    protocolForGecko(t.id),
  ]);
  const flows = protocol ? await cashflows().catch(() => [] as Cashflow[]) : [];
  const cash = protocol ? flows.find((c) => c.slug === protocol.slug) ?? flows.find((c) => c.name.toLowerCase() === protocol.name.toLowerCase()) ?? null : null;
  const unlock = (await tokenUnlocks().catch(() => [] as Unlock[])).find((u) => u.geckoId === t.id) ?? null;
  const asOf = new Date().toISOString();
  return {
    info, history, stats: priceStats(history, t.id === "bitcoin" ? history : btc),
    protocol: protocol ? { name: protocol.name, slug: protocol.slug, category: protocol.category, tvl: protocol.tvl, chains: protocol.chains.slice(0, 8) } : null,
    cash, multiples: multiples(info.marketCap, info.fdv, cash, protocol?.tvl ?? null), unlock,
    sources: [{ ...coingeckoCoin(t.id), asOf }, ...(protocol ? [{ ...llamaProtocol(protocol.slug), asOf }] : []), ...(unlock ? [{ name: "DefiLlama unlocks", url: "https://defillama.com/unlocks", asOf }] : [])],
    tier,
  };
}
