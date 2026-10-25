/**
 * Market-wide views behind WEI (world indices), MOST (movers), SECT (sectors), FXC (currencies),
 * CMDTY (commodities and crypto) and MA (deals). Each quote carries its realized volatility, so a move
 * can be read as a z-score (how unusual it is for that asset) rather than a bare percentage.
 *
 * FMP first; when it is out or slow, each board falls back (the registry's chains, market/registry.ts):
 * indices and commodities to the ETFs that track them, currencies to the ECB's reference rates, crypto to
 * CoinGecko, movers to Nasdaq, sectors to the SPDR sector ETFs, deals to merger filings on SEC EDGAR, and
 * the few rows nothing else covers to AI research. A board's quotes and histories are fetched at once.
 */
import { returns, stdev } from "@/lib/inference/stats";
import { SECT_DATE_CONCURRENCY } from "@/lib/market/budgets";
import { mapLimit } from "@/lib/market/chain";
import { historyFrom, quotes } from "@/lib/market/data";
import { MarketDataError, mergers, movers, sectorHistory, sectorSnapshot, type Deal, type Mover, type Quote } from "@/lib/market/fmp";
import { backupEnabled, nasdaqHistory, nasdaqMovers, type NasdaqMover } from "@/lib/market/nasdaq";
import { noteSource } from "@/lib/market/provenance";
import type { Positioning } from "@/lib/market/cftc";
import { fromChain, isEmptyAnswer, NoSourceError } from "@/lib/market/registry";
import { latestTradingDay, marketDate, marketYear, previousTradingDay } from "@/lib/market/calendar";
import { pctToFraction } from "@/lib/market/units";
import { factNum, research } from "@/lib/market/research";

export type AssetRow = {
  symbol: string; name: string; region?: string; price: number | null; d1: number | null; w1: number | null; m1: number | null; ytd: number | null; y1: number | null;
  vol: number | null; z: number | null; spark: number[];
  /** When a backup stood in: the ETF that tracks it ("SPY"), "ECB fixing", or "AI research" (latest level only). */
  via?: string;
  /** For an ETF stand-in, what the level is ("S&P 500 via SPY"): the price is the ETF's, never the index level. */
  label?: string;
  /** "monthly" when only monthly averages answered (the World Bank): no daily move, volatility or z-score is read from them. */
  cadence?: "monthly";
  /** Futures positioning from the CFTC's Commitments of Traders (CMDTY). */
  positioning?: Positioning;
};

/** Boards refresh their quotes every ten minutes at most: each quote is one request against the plan's daily limit. */
const BOARD_TTL = 10 * 60_000;

async function rows(list: { symbol: string; name: string; region?: string }[]): Promise<AssetRow[]> {
  const from = new Date(Date.now() - 400 * 86_400_000).toISOString().slice(0, 10);
  // Quotes and histories at once (each hedged on its own), not one after the other.
  const [q, hist] = await Promise.all([
    quotes(list.map((l) => l.symbol), BOARD_TTL),
    Promise.all(list.map((l) => historyFrom(l.symbol, from, true).catch(() => null))),
  ]);
  const out = list.map((l, i): AssetRow => {
    const got = hist[i];
    if (got?.via === MONTHLY_VIA) return monthlyRow(l, got.data, got.label);
    const h = got?.data ?? [];
    const c = h.map((x) => x.close);
    // A proxy ETF's own quote would be the ETF's price, so proxied rows use its last close.
    const live = got?.via ? undefined : q[l.symbol];
    const last = live?.price ?? c[c.length - 1] ?? null;
    const back = (n: number) => (c.length > n ? c[c.length - 1 - n] : null);
    const y0 = h.findIndex((x) => x.date.slice(0, 4) === String(marketYear()));
    const r = returns(c.slice(-253), true);
    const daily = r.length > 20 ? stdev(r) : null;
    const d1 = live?.changePct ?? (back(1) && last ? last / (back(1) as number) - 1 : null);
    const ch = (b: number | null) => (b && last ? last / b - 1 : null);
    return {
      ...l, price: last, d1, w1: ch(back(5)), m1: ch(back(21)), ytd: y0 > 0 ? ch(c[y0 - 1]) : null, y1: ch(back(252)),
      vol: daily !== null ? daily * Math.sqrt(252) : null, z: daily && d1 !== null ? d1 / daily : null, spark: c.slice(-60),
      ...(got?.via ? { via: got.via } : {}), ...(got?.label ? { label: got.label } : {}),
    };
  });
  // Rows no feed covers (the VIX has no ETF that tracks its level): AI research for the latest level,
  // only for a few rows, so an outage of every feed does not become a wave of paid lookups.
  const missing = out.filter((r) => r.price === null);
  if (missing.length && missing.length <= 3) {
    await Promise.all(missing.map(async (row) => {
      const res = await research(`${row.name} (${row.symbol.replace(/^\^/, "")})`, ["price", "changePct"]).catch(() => null);
      const price = factNum(res, "price");
      if (price === null) return;
      noteSource("AI research", `${row.name}: latest level researched on the web`);
      row.price = price; row.d1 = factNum(res, "changePct"); row.via = "AI research";
    }));
  }
  return out;
}

