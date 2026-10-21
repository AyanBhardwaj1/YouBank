/**
 * Futures positioning from the CFTC's Commitments of Traders (public domain; registry.ts, dataset "cot"):
 * the legacy futures-only report on the CFTC's public reporting API (Socrata), for the contracts behind
 * the CMDTY board. Positions are as of Tuesday, released Friday at 3:30 pm ET; the board shows the
 * large speculators' ("non-commercial") net position, in contracts, and its change on the week.
 */
import { z } from "zod";
import { cacheEntry } from "@/lib/cache";
import { fetchRetry } from "@/lib/net";
import { budget, MACRO_STALE_IF_ERROR_MS } from "./budgets";
import { noteFreshness } from "./provenance";
import { callSource } from "./source";
import { parseOrThrow } from "./validate";

/** The legacy futures-only report's dataset on publicreporting.cftc.gov. */
const COT_URL = "https://publicreporting.cftc.gov/resource/6dca-aqww.json";
const COT_TTL_MS = 6 * 3_600_000;
/** Two reports per contract (this week and last), with room. */
const COT_ROWS = 60;

/** Board symbol -> CFTC contract market code (the exchange's main contract). */
export const COT_CONTRACTS: Record<string, string> = {
  GCUSD: "088691", SIUSD: "084691", HGUSD: "085692", CLUSD: "067651", BZUSD: "06765T", NGUSD: "023651", ZCUSX: "002602", ZWUSX: "001602", BTCUSD: "133741",
};

export type Positioning = { date: string; market: string; net: number; netChange: number | null; openInterest: number | null };

const n = z.union([z.number(), z.string().regex(/^-?\d+(\.\d+)?$/).transform(Number)]);
const CotRows = z.array(z.looseObject({
  market_and_exchange_names: z.string(), report_date_as_yyyy_mm_dd: z.string().regex(/^\d{4}-\d{2}-\d{2}/), cftc_contract_market_code: z.string(),
  noncomm_positions_long_all: n, noncomm_positions_short_all: n, open_interest_all: n.nullish(),
}));

/** COT rows as each board symbol's latest net position and its weekly change. Drift is SourceError "schema". Pure. */
export function parseCot(raw: unknown): Record<string, Positioning> {
  const rows = parseOrThrow(CotRows, raw, "CFTC", "legacy futures-only").sort((a, b) => (a.report_date_as_yyyy_mm_dd < b.report_date_as_yyyy_mm_dd ? 1 : -1));
  const out: Record<string, Positioning> = {};
  for (const [symbol, code] of Object.entries(COT_CONTRACTS)) {
    const mine = rows.filter((r) => r.cftc_contract_market_code.trim() === code);
    if (!mine.length) continue;
    const net = (r: (typeof mine)[number]) => r.noncomm_positions_long_all - r.noncomm_positions_short_all;
    out[symbol] = {
      date: mine[0].report_date_as_yyyy_mm_dd.slice(0, 10), market: mine[0].market_and_exchange_names, net: net(mine[0]),
      netChange: mine[1] ? net(mine[0]) - net(mine[1]) : null, openInterest: mine[0].open_interest_all ?? null,
    };
  }
  return out;
}

/** The latest positioning for every board contract (cached six hours; stale for three days when the CFTC fails). */
export async function cotPositioning(): Promise<Record<string, Positioning>> {
  const codes = Object.values(COT_CONTRACTS).map((c) => `'${c}'`).join(",");
  const qs = new URLSearchParams({ $where: `cftc_contract_market_code in(${codes})`, $order: "report_date_as_yyyy_mm_dd DESC", $limit: String(COT_ROWS * 2) });
  const e = await cacheEntry("cftc:cot:legacy:v1", COT_TTL_MS, () => callSource("cftc", "cot", async () => {
    const res = await fetchRetry(`${COT_URL}?${qs}`, { headers: { Accept: "application/json" }, cache: "no-store", timeoutMs: budget().macroTimeoutMs });
    if (!res.ok) throw Object.assign(new Error(`CFTC ${res.status}`), { status: res.status });
    return parseCot(await res.json());
  }, { label: "The CFTC" }), { shared: true, staleMs: COT_TTL_MS, staleIfErrorMs: MACRO_STALE_IF_ERROR_MS });
  if (e.stale) noteFreshness({ stale: true, fetchedAt: new Date(e.fetchedAt).toISOString() });
  return e.value;
}
