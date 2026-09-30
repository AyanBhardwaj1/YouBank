/**
 * The history scenarios are built from, all public and none of it FRED (whose terms bar model use):
 * - daily returns of the chosen tickers (Nasdaq's history first, FMP as the backup, sparing its quota);
 * - daily factor moves since 2000: the whole U.S. market and the oil and gas industry (Kenneth French's
 *   data library, from CRSP), WTI crude and Henry Hub gas spot prices (EIA), and the 10-year Treasury
 *   yield (the Treasury's daily par curve).
 * Factors are rebuilt weekly and kept in R2; past years never change.
 */
import { inflateRawSync } from "node:zlib";
import { logError } from "@/lib/errors";
import { closes as marketCloses } from "@/lib/market/data";
import { nasdaqHistory } from "@/lib/market/nasdaq";
import { getJson, putJson, r2Ready } from "../infra/r2";

export const FACTORS = ["market", "energy", "oil", "gas", "rates"] as const;
export type Factor = (typeof FACTORS)[number];
export const FACTOR_LABEL: Record<Factor, string> = { market: "U.S. stock market", energy: "Oil and gas stocks", oil: "WTI crude", gas: "Henry Hub gas", rates: "10-year Treasury yield" };
/** Daily factor moves by date: log returns for the market, energy, oil and gas; the yield's change in percentage points. */
export type FactorRow = { date: string } & Record<Factor, number>;

const UA = { "User-Agent": "YouBank research (Edge scenarios)" };

/** The first file inside a zip archive (central directory read, then raw inflate). */
export function unzipFirst(buf: Uint8Array): string {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 70_000); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("not a zip file");
  const cd = dv.getUint32(eocd + 16, true);
  if (dv.getUint32(cd, true) !== 0x02014b50) throw new Error("bad zip directory");
  const method = dv.getUint16(cd + 10, true), size = dv.getUint32(cd + 20, true), local = dv.getUint32(cd + 42, true);
  const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
  const data = buf.subarray(start, start + size);
  return (method === 0 ? Buffer.from(data) : inflateRawSync(data)).toString("latin1");
}

/** Kenneth French's daily CSV: dates (YYYYMMDD) and the named columns, in percent; -99.99 is missing. */
export function frenchColumns(csv: string, columns: string[]): Map<string, number[]> {
  const out = new Map<string, number[]>();
  let head: string[] | null = null;
  for (const line of csv.split(/\r?\n/)) {
    const cells = line.split(",").map((c) => c.trim());
    if (!head) { if (cells[0] === "" && cells.length > 2 && columns.every((c) => cells.includes(c))) head = cells; continue; }
    if (!/^\d{8}$/.test(cells[0])) { if (out.size) break; continue; }
    const date = `${cells[0].slice(0, 4)}-${cells[0].slice(4, 6)}-${cells[0].slice(6, 8)}`;
    out.set(date, columns.map((c) => { const v = Number(cells[head!.indexOf(c)]); return v <= -99 ? NaN : v; }));
  }
  return out;
}

