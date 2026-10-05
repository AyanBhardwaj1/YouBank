/**
 * On-chain deal intelligence: crypto venture rounds and token unlocks (DefiLlama), and public
 * companies' crypto treasuries (SEC XBRL). Server only, except the pure parsers.
 *
 * DefiLlama serves raises and unlock schedules on its open API today; if it moves them behind its
 * paid API, DEFILLAMA_API_KEY points the same calls at pro-api.llama.fi. The paid route is used only
 * when a person with "crypto.pro-data" explicitly asks for it (the Newsroom and the nightly directory
 * sync always use the open API), so no cron ever spends.
 *
 * Treasuries come from the XBRL "frames" API: every filer's value of one concept for one quarter.
 * Since ASU 2023-08 (effective 2025, early adoption allowed) companies report crypto assets at fair
 * value under CryptoAssetFairValue (current and noncurrent); earlier filers that carried bitcoin as an
 * impaired intangible are not in these frames, which the screen says.
 */
import { cacheJson } from "@/lib/cache";
import { edgarJson, HOUR as EDGAR_HOUR } from "@/lib/edgar/client";
import { tickerMap } from "@/lib/edgar/tickers";
import { arr, cachedJson, CryptoDataError, HOUR, num, str } from "./http";
import { SEC_XBRL, type Cite } from "./sources";

const SRC = "DefiLlama";

function llama(path: string, pro: boolean): string {
  const key = process.env.DEFILLAMA_API_KEY?.trim();
  return pro && key ? `https://pro-api.llama.fi/${key}/api${path}` : `https://api.llama.fi${path}`;
}
export const hasLlamaPro = () => !!process.env.DEFILLAMA_API_KEY?.trim();

/* ---------------- Venture rounds ---------------- */

export type Raise = {
  date: string; name: string; round: string; amountUsd: number | null; valuationUsd: number | null; chains: string[];
  sector: string; category: string; leads: string[]; others: string[]; source: string;
};

/** /raises, newest first; amounts come in millions and are returned in dollars. Pure, for tests. */
export function parseRaises(raw: unknown): Raise[] {
  const list = arr<Record<string, unknown>>((raw as { raises?: unknown })?.raises);
  const m = (v: unknown) => { const n = num(v); return n === null || n <= 0 ? null : n * 1e6; };
  return list.map((r) => {
    const t = num(r.date);
    return {
      date: t ? new Date(t * 1000).toISOString().slice(0, 10) : "", name: str(r.name), round: str(r.round), amountUsd: m(r.amount), valuationUsd: m(r.valuation),
      chains: arr<unknown>(r.chains).map(str).filter(Boolean), sector: str(r.sector), category: str(r.category) || str(r.categoryGroup),
      leads: arr<unknown>(r.leadInvestors).map(str).filter(Boolean), others: arr<unknown>(r.otherInvestors).map(str).filter(Boolean), source: str(r.source),
    };
  }).filter((r) => r.name && r.date).sort((a, b) => (a.date < b.date ? 1 : -1));
}

/** The last ~1,500 rounds (newest first). */
export function cryptoRaises(pro = false): Promise<Raise[]> {
  return cachedJson(llama("/raises", pro), { key: `crypto:llama:raises:${pro ? "pro" : "free"}`, ttlMs: 6 * HOUR, source: pro ? "DefiLlama Pro" : SRC, timeoutMs: 30_000 }, (raw: unknown) => parseRaises(raw).slice(0, 1500));
}

/** Who leads the most rounds in a list, with the dollars they led. Pure, for tests. */
export function topInvestors(raises: Raise[], n = 12) {
  const by = new Map<string, { name: string; rounds: number; usd: number }>();
  for (const r of raises) for (const lead of r.leads) {
    const e = by.get(lead) ?? { name: lead, rounds: 0, usd: 0 };
    e.rounds++; e.usd += r.amountUsd ?? 0; by.set(lead, e);
  }
  return [...by.values()].sort((a, b) => b.rounds - a.rounds || b.usd - a.usd).slice(0, n);
}

/* ---------------- Token unlocks ---------------- */

export type Unlock = {
  name: string; geckoId: string | null; price: number | null; mcap: number | null; circulating: number | null; maxSupply: number | null;
  /** Next scheduled unlock: when, how many tokens, their value now, and their share of circulating supply. */
  nextDate: string | null; nextTokens: number | null; nextUsd: number | null; nextShare: number | null;
  perDay: number | null; locked: number | null;
};

