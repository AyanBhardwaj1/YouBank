/**
 * Market-wide views behind WEI (world indices), MOST (movers), SECT (sectors), FXC (currencies),
 * CMDTY (commodities and crypto) and MA (deals). Each quote carries its realized volatility, so a move
 * can be read as a z-score (how unusual it is for that asset) rather than a bare percentage.
 *
 * FMP first; when it is out, each board falls back (see market/data.ts): indices and commodities to
 * the ETFs that track them, currencies to the ECB's reference rates, crypto to CoinGecko, movers to
 * Nasdaq, sectors to the SPDR sector ETFs, deals to merger filings on SEC EDGAR, and the few rows
 * nothing else covers to AI research.
 */
import { tickerMap } from "@/lib/edgar/tickers";
import { fullTextSearch } from "@/lib/edgar/fulltext";
import { returns, stdev } from "@/lib/inference/stats";
import { historyFrom, quotes } from "@/lib/market/data";
import { MarketDataError, mergers, movers, sectorHistory, sectorSnapshot, type Deal, type Mover, type Quote } from "@/lib/market/fmp";
import { backupEnabled, nasdaqHistory, nasdaqMovers } from "@/lib/market/nasdaq";
import { noteSource } from "@/lib/market/provenance";
import { factNum, research } from "@/lib/market/research";

export type AssetRow = {
  symbol: string; name: string; region?: string; price: number | null; d1: number | null; w1: number | null; m1: number | null; ytd: number | null; y1: number | null;
  vol: number | null; z: number | null; spark: number[];
  /** When a backup stood in: the ETF that tracks it ("SPY"), "ECB fixing", or "AI research" (latest level only). */
  via?: string;
};

/** Boards refresh their quotes every ten minutes at most: each quote is one request against the plan's daily limit. */
const BOARD_TTL = 10 * 60_000;

