/**
 * US labor and price statistics straight from the Bureau of Labor Statistics (public domain). The
 * keyless v1 API allows 25 requests a day, so every series is fetched in one request and cached for
 * twelve hours. These are the series YouBank forecasts: primary-source data carries no licence limits.
 */
import { cacheJson } from "@/lib/cache";

export const BLS_SERIES: Record<string, { label: string; unit: string; transform: "level" | "yoy" | "diff" }> = {
  CUUR0000SA0: { label: "CPI inflation", unit: "% y/y", transform: "yoy" },
  CUUR0000SA0L1E: { label: "Core CPI", unit: "% y/y", transform: "yoy" },
  LNS14000000: { label: "Unemployment rate", unit: "%", transform: "level" },
  CES0000000001: { label: "Nonfarm payrolls", unit: "k, m/m", transform: "diff" },
  CES0500000003: { label: "Average hourly earnings", unit: "% y/y", transform: "yoy" },
};

export type BlsObs = { date: string; value: number };

export async function blsSeries(): Promise<Record<string, BlsObs[]>> {
  return cacheJson<Record<string, BlsObs[]>>("bls:core", 12 * 3_600_000, async () => {
    const end = new Date().getUTCFullYear();
    const res = await fetch("https://api.bls.gov/publicAPI/v1/timeseries/data/", {
      method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store", signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({ seriesid: Object.keys(BLS_SERIES), startyear: String(end - 9), endyear: String(end) }),
    });
    const json = (await res.json()) as { status: string; Results?: { series: { seriesID: string; data: { year: string; period: string; value: string }[] }[] } };
    if (json.status !== "REQUEST_SUCCEEDED" || !json.Results) throw new Error("BLS data unavailable");
    const out: Record<string, BlsObs[]> = {};
    for (const s of json.Results.series) {
      out[s.seriesID] = s.data.filter((d) => /^M(0[1-9]|1[0-2])$/.test(d.period) && d.value !== "-")
        .map((d) => ({ date: `${d.year}-${d.period.slice(1)}-01`, value: Number(d.value) }))
        .filter((o) => Number.isFinite(o.value)).sort((a, b) => (a.date < b.date ? -1 : 1));
    }
    return out;
  });
}
