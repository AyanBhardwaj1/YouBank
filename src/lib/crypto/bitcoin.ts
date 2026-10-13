/**
 * The Bitcoin network from mempool.space's open API: fees, the mempool, hashrate and difficulty, the
 * next adjustment, mining pools' shares, and what a day of mining earns (hashprice), which is what
 * the mining sites on the map live or die by. Server only, except the pure economics below.
 */
import { arr, cachedJson, CryptoDataError, MIN, num, str } from "./http";
import { mempoolUrl } from "./rpc";
import { simplePrices } from "./market";
import { MEMPOOL, type Cite } from "./sources";

const SRC = "mempool.space";
const get = <T, R>(path: string, ttlMs: number, shape: (raw: T) => R) => cachedJson<T, R>(`${mempoolUrl()}${path}`, { key: `crypto:mempool:${path}`, ttlMs, source: SRC }, shape);

/** The block subsidy at a height: 50 BTC halved every 210,000 blocks. Pure. */
export const subsidyAt = (height: number) => (height >= 0 ? 50 / 2 ** Math.floor(height / 210_000) : 0);

export type MiningInputs = {
  /** Network hashrate, EH/s. */
  hashrateEhs: number;
  /** Fees per block, BTC (the last day's average). */
  feesPerBlock: number;
  subsidy: number;
  priceUsd: number;
  /** A miner's efficiency in joules per terahash (17.5 for an S21-class machine). */
  efficiencyJth?: number;
  /** All-in power cost, $ per kWh. */
  powerUsdKwh?: number;
};

/**
 * Hashprice and the power price at which a machine stops paying for itself. Pure, for tests.
 * - Daily BTC to all miners = 144 blocks x (subsidy + fees).
 * - Hashprice = daily revenue / network hashrate, in $ per PH/s per day (the industry's unit).
 * - A machine at E J/TH burns E x 86,400 / 3.6e6 kWh per TH per day; breakeven power price is the day's
 *   revenue per TH divided by that.
 */
export function miningEconomics(m: MiningInputs) {
  const dailyBtc = 144 * (m.subsidy + m.feesPerBlock);
  const dailyUsd = dailyBtc * m.priceUsd;
  const phs = m.hashrateEhs * 1000;
  const hashpriceUsdPh = phs > 0 ? dailyUsd / phs : null;
  const hashpriceBtcPh = phs > 0 ? dailyBtc / phs : null;
  const eff = m.efficiencyJth ?? 17.5;
  const kwhPerThDay = (eff * 86_400) / 3.6e6;
  const revPerThDay = hashpriceUsdPh !== null ? hashpriceUsdPh / 1000 : null;
  const breakevenUsdKwh = revPerThDay !== null ? revPerThDay / kwhPerThDay : null;
  const power = m.powerUsdKwh ?? 0.05;
  const marginPerThDay = revPerThDay !== null ? revPerThDay - kwhPerThDay * power : null;
  // Implied network draw if every machine ran at this efficiency: a floor-ish estimate of Bitcoin's power use.
  const networkGw = (m.hashrateEhs * 1e6 * eff) / 1e9;
  return { dailyBtc, dailyUsd, feeShare: m.subsidy + m.feesPerBlock > 0 ? m.feesPerBlock / (m.subsidy + m.feesPerBlock) : null, hashpriceUsdPh, hashpriceBtcPh, kwhPerThDay, breakevenUsdKwh, marginPerThDay, efficiencyJth: eff, powerUsdKwh: power, networkGw };
}

export type BitcoinView = {
  height: number | null;
  fees: { fastest: number | null; halfHour: number | null; hour: number | null; economy: number | null; minimum: number | null };
  mempool: { count: number | null; vsizeMb: number | null; totalFeeBtc: number | null };
  hashrate: { currentEhs: number | null; series: { date: string; ehs: number }[]; difficulty: number | null };
  adjustment: { progress: number | null; change: number | null; remainingBlocks: number | null; eta: string | null };
  pools: { name: string; blocks: number; share: number }[];
  reward: { feesPerBlock: number | null; subsidy: number };
  priceUsd: number | null;
  economics: ReturnType<typeof miningEconomics> | null;
  sources: Cite[];
  asOf: string;
};