async function rows(list: { symbol: string; name: string; region?: string }[]): Promise<AssetRow[]> {
  const q = await quotes(list.map((l) => l.symbol), BOARD_TTL);
  const from = new Date(Date.now() - 400 * 86_400_000).toISOString().slice(0, 10);
  const out = await Promise.all(list.map(async (l): Promise<AssetRow> => {
    const got = await historyFrom(l.symbol, from, true).catch(() => null);
    const h = got?.data ?? [];
    const c = h.map((x) => x.close);
    // A proxy ETF's own quote would be the ETF's price, so proxied rows use its last close.
    const live = got?.via ? undefined : q[l.symbol];
    const last = live?.price ?? c[c.length - 1] ?? null;
    const back = (n: number) => (c.length > n ? c[c.length - 1 - n] : null);
    const y0 = h.findIndex((x) => x.date.slice(0, 4) === new Date().toISOString().slice(0, 4));
    const r = returns(c.slice(-253), true);
    const daily = r.length > 20 ? stdev(r) : null;
    const d1 = live?.changePercentage !== undefined ? live.changePercentage / 100 : (back(1) && last ? last / (back(1) as number) - 1 : null);
    const ch = (b: number | null) => (b && last ? last / b - 1 : null);
    return {
      ...l, price: last, d1, w1: ch(back(5)), m1: ch(back(21)), ytd: y0 > 0 ? ch(c[y0 - 1]) : null, y1: ch(back(252)),
      vol: daily !== null ? daily * Math.sqrt(252) : null, z: daily && d1 !== null ? d1 / daily : null, spark: c.slice(-60),
      ...(got?.via ? { via: got.via } : {}),
    };
  }));
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

/* ---------------- Movers ---------------- */

/** Penny stocks crowd the raw feeds; the screen shows them but sorts real companies first. */
const realFirst = <T extends { price: number }>(xs: T[]) => [...xs].sort((a, b) => Number(b.price >= 5) - Number(a.price >= 5));

export async function moversView(): Promise<{ actives: Mover[]; gainers: Mover[]; losers: Mover[] }> {
  const [actives, gainers, losers] = await Promise.all([movers("most-actives"), movers("biggest-gainers"), movers("biggest-losers")].map((p) => p.catch(() => null)));
  if (actives?.length || gainers?.length || losers?.length) {
    noteSource("FMP");
    return { actives: realFirst(actives ?? []).slice(0, 25), gainers: realFirst(gainers ?? []).slice(0, 25), losers: realFirst(losers ?? []).slice(0, 25) };
  }
  const n = backupEnabled() ? await nasdaqMovers().catch(() => null) : null;
  if (!n) throw new MarketDataError("Movers are unavailable: FMP is out and the backup did not answer");
  noteSource("Nasdaq");
  const asMover = (m: (typeof n.actives)[number]): Mover => ({ symbol: m.symbol, name: m.name, price: m.price, change: m.change ?? 0, changesPercentage: m.changePct ?? 0, exchange: "" });
  return { actives: realFirst(n.actives.map(asMover)).slice(0, 25), gainers: realFirst(n.gainers.map(asMover)).slice(0, 25), losers: realFirst(n.losers.map(asMover)).slice(0, 25) };
}

/* ---------------- Sectors ---------------- */

/** The SPDR sector ETFs, by the sector names the screen uses: the backup's view of each sector. */
const SECTOR_ETFS: Record<string, string> = {
  Technology: "XLK", "Financial Services": "XLF", Healthcare: "XLV", "Consumer Cyclical": "XLY", "Consumer Defensive": "XLP", Energy: "XLE",
  Industrials: "XLI", "Basic Materials": "XLB", Utilities: "XLU", "Real Estate": "XLRE", "Communication Services": "XLC",
};

type SectorsView = { date: string; sectors: { sector: string; d1: number; m1: number | null; ytd: number | null }[]; via?: string };

export async function sectorsView(): Promise<SectorsView> {
  // The snapshot is by exchange; average the NYSE and Nasdaq figures. Try the last few days (weekends and holidays).
  let date = "", snap: Awaited<ReturnType<typeof sectorSnapshot>> = [];
  for (let back = 0; back < 6 && !snap.length; back++) {
    date = new Date(Date.now() - back * 86_400_000).toISOString().slice(0, 10);
    snap = await sectorSnapshot(date).catch(() => []);
  }
  const monthAgo = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const ytdStart = `${new Date().getUTCFullYear()}-01-01`;
  const today = new Date().toISOString().slice(0, 10);
  if (!snap.length) return sectorsFromEtfs(monthAgo, ytdStart);
  noteSource("FMP");
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

/** Sector performance from the SPDR sector ETFs (a close proxy for the large-cap sectors). */
async function sectorsFromEtfs(monthAgo: string, ytdStart: string): Promise<SectorsView> {
  if (!backupEnabled()) throw new MarketDataError("Sector performance is unavailable: FMP is out and backups are off");
  const from = monthAgo < ytdStart ? new Date(Date.parse(monthAgo) - 10 * 86_400_000).toISOString().slice(0, 10) : new Date(Date.parse(ytdStart) - 10 * 86_400_000).toISOString().slice(0, 10);
  const got = await Promise.all(Object.entries(SECTOR_ETFS).map(async ([sector, etf]) => ({ sector, bars: await nasdaqHistory(etf, from).catch(() => []) })));
  const live = got.filter((g) => g.bars.length > 2);
  if (!live.length) throw new MarketDataError("Sector performance is unavailable: FMP is out and the backup did not answer");
  noteSource("Nasdaq", "Sectors via the SPDR sector ETFs");
  const sectors = live.map(({ sector, bars }) => {
    const c = bars.map((b) => b.close), last = c[c.length - 1];
    const before = (d: string) => { const i = bars.findIndex((b) => b.date > d); return i > 0 ? c[i - 1] : null; };
    const m = before(monthAgo), y = before(ytdStart);
    return { sector, d1: last / c[c.length - 2] - 1, m1: m ? last / m - 1 : null, ytd: y ? last / y - 1 : null };
  });
  return { date: live[0].bars[live[0].bars.length - 1].date, sectors: sectors.sort((a, b) => b.d1 - a.d1), via: "SPDR sector ETFs" };
}

/* ---------------- Deals ---------------- */

/** What each merger filing is, in words, for the backup's deal list. */
const FORM_MEANING: Record<string, string> = {
  "8-K": "8-K: merger agreement announced", DEFM14A: "DEFM14A: definitive merger proxy", PREM14A: "PREM14A: preliminary merger proxy",
  "S-4": "S-4: shares registered for a merger", "SC TO-T": "SC TO-T: tender offer by a buyer", "SC 14D9": "SC 14D9: target's response to a tender offer",
};

export async function dealsView(): Promise<{ deals: Deal[]; via?: string }> {
  const deals = await mergers(0).catch((e) => { if (e instanceof MarketDataError) return null; throw e; });
  if (deals?.length) {
    noteSource("FMP");
    return { deals: deals.sort((a, b) => (a.acceptedDate < b.acceptedDate ? 1 : -1)).slice(0, 80) };
  }
  // Backup: merger agreements and proxies filed on EDGAR in the last three weeks. The target is the
  // filing's subject, which EDGAR does not tag, so the filing's own description stands in for it.
  const from = new Date(Date.now() - 21 * 86_400_000).toISOString().slice(0, 10);
  const [fts, tickers] = await Promise.all([
    fullTextSearch({ q: "\"Agreement and Plan of Merger\"", forms: ["8-K", "DEFM14A", "PREM14A", "S-4", "SC TO-T", "SC 14D9"], from, limit: 100 }),
    tickerMap(),
  ]);
  const byCik = new Map<string, string>();
  for (const t of tickers.values()) { const c = String(Number(t.cik)); if (!byCik.has(c)) byCik.set(c, t.ticker); }
  noteSource("SEC EDGAR", "Deals from merger filings on EDGAR");
  const seen = new Set<string>();
  const rows: Deal[] = [];
  for (const h of fts.hits.sort((a, b) => (a.filed < b.filed ? 1 : -1))) {
    const key = `${h.cik}:${h.form}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      symbol: byCik.get(String(Number(h.cik))) ?? "", companyName: h.entity.replace(/\s*\(CIK \d+\)\s*$/, "").replace(/\s*\([A-Z.\-, ]+\)\s*$/, ""), cik: h.cik,
      targetedCompanyName: FORM_MEANING[h.form.replace(/\/A$/, "")] ? `${FORM_MEANING[h.form.replace(/\/A$/, "")]}${h.form.endsWith("/A") ? " (amended)" : ""}` : h.form,
      targetedCik: "", targetedSymbol: "", transactionDate: h.filed, acceptedDate: h.filed, link: h.url,
    });
  }
  return { deals: rows.slice(0, 80), via: "SEC EDGAR merger filings" };
}

export type { Quote };
