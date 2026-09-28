/**
 * Cross-sections from SEC XBRL frames: one concept for every filer in a period in a single request
 * (data.sec.gov/api/xbrl/frames). This is how the screener and peer percentiles see the whole market
 * without a data licence. Compacted to { cik: value } and cached for a day.
 */
import { cacheJson } from "@/lib/cache";
import { edgarJson, HOUR } from "@/lib/edgar/client";

type FrameRow = { accn: string; cik: number; entityName: string; loc: string; start?: string; end: string; val: number };
export type Frame = { period: string; tag: string; values: Record<string, number>; names: Record<string, string> };

/** `period` like CY2024 (annual), CY2024Q4 (quarter) or CY2024Q4I (instant, for balance-sheet tags). */
export async function frame(tag: string, period: string, unit = "USD", taxonomy = "us-gaap"): Promise<Frame> {
  return cacheJson<Frame>(`frame:${taxonomy}:${tag}:${unit}:${period}`, 24 * HOUR, async () => {
    const raw = await edgarJson<{ data: FrameRow[] }>(`https://data.sec.gov/api/xbrl/frames/${taxonomy}/${tag}/${unit}/${period}.json`, `frame-${taxonomy}-${tag}-${unit}-${period}.json`, 24 * HOUR);
    const values: Record<string, number> = {}, names: Record<string, string> = {};
    for (const r of raw.data ?? []) { values[String(r.cik)] = r.val; names[String(r.cik)] = r.entityName; }
    return { period, tag, values, names };
  });
}

/** The first of several tags that has data, merged by company (earlier tags win), e.g. the revenue tags. */
export async function frameAny(tags: string[], period: string, unit = "USD"): Promise<Frame> {
  const out: Frame = { period, tag: tags.join("|"), values: {}, names: {} };
  for (const t of tags) {
    const f = await frame(t, period, unit).catch(() => null);
    if (!f) continue;
    for (const [cik, v] of Object.entries(f.values)) if (!(cik in out.values)) { out.values[cik] = v; out.names[cik] = f.names[cik]; }
  }
  return out;
}

/** The most recent complete calendar year SEC frames are likely to cover (filers take months to report). */
export function lastFullYear(now = new Date()): number {
  return now.getUTCMonth() >= 4 ? now.getUTCFullYear() - 1 : now.getUTCFullYear() - 2;
}
