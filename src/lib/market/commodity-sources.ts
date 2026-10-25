/**
 * Free commodity prices for the CMDTY board (registry.ts, dataset "commodity"), after FMP:
 * - the EIA's daily spot prices (public domain): WTI at Cushing, Brent, Henry Hub natural gas. Spot is
 *   not the futures price FMP quotes, and the label says so;
 * - the World Bank's Pink Sheet (CC BY 4.0): monthly average prices for metals, grains and energy, read
 *   from its published workbook by the code row (CRUDE_WTI, GOLD…), never by column position. Monthly
 *   averages are labelled as such, and the board does not read a month's change as a day's.
 * Both are converted to the units of the symbol they stand for (copper in $/lb, grains in cents a bushel).
 */
import { cacheEntry } from "@/lib/cache";
import { fetchRetry } from "@/lib/net";
import { z } from "zod";
import { budget, MACRO_STALE_IF_ERROR_MS } from "./budgets";
import { eiaSeries } from "./macro-sources";
import { noteFreshness } from "./provenance";
import { callSource } from "./source";
import { canonical } from "./symbols";
import { parseOrThrow } from "./validate";

const HOUR = 3_600_000;

/* ---------------- EIA spot ---------------- */

/** Board symbol -> EIA series and what it is. */
export const EIA_SPOT: Record<string, { id: string; name: string }> = {
  CLUSD: { id: "RWTC", name: "WTI spot (Cushing)" }, BZUSD: { id: "RBRTE", name: "Brent spot" }, NGUSD: { id: "RNGWHHD", name: "Henry Hub spot" },
};
export const eiaSpotCovers = (symbol: string) => Object.hasOwn(EIA_SPOT, canonical(symbol));

export async function eiaSpot(symbol: string, from: string): Promise<{ date: string; close: number }[]> {
  const s = EIA_SPOT[canonical(symbol)];
  if (!s) return [];
  return (await eiaSeries(s.id, from)).filter((o) => o.value > 0).map((o) => ({ date: o.date, close: o.value }));
}

/* ---------------- World Bank Pink Sheet ---------------- */

/**
 * The Pink Sheet's monthly workbook, as linked from worldbank.org/en/research/commodity-markets. The Bank
 * republishes it at a new address from time to time; the owner may point WORLD_BANK_PINK_SHEET_URL at the
 * new one, which must stay on the Bank's own host (never a URL anyone else supplies).
 */
const PINK_SHEET_URL = "https://thedocs.worldbank.org/en/doc/5d903e848db1d1b83e0ec8f744e55570-0350012021/related/CMO-Historical-Data-Monthly.xlsx";
const PINK_SHEET_HOST = "thedocs.worldbank.org";
const PINK_SHEET_TTL_MS = 24 * HOUR;
const PINK_SHEET_MAX_BYTES = 25 * 1024 * 1024;
const LB_PER_TONNE = 2_204.62;
const BU_PER_TONNE_CORN = 39.368;
const BU_PER_TONNE_WHEAT = 36.744;

/** Board symbol -> Pink Sheet code, its name, and the conversion from the sheet's unit to the symbol's. */
export const PINK_SHEET: Record<string, { code: string; name: string; convert: (v: number) => number }> = {
  GCUSD: { code: "GOLD", name: "Gold", convert: (v) => v },
  SIUSD: { code: "SILVER", name: "Silver", convert: (v) => v },
  HGUSD: { code: "COPPER", name: "Copper", convert: (v) => v / LB_PER_TONNE },
  CLUSD: { code: "CRUDE_WTI", name: "WTI crude", convert: (v) => v },
  BZUSD: { code: "CRUDE_BRENT", name: "Brent crude", convert: (v) => v },
  NGUSD: { code: "NGAS_US", name: "US natural gas", convert: (v) => v },
  ZCUSX: { code: "MAIZE", name: "Corn", convert: (v) => (v / BU_PER_TONNE_CORN) * 100 },
  ZWUSX: { code: "WHEAT_US_SRW", name: "Wheat (US SRW)", convert: (v) => (v / BU_PER_TONNE_WHEAT) * 100 },
};
export const pinkSheetCovers = (symbol: string) => Object.hasOwn(PINK_SHEET, canonical(symbol));