/** EIA's weekly-row daily price table (Monday to Friday per row) into dated prices. */
export function eiaDaily(html: string): Map<string, number> {
  const out = new Map<string, number>();
  const months: Record<string, number> = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
  for (const m of html.matchAll(/<td class=['"]B6['"]>[^0-9]*(\d{4})\s+([A-Z][a-z]{2})-\s*(\d{1,2})[^<]*<\/td>((?:\s*<td class=['"]B3['"]>[^<]*<\/td>){1,5})/g)) {
    const monday = Date.UTC(Number(m[1]), months[m[2]] ?? 0, Number(m[3]));
    [...m[4].matchAll(/<td class=['"]B3['"]>([^<]*)<\/td>/g)].forEach((c, i) => {
      const v = Number(c[1].trim());
      if (c[1].trim() !== "" && Number.isFinite(v)) out.set(new Date(monday + i * 86_400_000).toISOString().slice(0, 10), v);
    });
  }
  return out;
}

async function treasuryTenYear(year: number): Promise<Map<string, number>> {
  const url = `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/${year}/all?type=daily_treasury_yield_curve&field_tdr_date_value=${year}&page&_format=csv`;
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`Treasury ${res.status}`);
  const [head, ...lines] = (await res.text()).trim().split("\n");
  const cols = head.split(",").map((c) => c.replace(/"/g, "").trim());
  const at = cols.indexOf("10 Yr");
  const out = new Map<string, number>();
  for (const l of lines) {
    const v = l.split(","), [mm, dd, yy] = v[0].split("/");
    const y = Number(v[at]);
    if (at > 0 && Number.isFinite(y) && v[at] !== "") out.set(`${yy}-${mm}-${dd}`, y);
  }
  return out;
}

const KEY = "scen/factors-v1.json";

/** Rebuild the factor history from the sources (a few requests; about half a megabyte of JSON). */
export async function buildFactors(): Promise<FactorRow[]> {
  const get = async (url: string) => { const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(60_000) }); if (!r.ok) throw new Error(`${url} answered ${r.status}`); return r; };
  const [ff, ind, wti, hh] = await Promise.all([
    get("https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/ftp/F-F_Research_Data_Factors_daily_CSV.zip").then(async (r) => frenchColumns(unzipFirst(new Uint8Array(await r.arrayBuffer())), ["Mkt-RF", "RF"])),
    get("https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/ftp/49_Industry_Portfolios_daily_CSV.zip").then(async (r) => frenchColumns(unzipFirst(new Uint8Array(await r.arrayBuffer())), ["Oil"])),
    get("https://www.eia.gov/dnav/pet/hist/RWTCD.htm").then(async (r) => eiaDaily(await r.text())),
    get("https://www.eia.gov/dnav/ng/hist/rngwhhdD.htm").then(async (r) => eiaDaily(await r.text())),
  ]);
  const thisYear = new Date().getUTCFullYear();
  const years = Array.from({ length: thisYear - 2000 + 1 }, (_, i) => 2000 + i);
  const tsy = new Map<string, number>();
  for (let i = 0; i < years.length; i += 6) {
    const got = await Promise.all(years.slice(i, i + 6).map((y) => treasuryTenYear(y).catch(() => new Map<string, number>())));
    for (const m of got) for (const [d, v] of m) tsy.set(d, v);
  }
  const dates = [...new Set([...ff.keys()].filter((d) => d >= "2000-01-01"))].sort();
  // Carry the last price across days a source did not publish, so daily moves line up.
  const rows: FactorRow[] = [];
  let pw = NaN, ph = NaN, py = NaN;
  for (const d of dates) {
    const f = ff.get(d)!, o = ind.get(d)?.[0] ?? NaN;
    const w = wti.get(d), h = hh.get(d), y = tsy.get(d);
    const lr = (now: number | undefined, prev: number) => (now !== undefined && now > 0 && prev > 0 ? Math.max(-0.5, Math.min(0.5, Math.log(now / prev))) : 0);
    const row: FactorRow = { date: d, market: Math.log(1 + (f[0] + f[1]) / 100), energy: Number.isFinite(o) ? Math.log(1 + o / 100) : 0, oil: lr(w, pw), gas: lr(h, ph), rates: y !== undefined && Number.isFinite(py) ? y - py : 0 };
    if (w !== undefined && w > 0) pw = w;
    if (h !== undefined && h > 0) ph = h;
    if (y !== undefined) py = y;
    rows.push(row);
  }
  return rows;
}

let memo: { at: number; rows: FactorRow[] } | null = null;

/** The factor history, from memory, R2 (a week old at most), or rebuilt. */
export async function factorHistory(): Promise<FactorRow[]> {
  if (memo && Date.now() - memo.at < 6 * 3_600_000) return memo.rows;
  if (r2Ready()) {
    const cached = await getJson<{ builtAt: string; rows: FactorRow[] }>(KEY).catch(() => null);
    if (cached?.rows?.length && Date.now() - Date.parse(cached.builtAt) < 7 * 86_400_000) { memo = { at: Date.now(), rows: cached.rows }; return cached.rows; }
  }
  const rows = await buildFactors();
  if (r2Ready()) await putJson(KEY, { builtAt: new Date().toISOString(), rows }).catch((e) => logError(e, { where: "edge-scen-factors" }));
  memo = { at: Date.now(), rows };
  return rows;
}

/** Daily closes for a ticker: Nasdaq first (sparing FMP's small quota), FMP as the backup. */
async function closes(ticker: string, from: string): Promise<{ date: string; close: number }[]> {
  const nd = await nasdaqHistory(ticker, from).catch(() => []);
  if (nd.length > 60) return nd.map((b) => ({ date: b.date, close: b.close }));
  return marketCloses(ticker, from).catch(() => []);
}

export type Returns = { names: string[]; dates: string[]; rows: number[][]; missing: string[] };

/** Daily log returns of the tickers on the days all of them traded, over the last `years`. */
export async function tickerReturns(tickers: string[], years = 3): Promise<Returns> {
  const from = new Date(Date.now() - years * 365.25 * 86_400_000).toISOString().slice(0, 10);
  const got = await Promise.all(tickers.map(async (t) => ({ t, c: await closes(t, from) })));
  const ok = got.filter((g) => g.c.length > 120), missing = got.filter((g) => g.c.length <= 120).map((g) => g.t);
  if (!ok.length) return { names: [], dates: [], rows: [], missing };
  const maps = ok.map((g) => new Map(g.c.map((x) => [x.date, x.close])));
  const dates = [...maps[0].keys()].filter((d) => maps.every((m) => m.has(d))).sort();
  const rows: number[][] = [], used: string[] = [];
  for (let i = 1; i < dates.length; i++) {
    const r = maps.map((m) => Math.log(m.get(dates[i])! / m.get(dates[i - 1])!));
    if (r.every(Number.isFinite)) { rows.push(r); used.push(dates[i]); }
  }
  return { names: ok.map((g) => g.t), dates: used, rows, missing };
}
