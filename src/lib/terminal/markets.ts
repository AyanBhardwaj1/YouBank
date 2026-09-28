/**
 * Market-wide views behind WEI (world indices), MOST (movers), SECF (sectors), FXC (currencies),
 * CMDTY (commodities and crypto) and MA (deals). Each quote carries its realized volatility, so a move
 * can be read as a z-score (how unusual it is for that asset) rather than a bare percentage.
 */
import { closes, mergers, movers, quotes, sectorHistory, sectorSnapshot, type Quote } from "@/lib/market/fmp";
import { returns, stdev } from "@/lib/inference/stats";

export type AssetRow = { symbol: string; name: string; region?: string; price: number | null; d1: number | null; w1: number | null; m1: number | null; ytd: number | null; y1: number | null; vol: number | null; z: number | null; spark: number[] };

/** Boards refresh their quotes every ten minutes at most: each quote is one request against the plan's daily limit. */
const BOARD_TTL = 10 * 60_000;

async function rows(list: { symbol: string; name: string; region?: string }[]): Promise<AssetRow[]> {
  const q = await quotes(list.map((l) => l.symbol), BOARD_TTL);
  const from = new Date(Date.now() - 400 * 86_400_000).toISOString().slice(0, 10);
  return Promise.all(list.map(async (l) => {
    const h = await closes(l.symbol, from).catch(() => []);
    const c = h.map((x) => x.close);
    const last = q[l.symbol]?.price ?? c[c.length - 1] ?? null;
    const back = (n: number) => (c.length > n ? c[c.length - 1 - n] : null);
    const y0 = h.findIndex((x) => x.date.slice(0, 4) === new Date().toISOString().slice(0, 4));
    const r = returns(c.slice(-253), true);
    const daily = r.length > 20 ? stdev(r) : null;
    const d1 = q[l.symbol]?.changePercentage !== undefined ? q[l.symbol].changePercentage / 100 : (back(1) && last ? last / (back(1) as number) - 1 : null);
    const ch = (b: number | null) => (b && last ? last / b - 1 : null);
    return {
      ...l, price: last, d1, w1: ch(back(5)), m1: ch(back(21)), ytd: y0 > 0 ? ch(c[y0 - 1]) : null, y1: ch(back(252)),
      vol: daily !== null ? daily * Math.sqrt(252) : null, z: daily && d1 !== null ? d1 / daily : null, spark: c.slice(-60),
    };
  }));
}

export const INDICES = [
  { symbol: "^GSPC", name: "S&P 500", region: "Americas" }, { symbol: "^DJI", name: "Dow Jones Industrial", region: "Americas" }, { symbol: "^IXIC", name: "Nasdaq Composite", region: "Americas" },
  { symbol: "^RUT", name: "Russell 2000", region: "Americas" }, { symbol: "^GSPTSE", name: "S&P/TSX Composite", region: "Americas" }, { symbol: "^BVSP", name: "Bovespa", region: "Americas" },
  { symbol: "^FTSE", name: "FTSE 100", region: "Europe" }, { symbol: "^GDAXI", name: "DAX", region: "Europe" }, { symbol: "^FCHI", name: "CAC 40", region: "Europe" }, { symbol: "^STOXX50E", name: "Euro Stoxx 50", region: "Europe" },
  { symbol: "^N225", name: "Nikkei 225", region: "Asia-Pacific" }, { symbol: "^HSI", name: "Hang Seng", region: "Asia-Pacific" }, { symbol: "000001.SS", name: "Shanghai Composite", region: "Asia-Pacific" }, { symbol: "^AXJO", name: "ASX 200", region: "Asia-Pacific" },
  { symbol: "^VIX", name: "VIX volatility", region: "Volatility" },
];
export const FX = [
  { symbol: "EURUSD", name: "Euro" }, { symbol: "USDJPY", name: "Yen" }, { symbol: "GBPUSD", name: "Sterling" }, { symbol: "USDCHF", name: "Swiss franc" },
  { symbol: "AUDUSD", name: "Australian dollar" }, { symbol: "USDCAD", name: "Canadian dollar" }, { symbol: "USDCNH", name: "Offshore yuan" }, { symbol: "USDMXN", name: "Mexican peso" }, { symbol: "USDINR", name: "Indian rupee" },
];
export const COMMODITIES = [
  { symbol: "GCUSD", name: "Gold" }, { symbol: "SIUSD", name: "Silver" }, { symbol: "CLUSD", name: "WTI crude" }, { symbol: "BZUSD", name: "Brent crude" }, { symbol: "NGUSD", name: "Natural gas" },
  { symbol: "HGUSD", name: "Copper" }, { symbol: "ZCUSX", name: "Corn" }, { symbol: "ZWUSX", name: "Wheat" }, { symbol: "BTCUSD", name: "Bitcoin" }, { symbol: "ETHUSD", name: "Ether" },
];