export function pinkSheetUrl(): string {
  const env = process.env.WORLD_BANK_PINK_SHEET_URL?.trim();
  try { if (env && new URL(env).protocol === "https:" && new URL(env).hostname === PINK_SHEET_HOST) return env; } catch { /* the default */ }
  return PINK_SHEET_URL;
}

const SheetShape = z.object({ codes: z.array(z.string()).refine((c) => c.includes("GOLD") || c.includes("CRUDE_WTI"), "a code row (GOLD, CRUDE_WTI…)"), months: z.number().int().min(12) });

/** "1960M01" -> "1960-01-01". Pure. */
const monthOf = (v: unknown): string | null => { const m = typeof v === "string" ? /^(\d{4})M(\d{2})$/.exec(v.trim()) : null; return m ? `${m[1]}-${m[2]}-01` : null; };

/** The workbook's "Monthly Prices" sheet as series by code, oldest first. Drift (no code row, no months) is SourceError "schema". */
export async function parsePinkSheet(buf: ArrayBuffer, want: string[] = Object.values(PINK_SHEET).map((p) => p.code)): Promise<Record<string, { date: string; value: number }[]>> {
  // Loaded on first use: the workbook reader is large and only this fallback needs it.
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.getWorksheet("Monthly Prices") ?? wb.worksheets[0];
  let codeRow = -1, codes: string[] = [];
  // exceljs rows are sparse (index 0 and blank cells are holes): Array.from fills them.
  ws?.eachRow((row, n) => { if (codeRow < 0) { const vals = Array.from(row.values as unknown[], (v) => (typeof v === "string" ? v.trim() : "")); if (vals.includes("GOLD") || vals.includes("CRUDE_WTI")) { codeRow = n; codes = vals; } } });
  const out: Record<string, { date: string; value: number }[]> = Object.fromEntries(want.map((c) => [c, []]));
  let months = 0;
  ws?.eachRow((row, n) => {
    if (n <= codeRow) return;
    const vals = row.values as unknown[], date = monthOf(vals[1]);
    if (!date) return;
    months++;
    for (const c of want) { const v = vals[codes.indexOf(c)]; if (typeof v === "number" && Number.isFinite(v)) out[c].push({ date, value: v }); }
  });
  parseOrThrow(SheetShape, { codes, months }, "World Bank", "Pink Sheet monthly");
  return out;
}

async function pinkSheet(): Promise<Record<string, { date: string; value: number }[]>> {
  const e = await cacheEntry("worldbank:pinksheet:v1", PINK_SHEET_TTL_MS, () => callSource("worldbank", "pink-sheet", async () => {
    const res = await fetchRetry(pinkSheetUrl(), { cache: "no-store", timeoutMs: budget().macroTimeoutMs * 2 });
    if (!res.ok) throw Object.assign(new Error(`World Bank ${res.status}`), { status: res.status });
    // The workbook is a few megabytes; anything far larger is not it (and is never unzipped).
    if (Number(res.headers.get("content-length") ?? 0) > PINK_SHEET_MAX_BYTES) throw Object.assign(new Error("World Bank workbook too large"), { status: 502 });
    const buf = await res.arrayBuffer();
    if (buf.byteLength > PINK_SHEET_MAX_BYTES) throw Object.assign(new Error("World Bank workbook too large"), { status: 502 });
    return parsePinkSheet(buf);
  }, { label: "The World Bank's Pink Sheet" }), { shared: true, staleMs: PINK_SHEET_TTL_MS, staleIfErrorMs: MACRO_STALE_IF_ERROR_MS });
  if (e.stale) noteFreshness({ stale: true, fetchedAt: new Date(e.fetchedAt).toISOString() });
  return e.value;
}

/** A commodity's monthly average prices from the Pink Sheet, in the symbol's units, oldest first, from `from`. */
export async function pinkSheetMonthly(symbol: string, from: string): Promise<{ date: string; close: number }[]> {
  const p = PINK_SHEET[canonical(symbol)];
  if (!p) return [];
  const rows = (await pinkSheet())[p.code] ?? [];
  return rows.filter((r) => r.date >= from.slice(0, 7) + "-01").map((r) => ({ date: r.date, close: Number(p.convert(r.value).toPrecision(8)) }));
}
