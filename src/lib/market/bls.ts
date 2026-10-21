/**
 * US labor and price statistics straight from the Bureau of Labor Statistics (public domain). The
 * keyless v1 API allows 25 requests a day, so every series is fetched in one request and cached for
 * twelve hours. These are the series YouBank forecasts: primary-source data carries no licence limits.
 */
import { z } from "zod";
import { cacheJson } from "@/lib/cache";
import { fetchRetry, retryServerErrors } from "@/lib/net";
import { marketYear } from "./calendar";
import { parseOrThrow } from "./validate";

export const BLS_SERIES: Record<string, { label: string; unit: string; transform: "level" | "yoy" | "diff" }> = {
  CUUR0000SA0: { label: "CPI inflation", unit: "% y/y", transform: "yoy" },
  CUUR0000SA0L1E: { label: "Core CPI", unit: "% y/y", transform: "yoy" },
  LNS14000000: { label: "Unemployment rate", unit: "%", transform: "level" },
  CES0000000001: { label: "Nonfarm payrolls", unit: "k, m/m", transform: "diff" },
  CES0500000003: { label: "Average hourly earnings", unit: "% y/y", transform: "yoy" },
};

export type BlsObs = { date: string; value: number };

const BlsAnswer = z.looseObject({
  status: z.string(),
  Results: z.looseObject({ series: z.array(z.looseObject({ seriesID: z.string(), data: z.array(z.looseObject({ year: z.string(), period: z.string(), value: z.string() })) })) }).nullish(),
});

/** A BLS timeseries answer as monthly observations per series, checked: drift is SourceError "schema". */
export function parseBls(raw: unknown): Record<string, BlsObs[]> {
  const json = parseOrThrow(BlsAnswer, raw, "BLS", "timeseries/data");
  if (json.status !== "REQUEST_SUCCEEDED" || !json.Results) throw new Error("BLS data unavailable");
  const out: Record<string, BlsObs[]> = {};
  for (const s of json.Results.series) {
    out[s.seriesID] = s.data.filter((d) => /^M(0[1-9]|1[0-2])$/.test(d.period) && d.value !== "-")
      .map((d) => ({ date: `${d.year}-${d.period.slice(1)}-01`, value: Number(d.value) }))
      .filter((o) => Number.isFinite(o.value)).sort((a, b) => (a.date < b.date ? -1 : 1));
  }
  return out;
}

export async function blsSeries(): Promise<Record<string, BlsObs[]>> {
  return cacheJson<Record<string, BlsObs[]>>("bls:core", 12 * 3_600_000, async () => {
    const end = marketYear();
    // A read-only query, so it may be repeated, but only on a server failure: BLS's keyless quota is 25 a day.
    const res = await fetchRetry("https://api.bls.gov/publicAPI/v1/timeseries/data/", {
      method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store", timeoutMs: 15_000, idempotent: true, retryOn: retryServerErrors,
      body: JSON.stringify({ seriesid: Object.keys(BLS_SERIES), startyear: String(end - 9), endyear: String(end) }),
    });
    return parseBls(await res.json());
  });
}
