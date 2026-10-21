/**
 * Cross-sections from SEC XBRL frames: one concept for every filer in a period in a single request
 * (data.sec.gov/api/xbrl/frames). This is how the screener and peer percentiles see the whole market
 * without a data licence. Compacted to { cik: value } and cached for a day.
 */
import { z } from "zod";
import { cacheJson } from "@/lib/cache";
import { edgarJson, HOUR } from "@/lib/edgar/client";
import type { Chain } from "@/lib/edgar/concepts";
import { parseOrThrow } from "./validate";

const FrameSchema = z.looseObject({
  data: z.array(z.looseObject({ accn: z.string(), cik: z.number(), entityName: z.string(), loc: z.string().nullish(), start: z.string().optional(), end: z.string(), val: z.number().refine(Number.isFinite) })),
});

/** A frames answer, checked (drift is SourceError "schema"): { cik: value } and { cik: name }. */
export function parseFrame(raw: unknown): { values: Record<string, number>; names: Record<string, string> } {
  const values: Record<string, number> = {}, names: Record<string, string> = {};
  for (const r of parseOrThrow(FrameSchema, raw, "SEC EDGAR", "frames").data) { values[String(r.cik)] = r.val; names[String(r.cik)] = r.entityName; }
  return { values, names };
}
export type Frame = { period: string; tag: string; values: Record<string, number>; names: Record<string, string> };

/** `period` like CY2024 (annual), CY2024Q4 (quarter) or CY2024Q4I (instant, for balance-sheet tags). */
export async function frame(tag: string, period: string, unit = "USD", taxonomy = "us-gaap"): Promise<Frame> {
  return cacheJson<Frame>(`frame:${taxonomy}:${tag}:${unit}:${period}`, 24 * HOUR, async () => {
    const raw = await edgarJson<unknown>(`https://data.sec.gov/api/xbrl/frames/${taxonomy}/${tag}/${unit}/${period}.json`, `frame-${taxonomy}-${tag}-${unit}-${period}.json`, 24 * HOUR);
    return { period, tag, ...parseFrame(raw) };
  });
}

/** The first of several tags that has data, merged by company (earlier tags win), e.g. the revenue tags. */
export async function frameAny(tags: string[], period: string, unit = "USD"): Promise<Frame> {
  const frames: (Frame | null)[] = [];
  for (const t of tags) frames.push(await frame(t, period, unit).catch(() => null));
  return mergeFrames(tags, period, frames);
}

/**
 * Frames for each tag merged by company, earlier tags winning; with a chain's whole-line tags (Revenues),
 * a larger whole-line value replaces a component (the subset rule, edgar/concepts).
 */
export function mergeFrames(tags: string[], period: string, frames: (Frame | null)[], chain?: Pick<Chain, "wholeLine">): Frame {
  const out: Frame = { period, tag: tags.join("|"), values: {}, names: {} };
  for (const f of frames) {
    if (!f) continue;
    for (const [cik, v] of Object.entries(f.values)) if (!(cik in out.values)) { out.values[cik] = v; out.names[cik] = f.names[cik]; }
  }
  for (const f of frames) {
    if (!f || !chain?.wholeLine?.includes(f.tag)) continue;
    for (const [cik, v] of Object.entries(f.values)) if (v > out.values[cik]) out.values[cik] = v;
  }
  return out;
}

/** The chain's tags for a calendar period (tags retired before it are not asked for), merged as mergeFrames does. */
export async function frameChain(chain: Chain, period: string): Promise<Frame> {
  const year = Number(period.slice(2, 6));
  const tags = chain.tags.filter((t) => !t.until || t.until >= year).map((t) => t.tag);
  const frames: (Frame | null)[] = [];
  for (const t of tags) frames.push(await frame(t, period, chain.unit ?? "USD").catch(() => null));
  return mergeFrames(tags, period, frames, chain);
}

/** The most recent complete calendar year SEC frames are likely to cover (filers take months to report). */
export function lastFullYear(now = new Date()): number {
  return now.getUTCMonth() >= 4 ? now.getUTCFullYear() - 1 : now.getUTCFullYear() - 2;
}