/** Network hashrate series from /v1/mining/hashrate/3m, in EH/s by day. Pure, for tests. */
export function parseHashrate(raw: unknown) {
  const r = (raw ?? {}) as Record<string, unknown>;
  const series = arr<Record<string, unknown>>(r.hashrates).map((h) => ({ date: new Date((num(h.timestamp) ?? 0) * 1000).toISOString().slice(0, 10), ehs: (num(h.avgHashrate) ?? 0) / 1e18 })).filter((h) => h.ehs > 0);
  return { currentEhs: num(r.currentHashrate) !== null ? (num(r.currentHashrate) as number) / 1e18 : series.at(-1)?.ehs ?? null, series, difficulty: num(r.currentDifficulty) };
}

/** Pool shares from /v1/mining/pools/1w. Pure, for tests. */
export function parsePools(raw: unknown) {
  const r = (raw ?? {}) as Record<string, unknown>;
  const total = num(r.blockCount) ?? arr<Record<string, unknown>>(r.pools).reduce((s, p) => s + (num(p.blockCount) ?? 0), 0);
  return arr<Record<string, unknown>>(r.pools).map((p) => ({ name: str(p.name), blocks: num(p.blockCount) ?? 0, share: total ? (num(p.blockCount) ?? 0) / total : 0 })).sort((a, b) => b.blocks - a.blocks).slice(0, 12);
}

export async function bitcoinView(): Promise<BitcoinView> {
  const settle = <T>(p: Promise<T>) => p.catch(() => null);
  const [height, fees, mempool, hashrate, adj, pools, reward, price] = await Promise.all([
    settle(get("/blocks/tip/height", MIN, (raw: unknown) => num(raw))),
    settle(get("/v1/fees/recommended", MIN, (raw: Record<string, unknown>) => ({ fastest: num(raw?.fastestFee), halfHour: num(raw?.halfHourFee), hour: num(raw?.hourFee), economy: num(raw?.economyFee), minimum: num(raw?.minimumFee) }))),
    settle(get("/mempool", MIN, (raw: Record<string, unknown>) => ({ count: num(raw?.count), vsizeMb: num(raw?.vsize) !== null ? (num(raw?.vsize) as number) / 1e6 : null, totalFeeBtc: num(raw?.total_fee) !== null ? (num(raw?.total_fee) as number) / 1e8 : null }))),
    settle(get("/v1/mining/hashrate/3m", 30 * MIN, parseHashrate)),
    settle(get("/v1/difficulty-adjustment", 5 * MIN, (raw: Record<string, unknown>) => ({ progress: num(raw?.progressPercent) !== null ? (num(raw?.progressPercent) as number) / 100 : null, change: num(raw?.difficultyChange) !== null ? (num(raw?.difficultyChange) as number) / 100 : null, remainingBlocks: num(raw?.remainingBlocks), eta: num(raw?.estimatedRetargetDate) ? new Date(num(raw?.estimatedRetargetDate) as number).toISOString() : null }))),
    settle(get("/v1/mining/pools/1w", 30 * MIN, parsePools)),
    settle(get("/v1/mining/reward-stats/144", 10 * MIN, (raw: Record<string, unknown>) => { const blocks = (num(raw?.endBlock) ?? 0) - (num(raw?.startBlock) ?? 0) + 1; const fee = num(raw?.totalFee); return blocks > 0 && fee !== null ? fee / 1e8 / blocks : null; })),
    settle(simplePrices(["bitcoin"])),
  ]);
  if (height === null && !fees && !hashrate) throw new CryptoDataError("mempool.space is not answering right now. Try again in a minute.");
  const subsidy = subsidyAt(height ?? 0);
  const priceUsd = price?.bitcoin?.usd ?? null;
  const economics = hashrate?.currentEhs && priceUsd ? miningEconomics({ hashrateEhs: hashrate.currentEhs, feesPerBlock: reward ?? 0, subsidy, priceUsd }) : null;
  const asOf = new Date().toISOString();
  return {
    height, fees: fees ?? { fastest: null, halfHour: null, hour: null, economy: null, minimum: null }, mempool: mempool ?? { count: null, vsizeMb: null, totalFeeBtc: null },
    hashrate: hashrate ?? { currentEhs: null, series: [], difficulty: null }, adjustment: adj ?? { progress: null, change: null, remainingBlocks: null, eta: null },
    pools: pools ?? [], reward: { feesPerBlock: reward, subsidy }, priceUsd, economics,
    sources: [{ name: MEMPOOL.name, url: MEMPOOL.url, asOf }, ...(priceUsd ? [{ name: "CoinGecko", url: "https://www.coingecko.com/en/coins/bitcoin", asOf }] : [])],
    asOf,
  };
}