export const worldIndices = () => rows(INDICES);
export const currencies = () => rows(FX);
export const commodities = () => rows(COMMODITIES);

export async function moversView(): Promise<{ actives: Awaited<ReturnType<typeof movers>>; gainers: Awaited<ReturnType<typeof movers>>; losers: Awaited<ReturnType<typeof movers>> }> {
  const [actives, gainers, losers] = await Promise.all([movers("most-actives"), movers("biggest-gainers"), movers("biggest-losers")]);
  // Penny stocks crowd the raw feeds; the screen shows them but sorts real companies first.
  const real = <T extends { price: number }>(xs: T[]) => [...xs].sort((a, b) => Number(b.price >= 5) - Number(a.price >= 5));
  return { actives: real(actives).slice(0, 25), gainers: real(gainers).slice(0, 25), losers: real(losers).slice(0, 25) };
}

export async function sectorsView(): Promise<{ date: string; sectors: { sector: string; d1: number; m1: number | null; ytd: number | null }[] }> {
  // The snapshot is by exchange; average the NYSE and Nasdaq figures. Try the last few days (weekends and holidays).
  let date = "", snap: Awaited<ReturnType<typeof sectorSnapshot>> = [];
  for (let back = 0; back < 6 && !snap.length; back++) {
    date = new Date(Date.now() - back * 86_400_000).toISOString().slice(0, 10);
    snap = await sectorSnapshot(date).catch(() => []);
  }
  const bySector = new Map<string, number[]>();
  for (const s of snap) bySector.set(s.sector, [...(bySector.get(s.sector) ?? []), s.averageChange]);
  const monthAgo = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const ytdStart = `${new Date().getUTCFullYear()}-01-01`;
  const today = new Date().toISOString().slice(0, 10);
  const sectors = await Promise.all([...bySector.entries()].map(async ([sector, v]) => {
    const h = await sectorHistory(sector, monthAgo < ytdStart ? monthAgo : ytdStart, today).catch(() => []);
    // Average each day across exchanges, then compound the daily changes.
    const byDate = new Map<string, number[]>();
    for (const x of h) byDate.set(x.date, [...(byDate.get(x.date) ?? []), x.averageChange]);
    const days = [...byDate.entries()].map(([d, xs]) => ({ d, r: xs.reduce((a, b) => a + b, 0) / xs.length / 100 }));
    const since = (from: string) => { const xs = days.filter((x) => x.d > from); return xs.length ? xs.reduce((a, x) => a * (1 + x.r), 1) - 1 : null; };
    return { sector, d1: v.reduce((a, x) => a + x, 0) / v.length / 100, m1: since(monthAgo), ytd: since(ytdStart) };
  }));
  return { date, sectors: sectors.sort((a, b) => b.d1 - a.d1) };
}

export async function dealsView(): Promise<{ deals: Awaited<ReturnType<typeof mergers>> }> {
  const deals = await mergers(0);
  return { deals: deals.sort((a, b) => (a.acceptedDate < b.acceptedDate ? 1 : -1)).slice(0, 80) };
}

export type { Quote };