/** /emissions, normalised: soonest unlock first. Pure, for tests. */
export function parseUnlocks(raw: unknown, now = Date.now()): Unlock[] {
  return arr<Record<string, unknown>>(raw).map((u) => {
    const next = (u.nextEvent ?? {}) as Record<string, unknown>;
    const t = num(next.date), tokens = num(next.toUnlock), price = num(u.tPrice), circ = num(u.circSupply);
    const geckoRaw = str(u.gecko_id) || str(u.token).replace(/^coingecko:/, "");
    return {
      name: str(u.name), geckoId: geckoRaw || null, price, mcap: num(u.mcap), circulating: circ, maxSupply: num(u.maxSupply),
      nextDate: t ? new Date(t * 1000).toISOString().slice(0, 10) : null, nextTokens: tokens, nextUsd: tokens !== null && price !== null ? tokens * price : null,
      nextShare: tokens !== null && circ ? tokens / circ : null, perDay: num(u.unlocksPerDay), locked: num(u.totalLocked),
    };
  }).filter((u) => u.name && u.nextDate && Date.parse(u.nextDate) >= now - 86_400_000).sort((a, b) => ((a.nextDate ?? "") < (b.nextDate ?? "") ? -1 : 1));
}

export function tokenUnlocks(pro = false): Promise<Unlock[]> {
  return cachedJson(llama("/emissions", pro), { key: `crypto:llama:unlocks:${pro ? "pro" : "free"}`, ttlMs: 6 * HOUR, source: pro ? "DefiLlama Pro" : SRC, timeoutMs: 30_000 }, (raw: unknown) => parseUnlocks(raw).slice(0, 400));
}

/* ---------------- Public companies' crypto treasuries ---------------- */

export type TreasuryRow = { cik: string; ticker: string; name: string; fairValue: number; asOf: string; accession: string; url: string };

const CONCEPTS = ["CryptoAssetFairValueNoncurrent", "CryptoAssetFairValueCurrent", "CryptoAssetFairValue"] as const;
type Frame = { data?: { accn?: string; cik?: number; entityName?: string; end?: string; val?: number }[] };

/** The quarter-end frames worth asking for: the last few that filers have had time to report (45 days). Pure. */
export function recentFrames(now = new Date(), n = 4): string[] {
  const out: string[] = [];
  const d = new Date(now.getTime() - 45 * 86_400_000);
  let y = d.getUTCFullYear(), q = Math.floor(d.getUTCMonth() / 3); // the quarter before the current one
  if (q === 0) { y--; q = 4; }
  for (let i = 0; i < n; i++) { out.push(`CY${y}Q${q}I`); q--; if (q === 0) { y--; q = 4; } }
  return out;
}

/**
 * One row per company: its latest reported fair value of crypto assets (the total concept when given,
 * else current plus noncurrent), from the newest frame it appears in. Pure, for tests.
 */
export function mergeTreasuries(frames: { period: string; concept: string; frame: Frame }[], tickers: Map<string, string>): TreasuryRow[] {
  const by = new Map<string, { name: string; end: string; accn: string; parts: Record<string, number> }>();
  for (const { concept, frame } of frames) for (const d of frame.data ?? []) {
    if (!d.cik || typeof d.val !== "number" || !d.end) continue;
    const cik = String(d.cik).padStart(10, "0");
    const cur = by.get(cik);
    if (!cur || d.end > cur.end) by.set(cik, { name: d.entityName ?? "", end: d.end, accn: d.accn ?? "", parts: { [concept]: d.val } });
    else if (d.end === cur.end) cur.parts[concept] = Math.max(cur.parts[concept] ?? 0, d.val);
  }
  return [...by.entries()].map(([cik, e]) => {
    const total = e.parts.CryptoAssetFairValue ?? (e.parts.CryptoAssetFairValueCurrent ?? 0) + (e.parts.CryptoAssetFairValueNoncurrent ?? 0);
    return { cik, ticker: tickers.get(cik) ?? "", name: e.name, fairValue: total, asOf: e.end, accession: e.accn, url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=10-Q` };
  }).filter((r) => r.fairValue > 0).sort((a, b) => b.fairValue - a.fairValue);
}

export async function cryptoTreasuries(): Promise<{ rows: TreasuryRow[]; periods: string[]; sources: Cite[] }> {
  const periods = recentFrames();
  return cacheJson(`crypto:treasuries:v1:${periods[0]}`, 12 * HOUR, async () => {
    const jobs = periods.flatMap((period) => CONCEPTS.map((concept) => ({ period, concept })));
    const frames: { period: string; concept: string; frame: Frame }[] = [];
    for (const j of jobs) {
      // A frame no filer has used yet is a 404; skip it.
      const frame = await edgarJson<Frame>(`https://data.sec.gov/api/xbrl/frames/us-gaap/${j.concept}/USD/${j.period}.json`, `frames-${j.concept}-${j.period}.json`, 12 * EDGAR_HOUR).catch(() => null);
      if (frame) frames.push({ ...j, frame });
    }
    if (!frames.length) throw new CryptoDataError("SEC EDGAR did not return any crypto-asset filings just now. Try again later.");
    const byCik = new Map<string, string>();
    for (const t of (await tickerMap().catch(() => new Map())).values()) if (!byCik.has(t.cik)) byCik.set(t.cik, t.ticker);
    return { rows: mergeTreasuries(frames, byCik).slice(0, 150), periods, sources: [{ name: SEC_XBRL.name, url: "https://www.sec.gov/edgar/sec-api-documentation" }] };
  });
}