/** The World Bank's monthly averages (registry.ts): a row from them reads month on month, never as a day's move. */
const MONTHLY_VIA = "World Bank monthly";
function monthlyRow(l: { symbol: string; name: string; region?: string }, h: { date: string; close: number }[], label?: string): AssetRow {
  const c = h.map((x) => x.close), last = c.at(-1) ?? null;
  const ch = (n: number) => (c.length > n && last ? last / c[c.length - 1 - n] - 1 : null);
  return { ...l, price: last, d1: null, w1: null, m1: ch(1), ytd: null, y1: ch(12), vol: null, z: null, spark: c.slice(-24), via: MONTHLY_VIA, cadence: "monthly", ...(label ? { label } : {}) };
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
/** CMDTY: the board, with the CFTC's latest positioning for each contract where it has one (public data; the board stands without it). */
export async function commodities(): Promise<AssetRow[]> {
  const [board, cot] = await Promise.all([rows(COMMODITIES), fromChain("cot", {}).catch(() => null)]);
  return cot ? board.map((r) => (cot.data[r.symbol] ? { ...r, positioning: cot.data[r.symbol] } : r)) : board;
}

/* ---------------- Movers ---------------- */

/** Penny stocks crowd the raw feeds; the screen shows them but sorts real companies first. */
const realFirst = <T extends { price: number }>(xs: T[]) => [...xs].sort((a, b) => Number(b.price >= 5) - Number(a.price >= 5));

/** A mover as the screen shows it: change as a fraction, null when the feed has none. */
export type MoverRow = { symbol: string; name: string; price: number; change: number | null; changePct: number | null; exchange: string };
const fromFmpMover = (m: Mover): MoverRow => ({ symbol: m.symbol, name: m.name, price: m.price, change: m.change, changePct: pctToFraction(m.changesPercentage), exchange: m.exchange });

/** FMP's three movers lists, or null when none answered. */
export async function fmpMovers(): Promise<{ actives: MoverRow[]; gainers: MoverRow[]; losers: MoverRow[] } | null> {
  const [actives, gainers, losers] = await Promise.all([movers("most-actives"), movers("biggest-gainers"), movers("biggest-losers")].map((p) => p.catch(() => null)));
  if (!actives?.length && !gainers?.length && !losers?.length) return null;
  const top = (xs: Mover[] | null) => realFirst((xs ?? []).map(fromFmpMover)).slice(0, 25);
  return { actives: top(actives), gainers: top(gainers), losers: top(losers) };
}

/** Nasdaq's movers in the same shape, or null. */
export async function nasdaqMoversView(): Promise<{ actives: MoverRow[]; gainers: MoverRow[]; losers: MoverRow[] } | null> {
  const n = await nasdaqMovers().catch(() => null);
  if (!n) return null;
  const asMover = fromNasdaqMover;
  return { actives: realFirst(n.actives.map(asMover)).slice(0, 25), gainers: realFirst(n.gainers.map(asMover)).slice(0, 25), losers: realFirst(n.losers.map(asMover)).slice(0, 25) };
}

/** A Nasdaq mover as the screen's row (a missing change stays null). */
export const fromNasdaqMover = (m: NasdaqMover): MoverRow => ({ symbol: m.symbol, name: m.name, price: m.price, change: m.change, changePct: m.changePct, exchange: "" });

export async function moversView(): Promise<{ actives: MoverRow[]; gainers: MoverRow[]; losers: MoverRow[] }> {
  try {
    return (await fromChain("movers", {})).data;
  } catch (e) {
    if (isEmptyAnswer(e) || e instanceof NoSourceError || e instanceof MarketDataError) throw new MarketDataError("Movers are unavailable: FMP is out and the backup did not answer");
    throw e;
  }
}

/* ---------------- Sectors ---------------- */

/** The SPDR sector ETFs, by the sector names the screen uses: the backup's view of each sector. */
const SECTOR_ETFS: Record<string, string> = {
  Technology: "XLK", "Financial Services": "XLF", Healthcare: "XLV", "Consumer Cyclical": "XLY", "Consumer Defensive": "XLP", Energy: "XLE",
  Industrials: "XLI", "Basic Materials": "XLB", Utilities: "XLU", "Real Estate": "XLRE", "Communication Services": "XLC",
};

type SectorsView = { date: string; sectors: { sector: string; d1: number; m1: number | null; ytd: number | null }[]; via?: string };

/** FMP's sector snapshot (the newest of the last six trading days that has one; tried a few at once) and its month and year-to-date history, or null. */
export async function fmpSectors(): Promise<SectorsView | null> {
  // The snapshot is by exchange; average the NYSE and Nasdaq figures. Weekends and holidays need older days:
  // trading days in New York, latest first (after 8 pm ET the UTC date is already tomorrow).
  const dates: string[] = [];
  for (let back = 0, d = latestTradingDay(); back < 6; back++, d = previousTradingDay(d)) dates.push(d);
  const snaps = await mapLimit(dates, SECT_DATE_CONCURRENCY, (d) => sectorSnapshot(d).catch(() => [] as Awaited<ReturnType<typeof sectorSnapshot>>));
  const i = snaps.findIndex((x) => x.length);
  if (i < 0) return null;
  const date = dates[i], snap = snaps[i];
  const monthAgo = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const ytdStart = `${marketYear()}-01-01`;
  const today = marketDate();
  const bySector = new Map<string, number[]>();
  for (const s of snap) bySector.set(s.sector, [...(bySector.get(s.sector) ?? []), s.averageChange]);
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

export async function sectorsView(): Promise<SectorsView> {
  try {
    return (await fromChain("sectors", {})).data;
  } catch (e) {
    if (isEmptyAnswer(e) || e instanceof NoSourceError || e instanceof MarketDataError) {
      throw new MarketDataError(backupEnabled() ? "Sector performance is unavailable: FMP is out and the backup did not answer" : "Sector performance is unavailable: FMP is out and backups are off");
    }
    throw e;
  }
}

/** Sector performance from the SPDR sector ETFs (a close proxy for the large-cap sectors), or null. */
export async function etfSectors(): Promise<SectorsView | null> {
  const monthAgo = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const ytdStart = `${marketYear()}-01-01`;
  const from = monthAgo < ytdStart ? new Date(Date.parse(monthAgo) - 10 * 86_400_000).toISOString().slice(0, 10) : new Date(Date.parse(ytdStart) - 10 * 86_400_000).toISOString().slice(0, 10);
  const got = await Promise.all(Object.entries(SECTOR_ETFS).map(async ([sector, etf]) => ({ sector, bars: await nasdaqHistory(etf, from).catch(() => []) })));
  const live = got.filter((g) => g.bars.length > 2);
  if (!live.length) return null;
  const sectors = live.map(({ sector, bars }) => {
    const c = bars.map((b) => b.close), last = c[c.length - 1];
    const before = (d: string) => { const i = bars.findIndex((b) => b.date > d); return i > 0 ? c[i - 1] : null; };
    const m = before(monthAgo), y = before(ytdStart);
    return { sector, d1: last / c[c.length - 2] - 1, m1: m ? last / m - 1 : null, ytd: y ? last / y - 1 : null };
  });
  return { date: live[0].bars[live[0].bars.length - 1].date, sectors: sectors.sort((a, b) => b.d1 - a.d1), via: "SPDR sector ETFs" };
}

/* ---------------- Deals ---------------- */

/** FMP's latest deals, newest first, or null when it has none. FMP's failures are thrown (the chain falls back). */
export async function fmpDeals(): Promise<Deal[] | null> {
  const deals = await mergers(0);
  return deals?.length ? deals.sort((a, b) => (a.acceptedDate < b.acceptedDate ? 1 : -1)).slice(0, 80) : null;
}

/** FMP's deals, else (on any FMP failure, or when it is slow) merger filings on EDGAR. */
export async function dealsView(): Promise<{ deals: Deal[]; via?: string }> {
  try {
    return (await fromChain("deals", {})).data;
  } catch (e) {
    if (isEmptyAnswer(e) || e instanceof NoSourceError) return { deals: [], via: "SEC EDGAR merger filings" };
    throw e;
  }
}

export type { Quote };
