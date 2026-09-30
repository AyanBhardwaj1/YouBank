/**
 * Macro series from FRED (Federal Reserve Bank of St. Louis), shown with attribution. The public graph
 * CSV needs no key; each series is cached for twelve hours.
 *
 * FRED's terms bar using its content in connection with machine learning or generative AI, and some
 * series belong to third parties (ICE BofA indices, the S&P 500, Cboe's VIX, the Michigan survey). So
 * FRED data is displayed only: it never reaches the assistant or a forecasting model, and the list
 * below keeps to public-domain originals (BLS, BEA, the Fed, the Department of Labor, the EIA) plus
 * Moody's yield spread, which FRED allows with a citation. Forecasts use BLS data directly.
 */
import { cacheJson } from "@/lib/cache";

export type Obs = { date: string; value: number };

export async function fredSeries(id: string, start?: string): Promise<Obs[]> {
  const rows = await cacheJson<Obs[]>(`fred:${id}`, 12 * 3_600_000, async () => {
    const res = await fetch(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(id)}`, { cache: "no-store", headers: { "User-Agent": "YouBank research terminal" }, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`FRED ${res.status} for ${id}`);
    const text = await res.text();
    return text.split("\n").slice(1).map((l) => l.split(",")).filter((p) => p.length >= 2 && p[1] !== "." && p[1] !== "").map((p) => ({ date: p[0], value: Number(p[1]) })).filter((o) => Number.isFinite(o.value));
  });
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
