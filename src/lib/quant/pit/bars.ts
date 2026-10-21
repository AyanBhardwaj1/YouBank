/**
 * QF3: daily bars for the point-in-time store. One object per symbol in R2 (quant/bars/<SYMBOL>.json.gz,
 * columns as arrays), refreshed by the nightly pass from the existing market-data chain (FMP, then Nasdaq in
 * the beta; `MARKET_BACKUP=off` turns Nasdaq off). Prices are split-adjusted closes (price return); where the
 * source lists dividends they are kept beside them for total return.
 *
 * Raw prices from this store are never shown to people (the beta has no display licence for them): they feed
 * analytics (factor returns, risk, base rates), which are derived data.
 *
 * `loadBars` reads the store, and falls back to a live read through market/data.ts when the store has no
 * object yet (R2 not configured, or the nightly pass has not reached the symbol), saying which it used.
 */
import { gunzipSync, gzipSync } from "node:zlib";
import { getBytes, putObject, r2Ready } from "@/lib/edge/infra/r2";
import { historyFrom } from "@/lib/market/data";
import { publicOnly } from "@/lib/market/user-context";
import { canonical } from "@/lib/market/symbols";
import type { Provider } from "@/lib/market/provenance";

export type Bars = { symbol: string; d: string[]; o: number[]; h: number[]; l: number[]; c: number[]; v: number[]; div?: Record<string, number>; source: string; updatedAt: string };
export type Loaded = { bars: Bars; from: "store" | "live"; provider: Provider | string };

export const barsKey = (symbol: string) => `quant/bars/${symbol.toUpperCase().replace(/[^A-Z0-9.\-]/g, "_")}.json.gz`;

export function encodeBars(b: Bars): Uint8Array {
  return gzipSync(Buffer.from(JSON.stringify(b)));
}

export function decodeBars(bytes: Uint8Array): Bars {
  return JSON.parse(gunzipSync(Buffer.from(bytes)).toString("utf8")) as Bars;
}

/** Append new bars to stored ones (new dates win; the result is sorted and de-duplicated). Pure. */
export function mergeBars(old: Bars | null, add: { date: string; open: number; high: number; low: number; close: number; volume: number }[], symbol: string, source: string): Bars {
  const by = new Map<string, [number, number, number, number, number]>();
  if (old) old.d.forEach((d, i) => by.set(d, [old.o[i], old.h[i], old.l[i], old.c[i], old.v[i]]));
  for (const x of add) if (x.close > 0) by.set(x.date, [x.open, x.high, x.low, x.close, x.volume]);
  const d = [...by.keys()].sort();
  const pick = (k: number) => d.map((x) => by.get(x)![k]);
  return { symbol: symbol.toUpperCase(), d, o: pick(0), h: pick(1), l: pick(2), c: pick(3), v: pick(4), div: old?.div, source, updatedAt: new Date().toISOString() };
}

/**
 * Put stored bars on the basis of newly fetched ones. Sources return split-adjusted history, so after a split
 * (or a switch of source) the overlapping dates come back on a new basis while older stored dates keep the old
 * one, and a merge would show a jump of the split's size between them. When the median ratio of new to stored
 * closes over the overlap is more than `tolerance` from 1, every stored bar before the first fetched date is
 * rescaled by it (prices times the ratio, volume divided by it). Pure.
 */
export function rebaseBars(old: Bars | null, add: { date: string; close: number }[], tolerance = 0.01): Bars | null {
  if (!old?.d.length || !add.length) return old;
  const at = new Map(old.d.map((d, i) => [d, old.c[i]]));
  const ratios = add.filter((x) => x.close > 0 && (at.get(x.date) ?? 0) > 0).map((x) => x.close / at.get(x.date)!).sort((a, b) => a - b);
  if (!ratios.length) return old;
  const k = ratios[Math.floor(ratios.length / 2)];
  if (!(k > 0) || Math.abs(k - 1) <= tolerance) return old;
  const first = add.reduce((m, x) => (x.date < m ? x.date : m), add[0].date);
  const before = (i: number) => old.d[i] < first;
  const scale = (xs: number[]) => xs.map((v, i) => (before(i) ? v * k : v));
  return { ...old, o: scale(old.o), h: scale(old.h), l: scale(old.l), c: scale(old.c), v: old.v.map((v, i) => (before(i) ? v / k : v)) };
}

/** Bars from `from` on (inclusive). Pure. */
export function sliceBars(b: Bars, from?: string, to?: string): Bars {
  const i0 = from ? b.d.findIndex((d) => d >= from) : 0;
  const i1 = to ? b.d.findIndex((d) => d > to) : -1;
  const a = i0 < 0 ? b.d.length : i0, z = i1 < 0 ? b.d.length : i1;
  return { ...b, d: b.d.slice(a, z), o: b.o.slice(a, z), h: b.h.slice(a, z), l: b.l.slice(a, z), c: b.c.slice(a, z), v: b.v.slice(a, z) };
}

/** Simple daily returns aligned with dates[1..]. Pure. */
export function barReturns(b: Pick<Bars, "d" | "c">): { dates: string[]; ret: number[] } {
  const dates: string[] = [], ret: number[] = [];
  for (let i = 1; i < b.c.length; i++) if (b.c[i - 1] > 0) { dates.push(b.d[i]); ret.push(b.c[i] / b.c[i - 1] - 1); }
  return { dates, ret };
}

export async function storedBars(symbol: string): Promise<Bars | null> {
  if (!r2Ready()) return null;
  const bytes = await getBytes(barsKey(symbol)).catch(() => null);
  if (!bytes) return null;
  try { return decodeBars(bytes); } catch { return null; }
}

export async function putBars(b: Bars): Promise<void> {
  await putObject(barsKey(b.symbol), encodeBars(b), "application/gzip");
}

/** Bars for analytics: the store first, then a live read (cached) through the market-data chain. */
export async function loadBars(symbol: string, from: string): Promise<Loaded | null> {
  const s = await storedBars(symbol);
  if (s && s.d.length && s.d[0] <= from) return { bars: sliceBars(s, from), from: "store", provider: s.source };
  // One request: each feed spells the symbol its own way at its boundary (market/symbols).
  try {
    const r = await publicOnly(() => historyFrom(canonical(symbol), from));
    if (r.data.length) return { bars: mergeBars(null, r.data, symbol, r.source), from: "live", provider: r.source };
  } catch { /* no source has it */ }
  return s ? { bars: sliceBars(s, from), from: "store", provider: s.source } : null;
}

/**
 * Refresh one symbol's stored bars: the last ~10 sessions when it exists (one short call), else `backfillFrom`.
 * Returns how many bars it now holds, or null when no source had it.
 */
export async function refreshBars(symbol: string, backfillFrom: string): Promise<number | null> {
  const old = await storedBars(symbol);
  const from = old?.d.length ? new Date(Date.parse(`${old.d[old.d.length - 1]}T00:00:00Z`) - 14 * 86_400_000).toISOString().slice(0, 10) : backfillFrom;
  try {
    const r = await publicOnly(() => historyFrom(canonical(symbol), from));
    if (r.data.length) {
      const merged = mergeBars(rebaseBars(old, r.data), r.data, symbol, r.source);
      await putBars(merged);
      return merged.d.length;
    }
  } catch { /* no source has it */ }
  return old ? old.d.length : null;
}
