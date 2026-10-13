/**
 * The crypto screens' data, one function per screen, served through the terminal's data route
 * (/api/terminal/<fn>) so they share its caching headers, error handling and the "AI read". Server
 * only. Every view carries the `sources` its figures came from.
 *
 * All of these run on free APIs. Pro data (CoinGecko Pro, DefiLlama Pro) is a separate, explicit
 * request through /api/crypto/pro, which checks the plan first.
 */
import { bitcoinView } from "./bitcoin";
import { cryptoRaises, cryptoTreasuries, topInvestors, tokenUnlocks, type Raise } from "./deals";
import { cashflows, chainTvls, pools, protocols, rwaProtocols, stablecoinHistory, stablecoins, tvlHistory, type RwaKind } from "./defi";
import { CryptoDataError } from "./http";
import { globalStats, simplePrices, tokenMarkets, type Tier, type TokenRow } from "./market";
import { COINGECKO, DEFILLAMA, type Cite } from "./sources";
import { tokenView } from "./token";

const now = () => new Date().toISOString();
const cg = (): Cite => ({ name: COINGECKO.name, url: COINGECKO.url, asOf: now() });
const llama = (path = ""): Cite => ({ name: DEFILLAMA.name, url: `${DEFILLAMA.url}${path}`, asOf: now() });
const settle = <T>(p: Promise<T>) => p.catch(() => null);

export async function marketsView(tier: Tier = "free") {
  const [global, tokens, tvl, stables] = await Promise.all([settle(globalStats()), tokenMarkets({ perPage: 100, tier }), settle(tvlHistory()), settle(stablecoinHistory())]);
  return {
    global, tokens,
    defiTvl: tvl?.at(-1)?.tvl ?? null, defiTvl30: tvl && tvl.length > 31 ? tvl[tvl.length - 1].tvl / tvl[tvl.length - 31].tvl - 1 : null,
    stablecoinSupply: stables?.at(-1)?.supply ?? null, stablecoin30: stables && stables.length > 31 ? stables[stables.length - 1].supply / stables[stables.length - 31].supply - 1 : null,
    sources: [cg(), llama()],
  };
}

export async function defiView() {
  const [chains, all, hist, flows] = await Promise.all([chainTvls(), protocols(), settle(tvlHistory()), settle(cashflows())]);
  const cats = new Map<string, { category: string; tvl: number; protocols: number }>();
  for (const p of all) { const c = cats.get(p.category) ?? { category: p.category, tvl: 0, protocols: 0 }; c.tvl += p.tvl ?? 0; c.protocols++; cats.set(p.category, c); }
  return {
    chains: chains.slice(0, 20), protocols: all.filter((p) => p.category !== "CEX").slice(0, 60), categories: [...cats.values()].filter((c) => c.category && c.category !== "CEX").sort((a, b) => b.tvl - a.tvl).slice(0, 14),
    history: hist ?? [], cashflows: (flows ?? []).slice(0, 40), sources: [llama(), llama("fees")],
  };
}

export async function stablesView() {
  const [coins, history] = await Promise.all([stablecoins(), settle(stablecoinHistory())]);
  const total = coins.reduce((s, c) => s + c.supply, 0);
  const byChain = new Map<string, number>();
  for (const c of coins) for (const ch of c.chains) byChain.set(ch.chain, (byChain.get(ch.chain) ?? 0) + ch.supply);
  const flow = (k: "d1" | "d7" | "d30") => coins.reduce((s, c) => s + (c[k] !== null ? c.supply - c.supply / (1 + (c[k] as number)) : 0), 0);
  return {
    coins: coins.slice(0, 30), total, flows: { d1: flow("d1"), d7: flow("d7"), d30: flow("d30") },
    chains: [...byChain.entries()].map(([chain, supply]) => ({ chain, supply })).sort((a, b) => b.supply - a.supply).slice(0, 12),
    history: history ?? [], sources: [llama("stablecoins")],
  };
}

export async function yieldsView(stableOnly = false) {
  const all = await pools();
  const rows = all.filter((p) => !stableOnly || p.stable).slice(0, 120);
  return { pools: rows, stableOnly, sources: [llama("yields")] };
}

export async function raisesView(tier: Tier = "free") {
  const raises = await cryptoRaises(tier === "pro");
  const since = (days: number) => { const cut = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10); return raises.filter((r) => r.date >= cut); };
  const sumUsd = (rs: Raise[]) => rs.reduce((s, r) => s + (r.amountUsd ?? 0), 0);
  const last90 = since(90);
  const cats = new Map<string, { category: string; rounds: number; usd: number }>();
  for (const r of last90) { const k = r.category || r.sector || "Other"; const c = cats.get(k) ?? { category: k, rounds: 0, usd: 0 }; c.rounds++; c.usd += r.amountUsd ?? 0; cats.set(k, c); }
  return {
    raises: raises.slice(0, 250), stats: { rounds30: since(30).length, usd30: sumUsd(since(30)), rounds90: last90.length, usd90: sumUsd(last90) },
    categories: [...cats.values()].sort((a, b) => b.usd - a.usd).slice(0, 12), investors: topInvestors(last90), sources: [tier === "pro" ? { ...llama("raises"), name: "DefiLlama Pro" } : llama("raises")],
  };
}

