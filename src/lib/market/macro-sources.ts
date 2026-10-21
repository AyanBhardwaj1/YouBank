/**
 * The economy screen's series from their original publishers, ahead of FRED's copies (registry.ts,
 * dataset "macro"): BLS for prices and jobs, BEA for GDP and PCE prices, the EIA for crude oil, and the
 * Treasury's own par curve for the 10-year yield and its spreads. Each maps to the FRED series it stands
 * for, in FRED's units, so the screen reads the same whichever answered. All public domain, so cached.
 *
 * BEA and EIA need the owner's free keys (BEA_API_KEY, EIA_API_KEY); without them those adapters are
 * skipped and FRED answers. The keys are the owner's, sent only to their fixed hosts, never logged.
 */
import { z } from "zod";
import { cacheEntry } from "@/lib/cache";
import { fetchRetry } from "@/lib/net";
import { BLS_DISPLAY, blsSeries } from "./bls";
import { budget, MACRO_STALE_IF_ERROR_MS } from "./budgets";
import { marketYear } from "./calendar";
import type { Obs } from "./fred";
import { noteFreshness } from "./provenance";
import { callSource } from "./source";
import { treasuryHistory } from "./treasury";
import { parseOrThrow } from "./validate";

const HOUR = 3_600_000;
const MACRO_TTL_MS = 12 * HOUR;
/** Years of history the screen reads (its ten-year percentile). */
const HISTORY_YEARS = 12;

/* ---------------- BLS ---------------- */

export const blsCovers = (series: string) => Object.hasOwn(BLS_DISPLAY, series);
export async function blsDisplay(series: string): Promise<Obs[]> {
  return (await blsSeries())[BLS_DISPLAY[series]] ?? [];
}

/* ---------------- BEA ---------------- */

const BEA_URL = "https://apps.bea.gov/api/data/";
/** FRED id -> BEA NIPA table, frequency, the line it reads (by description, never position) and a scale to FRED's units. */
export const BEA_SERIES: Record<string, { table: string; freq: "Q" | "M"; line: RegExp; toUnits: (v: number, mult: number) => number }> = {
  GDPC1: { table: "T10106", freq: "Q", line: /^Gross domestic product$/i, toUnits: (v, mult) => (v * 10 ** mult) / 1e9 },
  PCEPILFE: { table: "T20804", freq: "M", line: /excluding food and energy/i, toUnits: (v) => v },
};
export const beaCovers = (series: string) => Object.hasOwn(BEA_SERIES, series);

const BeaAnswer = z.looseObject({
  BEAAPI: z.looseObject({
    Results: z.looseObject({
      Data: z.array(z.looseObject({ LineDescription: z.string(), TimePeriod: z.string(), DataValue: z.string(), UNIT_MULT: z.union([z.string(), z.number()]).nullish() })),
    }),
  }),
});

/** "2024Q2" / "2024M05" -> the period's first day, as FRED dates it. Pure. */
export function beaPeriod(p: string): string | null {
  const q = /^(\d{4})Q([1-4])$/.exec(p);
  if (q) return `${q[1]}-${String((Number(q[2]) - 1) * 3 + 1).padStart(2, "0")}-01`;
  const m = /^(\d{4})M(\d{2})$/.exec(p);
  return m ? `${m[1]}-${m[2]}-01` : null;
}

/** A BEA GetData answer as one series' observations (FRED's units), oldest first. Drift is SourceError "schema". Pure. */
export function parseBea(raw: unknown, series: string): Obs[] {
  const spec = BEA_SERIES[series];
  const rows = parseOrThrow(BeaAnswer, raw, "BEA", `NIPA ${spec.table}`).BEAAPI.Results.Data;
  return rows.filter((r) => spec.line.test(r.LineDescription.trim())).flatMap((r) => {
    const date = beaPeriod(r.TimePeriod), v = Number(r.DataValue.replace(/,/g, ""));
    return date && Number.isFinite(v) ? [{ date, value: spec.toUnits(v, Number(r.UNIT_MULT ?? 0) || 0) }] : [];
  }).sort((a, b) => (a.date < b.date ? -1 : 1));
}

