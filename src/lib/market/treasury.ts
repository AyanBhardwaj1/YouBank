/**
 * The Treasury's daily par yield curve, from the Treasury itself (public domain), for this year and
 * last year. Cached for two hours; the Treasury publishes once a day, after the close.
 */
import { z } from "zod";
import { cacheEntry } from "@/lib/cache";
import { fetchRetry } from "@/lib/net";
import { budget, MACRO_STALE_IF_ERROR_MS } from "./budgets";
import { mapLimit } from "./chain";
import { marketYear } from "./calendar";
import type { CurvePoint } from "./canonical";
import { noteFreshness } from "./provenance";
import { callSource } from "./source";
import { parseOrThrow } from "./validate";

export type CurveRow = { date: string; yields: Record<string, number> };
export const TENORS: [string, number][] = [["1 Mo", 1 / 12], ["2 Mo", 2 / 12], ["3 Mo", 0.25], ["4 Mo", 4 / 12], ["6 Mo", 0.5], ["1 Yr", 1], ["2 Yr", 2], ["3 Yr", 3], ["5 Yr", 5], ["7 Yr", 7], ["10 Yr", 10], ["20 Yr", 20], ["30 Yr", 30]];

/** The CSV's layout: a Date column first, then tenor columns ("1 Mo" … "30 Yr"); every row dated MM/DD/YYYY. */
const CsvShape = z.object({
  cols: z.array(z.string()).refine((c) => c[0] === "Date" && c.slice(1).some((x) => TENORS.some(([t]) => t === x)), "Date then tenor columns"),
  rows: z.array(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), yields: z.record(z.string(), z.number()) })),
});

/** The Treasury's daily par yield curve CSV (yields in percent, as published), checked: drift is SourceError "schema". */
export function parseTreasuryCsv(text: string): CurveRow[] {
  // A year with nothing published yet (the first days of January) can come back empty: no rows, not drift.
  if (!text.trim()) return [];
  const [head = "", ...lines] = text.trim().split("\n");
  const cols = head.split(",").map((c) => c.replace(/"/g, "").trim());
  const rows = lines.map((l) => {
    const v = l.split(",");
    const [m = "", d = "", yy = ""] = (v[0] ?? "").replace(/"/g, "").trim().split("/");
    const yields: Record<string, number> = {};
    cols.forEach((c, i) => { if (i > 0 && v[i] !== undefined && v[i] !== "") { const n = Number(v[i]); if (Number.isFinite(n)) yields[c] = n; } });
    return { date: `${yy}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`, yields };
  });
  return parseOrThrow(CsvShape, { cols, rows }, "US Treasury", "daily_treasury_yield_curve.csv").rows;
}

/** A curve row as canonical points (yields as fractions). */
export const curvePoints = (r: CurveRow): CurvePoint[] => TENORS.filter(([t]) => r.yields[t] !== undefined).map(([tenor, years]) => ({ date: r.date, tenor, years, yield: r.yields[tenor] / 100 }));

async function year(y: number): Promise<CurveRow[]> {
  const url = `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/${y}/all?type=daily_treasury_yield_curve&field_tdr_date_value=${y}&page&_format=csv`;
  return callSource("treasury", "yield-curve", async () => {
    const res = await fetchRetry(url, { cache: "no-store", timeoutMs: budget().macroTimeoutMs });
    if (!res.ok) throw Object.assign(new Error(`Treasury ${res.status}`), { status: res.status });
    // Drift is the Treasury failing (SourceError "schema"): counted for the breaker, and the last good copy keeps serving.
    return parseTreasuryCsv(await res.text());
  }, { label: "The US Treasury's rate feed" });
}

/** Daily curves, newest first, covering at least the last year. Past two hours the last copy answers while one refresh runs, and for three days when the Treasury fails (flagged stale). */
export async function treasuryCurves(): Promise<CurveRow[]> {
  const e = await cacheEntry<CurveRow[]>("treasury:curves", 2 * 3_600_000, async () => {
    const y = marketYear();
    const [a, b] = await Promise.all([year(y), year(y - 1).catch(() => [] as CurveRow[])]);
    return [...a, ...b].sort((p, q) => (p.date < q.date ? 1 : -1));
  }, { staleMs: 2 * 3_600_000, staleIfErrorMs: MACRO_STALE_IF_ERROR_MS });
  if (e.stale) noteFreshness({ stale: true, fetchedAt: new Date(e.fetchedAt).toISOString() });
  return e.value;
}

/** A past year's curve never changes; this year's does daily. */
const PAST_YEAR_TTL_MS = 7 * 24 * 3_600_000;
/** Year files fetched at once when the history is not cached yet. */
const HISTORY_CONCURRENCY = 3;
const THIS_YEAR_TTL_MS = 2 * 3_600_000;

/** One year's curves, cached per year (past years for a week, this year for two hours), stale when the Treasury fails. */
async function cachedYear(y: number, thisYear: number): Promise<CurveRow[]> {
  const ttl = y < thisYear ? PAST_YEAR_TTL_MS : THIS_YEAR_TTL_MS;
  const e = await cacheEntry<CurveRow[]>(`treasury:year:${y}`, ttl, () => year(y), { staleMs: ttl, staleIfErrorMs: MACRO_STALE_IF_ERROR_MS });
  if (e.stale) noteFreshness({ stale: true, fetchedAt: new Date(e.fetchedAt).toISOString() });
  return e.value;
}

/** Daily curves from `startYear` to now, newest first (the economy screen's ten-year rates come from here, not FRED). */
export async function treasuryHistory(startYear: number): Promise<CurveRow[]> {
  const thisYear = marketYear();
  const years = Array.from({ length: Math.max(1, thisYear - startYear + 1) }, (_, i) => thisYear - i);
  // A few years at a time: a cold cache asks the Treasury for a dozen files, and a burst could trip its limits.
  const got = await mapLimit(years, HISTORY_CONCURRENCY, (y) => cachedYear(y, thisYear).catch(() => [] as CurveRow[]));
  return got.flat().sort((p, q) => (p.date < q.date ? 1 : -1));
}