export async function unlocksView(tier: Tier = "free") {
  const all = await tokenUnlocks(tier === "pro");
  const horizon = new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10);
  const rows = all.filter((u) => (u.nextDate ?? "9999") <= horizon);
  return { unlocks: rows.slice(0, 150), totalUsd: rows.reduce((s, u) => s + (u.nextUsd ?? 0), 0), sources: [tier === "pro" ? { ...llama("unlocks"), name: "DefiLlama Pro" } : llama("unlocks")] };
}

export async function treasuriesView() {
  const [t, px] = await Promise.all([cryptoTreasuries(), settle(simplePrices(["bitcoin", "ethereum"]))]);
  return { ...t, total: t.rows.reduce((s, r) => s + r.fairValue, 0), btcPrice: px?.bitcoin?.usd ?? null, ethPrice: px?.ethereum?.usd ?? null, sources: [...t.sources, cg()] };
}

export async function rwaView() {
  const [rows, tokens] = await Promise.all([rwaProtocols(), settle(tokenMarkets({ perPage: 50, category: "real-world-assets-rwa" }))]);
  const kinds = new Map<RwaKind, { kind: RwaKind; tvl: number; protocols: number }>();
  for (const r of rows) { const k = kinds.get(r.kind) ?? { kind: r.kind, tvl: 0, protocols: 0 }; k.tvl += r.tvl ?? 0; k.protocols++; kinds.set(r.kind, k); }
  return {
    rows: rows.slice(0, 80), kinds: [...kinds.values()].sort((a, b) => b.tvl - a.tvl), total: rows.reduce((s, r) => s + (r.tvl ?? 0), 0),
    tokens: (tokens ?? []) as TokenRow[], sources: [llama("protocols/rwa"), ...(tokens ? [cg()] : [])],
  };
}

/** Terminal data functions served by this module, and how long a browser may reuse each (seconds). */
export const CRYPTO_TTL: Record<string, number> = { crypto: 120, token: 300, defi: 900, stables: 900, yields: 900, btc: 60, raises: 1800, unlocks: 1800, treasuries: 3600, rwa: 1800 };
export const isCryptoFn = (fn: string) => Object.prototype.hasOwnProperty.call(CRYPTO_TTL, fn);

/** What each screen shows, for the "AI read" prompt. */
export const CRYPTO_EXPLAIN: Record<string, string> = {
  crypto: "the crypto market: the largest tokens, total market cap, bitcoin dominance, DeFi TVL and stablecoin supply",
  token: "one crypto token: price, supply, volatility, its protocol's TVL, fees and revenue, valuation multiples and the next unlock",
  defi: "DeFi: value locked by chain, category and protocol, and protocols' fees and revenue",
  stables: "stablecoins: supply by coin and chain and the net flows in and out",
  yields: "DeFi yields: the largest pools with their base and reward APYs",
  btc: "the Bitcoin network: fees, the mempool, hashrate, the next difficulty adjustment, pools and mining economics",
  raises: "crypto venture rounds: recent raises, sizes, categories and lead investors",
  unlocks: "upcoming token unlocks: dates, size in tokens and dollars, and share of circulating supply",
  treasuries: "public companies' crypto holdings at fair value from SEC filings",
  rwa: "tokenized real-world assets: treasuries, private credit and others, by value locked",
};

/** Compute one crypto screen. `p` is the request's query string. */
export async function cryptoCompute(fn: string, p: URLSearchParams, tier: Tier = "free"): Promise<unknown> {
  switch (fn) {
    case "crypto": return marketsView(tier);
    case "token": {
      const q = (p.get("q") ?? p.get("id") ?? "").trim();
      if (!q) throw new CryptoDataError("Name a token: TOKEN ETH, TOKEN uniswap", 400);
      return tokenView(q.slice(0, 60), tier);
    }
    case "defi": return defiView();
    case "stables": return stablesView();
    case "yields": return yieldsView(p.get("stable") === "1");
    case "btc": return bitcoinView();
    case "raises": return raisesView(tier);
    case "unlocks": return unlocksView(tier);
    case "treasuries": return treasuriesView();
    case "rwa": return rwaView();
    default: throw new CryptoDataError(`Unknown crypto function ${fn}`, 404);
  }
}

/** The functions whose answers change with Pro data (the rest are free sources either way). */
export const PRO_FNS = new Set(["token", "raises", "unlocks"]);