export async function beaSeries(series: string): Promise<Obs[]> {
  const spec = BEA_SERIES[series], key = process.env.BEA_API_KEY?.trim();
  if (!spec || !key) return [];
  const end = marketYear();
  const years = Array.from({ length: HISTORY_YEARS }, (_, i) => end - i).join(",");
  const e = await cacheEntry<Obs[]>(`bea:${series}:${end}`, MACRO_TTL_MS, () => callSource("bea", spec.table, async () => {
    const qs = new URLSearchParams({ UserID: key, method: "GetData", DataSetName: "NIPA", TableName: spec.table, Frequency: spec.freq, Year: years, ResultFormat: "JSON" });
    const res = await fetchRetry(`${BEA_URL}?${qs}`, { cache: "no-store", timeoutMs: budget().macroTimeoutMs });
    if (!res.ok) throw Object.assign(new Error(`BEA ${res.status}`), { status: res.status });
    return parseBea(await res.json(), series);
  }, { label: "BEA" }), { staleMs: MACRO_TTL_MS, staleIfErrorMs: MACRO_STALE_IF_ERROR_MS });
  if (e.stale) noteFreshness({ stale: true, fetchedAt: new Date(e.fetchedAt).toISOString() });
  return e.value;
}

/* ---------------- EIA ---------------- */

const EIA_URL = "https://api.eia.gov/v2";
/** EIA series by id: its API route. WTI and Brent spot (petroleum), Henry Hub spot (natural gas). */
export const EIA_ROUTES: Record<string, string> = { RWTC: "petroleum/pri/spt", RBRTE: "petroleum/pri/spt", RNGWHHD: "natural-gas/pri/fut" };
/** The economy screen's FRED series the EIA publishes itself. */
export const EIA_FOR_FRED: Record<string, string> = { DCOILWTICO: "RWTC" };
export const eiaCovers = (series: string) => Object.hasOwn(EIA_FOR_FRED, series);

const num = z.union([z.number(), z.string().regex(/^-?\d+(\.\d+)?$/).transform(Number)]);
const EiaAnswer = z.looseObject({ response: z.looseObject({ data: z.array(z.looseObject({ period: z.string(), series: z.string().nullish(), value: num.nullable() })) }) });

/** An EIA v2 data answer as daily observations, oldest first (no-value days dropped). Drift is SourceError "schema". Pure. */
export function parseEia(raw: unknown, id: string): Obs[] {
  return parseOrThrow(EiaAnswer, raw, "EIA", `v2 ${id}`).response.data
    .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.period) && (!r.series || r.series === id) && typeof r.value === "number" && Number.isFinite(r.value))
    .map((r) => ({ date: r.period, value: r.value as number })).sort((a, b) => (a.date < b.date ? -1 : 1));
}

/** An EIA daily series from `start`, oldest first; empty without the owner's key. */
export async function eiaSeries(id: string, start: string): Promise<Obs[]> {
  const route = EIA_ROUTES[id], key = process.env.EIA_API_KEY?.trim();
  if (!route || !key) return [];
  const e = await cacheEntry<Obs[]>(`eia:${id}:${start.slice(0, 4)}`, MACRO_TTL_MS, () => callSource("eia", id, async () => {
    const qs = new URLSearchParams({ api_key: key, frequency: "daily", "data[0]": "value", "facets[series][]": id, start: `${start.slice(0, 4)}-01-01`, "sort[0][column]": "period", "sort[0][direction]": "asc", offset: "0", length: "5000" });
    const res = await fetchRetry(`${EIA_URL}/${route}/data/?${qs}`, { cache: "no-store", timeoutMs: budget().macroTimeoutMs });
    if (!res.ok) throw Object.assign(new Error(`EIA ${res.status}`), { status: res.status });
    return parseEia(await res.json(), id);
  }, { label: "EIA" }), { staleMs: MACRO_TTL_MS, staleIfErrorMs: MACRO_STALE_IF_ERROR_MS });
  if (e.stale) noteFreshness({ stale: true, fetchedAt: new Date(e.fetchedAt).toISOString() });
  return e.value.filter((o) => o.date >= start);
}

/* ---------------- Treasury ---------------- */

/** FRED's Treasury series computed from the Treasury's own par curve (percent; spreads in points). */
export const TREASURY_FOR_FRED: Record<string, (y: Record<string, number>) => number | null> = {
  DGS10: (y) => y["10 Yr"] ?? null,
  T10Y2Y: (y) => (y["10 Yr"] !== undefined && y["2 Yr"] !== undefined ? y["10 Yr"] - y["2 Yr"] : null),
  T10Y3M: (y) => (y["10 Yr"] !== undefined && y["3 Mo"] !== undefined ? y["10 Yr"] - y["3 Mo"] : null),
};
export const treasuryCovers = (series: string) => Object.hasOwn(TREASURY_FOR_FRED, series);

export async function treasurySeries(series: string): Promise<Obs[]> {
  const f = TREASURY_FOR_FRED[series];
  const rows = await treasuryHistory(marketYear() - HISTORY_YEARS + 1);
  return rows.flatMap((r) => { const v = f(r.yields); return v === null ? [] : [{ date: r.date, value: Number(v.toFixed(4)) }]; }).sort((a, b) => (a.date < b.date ? -1 : 1));
}
