/**
 * Macro series from FRED (Federal Reserve Bank of St. Louis), shown with attribution. The public graph
 * CSV needs no key. FRED is a fallback only (registry.ts: the original publishers answer first), and its
 * terms bar "storing, caching, or archiving" its content, so nothing from FRED is cached: a series is
 * fetched at most once per request (requestMemo) and forgotten when the request ends.
 *
 * FRED's terms bar using its content in connection with machine learning or generative AI, and some
 * series belong to third parties (ICE BofA indices, the S&P 500, Cboe's VIX, the Michigan survey). So
 * FRED data is displayed only: it never reaches the assistant or a forecasting model, and the list
 * below keeps to public-domain originals (BLS, BEA, the Fed, the Department of Labor, the EIA) plus
 * Moody's yield spread, which FRED allows with a citation. Forecasts use BLS data directly.
 */
import { z } from "zod";
import { fetchRetry } from "@/lib/net";
import { budget } from "./budgets";
import { requestMemo } from "./provenance";
import { callSource } from "./source";
import { parseOrThrow } from "./validate";

export type Obs = { date: string; value: number };

/** FRED's graph CSV: a header of a date column and the series id, then "YYYY-MM-DD,value" rows ("." for none). */
const FredCsv = z.object({
  header: z.tuple([z.string().regex(/date/i), z.string()]),
  rows: z.array(z.tuple([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.string().regex(/^(-?\d+(\.\d+)?([eE][-+]?\d+)?|\.)?$/)])),
});

/** One series' observations, oldest first, checked: drift (an HTML page, a new layout) is SourceError "schema". */
export function parseFredCsv(text: string, id: string): Obs[] {
  const [head = "", ...lines] = text.trim().split("\n");
  const cells = lines.filter((l) => l.trim()).map((l) => l.trim().split(","));
  const parsed = parseOrThrow(FredCsv, { header: head.trim().split(","), rows: cells }, "FRED", `fredgraph.csv ${id}`);
  return parsed.rows.filter(([, v]) => v !== "." && v !== "").map(([date, v]) => ({ date, value: Number(v) })).filter((o) => Number.isFinite(o.value));
}

export async function fredSeries(id: string, start?: string): Promise<Obs[]> {
  const rows = await requestMemo(`fred:${id}`, () => callSource("fred", "series", async () => {
    const res = await fetchRetry(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(id)}`, { cache: "no-store", headers: { "User-Agent": "YouBank research terminal" }, timeoutMs: budget().macroTimeoutMs });
    if (!res.ok) throw Object.assign(new Error(`FRED ${res.status} for ${id}`), { status: res.status });
    // Drift is FRED failing (SourceError "schema"): counted for the breaker, and the next source answers.
    return parseFredCsv(await res.text(), id);
  }, { label: "FRED" }));
  return start ? rows.filter((r) => r.date >= start) : rows;
}

/** The dashboard's series: what each is, its unit, and how to show the change. */
export const MACRO_SERIES: { id: string; label: string; group: string; unit: string; transform: "level" | "yoy" | "diff"; freq: "daily" | "weekly" | "monthly" | "quarterly"; source: string }[] = [
  { id: "CPIAUCSL", label: "CPI inflation", group: "Prices", unit: "% y/y", transform: "yoy", freq: "monthly", source: "BLS" },
  { id: "CPILFESL", label: "Core CPI", group: "Prices", unit: "% y/y", transform: "yoy", freq: "monthly", source: "BLS" },
  { id: "PCEPILFE", label: "Core PCE", group: "Prices", unit: "% y/y", transform: "yoy", freq: "monthly", source: "BEA" },
  { id: "UNRATE", label: "Unemployment rate", group: "Labor", unit: "%", transform: "level", freq: "monthly", source: "BLS" },
  { id: "PAYEMS", label: "Nonfarm payrolls", group: "Labor", unit: "k, m/m", transform: "diff", freq: "monthly", source: "BLS" },
  { id: "ICSA", label: "Initial jobless claims", group: "Labor", unit: "k", transform: "level", freq: "weekly", source: "U.S. Department of Labor" },
  { id: "GDPC1", label: "Real GDP", group: "Growth", unit: "% y/y", transform: "yoy", freq: "quarterly", source: "BEA" },
  { id: "INDPRO", label: "Industrial production", group: "Growth", unit: "% y/y", transform: "yoy", freq: "monthly", source: "Federal Reserve" },
  { id: "RSAFS", label: "Retail sales", group: "Growth", unit: "% y/y", transform: "yoy", freq: "monthly", source: "U.S. Census Bureau" },
  { id: "HOUST", label: "Housing starts", group: "Growth", unit: "k, SAAR", transform: "level", freq: "monthly", source: "U.S. Census Bureau" },
  { id: "FEDFUNDS", label: "Fed funds rate", group: "Rates", unit: "%", transform: "level", freq: "monthly", source: "Federal Reserve" },
  { id: "DGS10", label: "10-year Treasury", group: "Rates", unit: "%", transform: "level", freq: "daily", source: "Federal Reserve" },
  { id: "T10Y2Y", label: "10y minus 2y", group: "Rates", unit: "pts", transform: "level", freq: "daily", source: "Federal Reserve" },
  { id: "T10Y3M", label: "10y minus 3m", group: "Rates", unit: "pts", transform: "level", freq: "daily", source: "Federal Reserve" },
  { id: "BAA10Y", label: "Baa minus 10y", group: "Credit", unit: "pts", transform: "level", freq: "daily", source: "Moody's" },
  { id: "DTWEXBGS", label: "Broad dollar index", group: "Markets", unit: "index", transform: "level", freq: "daily", source: "Federal Reserve" },
  { id: "DCOILWTICO", label: "WTI crude", group: "Markets", unit: "$/bbl", transform: "level", freq: "daily", source: "EIA" },
];
