/**
 * The Treasury's daily par yield curve, from the Treasury itself (public domain), for this year and
 * last year. Cached for two hours; the Treasury publishes once a day, after the close.
 */
import { cacheJson } from "@/lib/cache";

export type CurveRow = { date: string; yields: Record<string, number> };
export const TENORS: [string, number][] = [["1 Mo", 1 / 12], ["2 Mo", 2 / 12], ["3 Mo", 0.25], ["4 Mo", 4 / 12], ["6 Mo", 0.5], ["1 Yr", 1], ["2 Yr", 2], ["3 Yr", 3], ["5 Yr", 5], ["7 Yr", 7], ["10 Yr", 10], ["20 Yr", 20], ["30 Yr", 30]];

async function year(y: number): Promise<CurveRow[]> {
  const url = `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/${y}/all?type=daily_treasury_yield_curve&field_tdr_date_value=${y}&page&_format=csv`;
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Treasury ${res.status}`);
  const [head, ...lines] = (await res.text()).trim().split("\n");
  const cols = head.split(",").map((c) => c.replace(/"/g, "").trim());
  return lines.map((l) => {
    const v = l.split(",");
    const [m, d, yy] = v[0].split("/");
    const yields: Record<string, number> = {};
    cols.forEach((c, i) => { if (i > 0 && v[i] !== undefined && v[i] !== "") { const n = Number(v[i]); if (Number.isFinite(n)) yields[c] = n; } });
    return { date: `${yy}-${m}-${d}`, yields };
  });
}

/** Daily curves, newest first, covering at least the last year. */
export async function treasuryCurves(): Promise<CurveRow[]> {
  return cacheJson<CurveRow[]>("treasury:curves", 2 * 3_600_000, async () => {
    const y = new Date().getUTCFullYear();
    const [a, b] = await Promise.all([year(y), year(y - 1).catch(() => [] as CurveRow[])]);
    return [...a, ...b].sort((p, q) => (p.date < q.date ? 1 : -1));
  });
}
