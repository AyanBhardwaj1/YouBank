/**
 * The Book's risk on the server (src/lib/book/risk.ts has the arithmetic): daily closes for the held names and
 * SPY since 2020 (the market data layer, each answer cached), worked out once per book and trading day (the day
 * rolls over after the US close), so a page load, the report, an MCP call and the after-close job share it.
 */
import { createHash } from "node:crypto";
import { cacheGet, cacheSet } from "@/lib/cache";
import { dailyCloses } from "@/lib/copytrade/prices";
import type { Position } from "./position";
import { BENCHMARK, bookRisk, HISTORY_FROM, whatIf, type RiskInput, type SourcedRisk, type WhatIf } from "./risk";

// Daily closes change once a day, after the US close: the key rolls over at 21:00 UTC (after the close in winter
// and summer), and a complete answer is kept until then, so the after-close job's warm-up serves the next morning.
const TTL_MS = 24 * 3_600_000;
export const riskDay = (now: Date) => new Date(now.getTime() - 21 * 3_600_000).toISOString().slice(0, 10);
export type { SourcedRisk };

const inputOf = (book: Position[]) => book.map((p) => ({ ticker: p.ticker, direction: p.direction, weight: p.weight }));

/** Keyed by what the arithmetic reads (names, sides, weights) and the day, so an edited thesis does not refetch. */
export const riskKey = (book: Position[], now: Date) =>
  `book-risk:v2:${createHash("sha256").update(JSON.stringify([riskDay(now), [...inputOf(book)].sort((a, b) => a.ticker.localeCompare(b.ticker) || a.direction.localeCompare(b.direction))])).digest("base64url").slice(0, 32)}`;

/** Today's risk for this book if it was already worked out (by the page, the report or MCP); never fetches. */
export async function cachedRisk(book: Position[], now = new Date()): Promise<SourcedRisk | null> {
  const hit = await cacheGet(riskKey(book, now)).catch(() => null);
  try { return hit ? (JSON.parse(hit) as SourcedRisk) : null; } catch { return null; }
}

// One computation per book in flight on this instance: the warm-up and the panel opening at once share it.
const inflight = new Map<string, Promise<SourcedRisk>>();

export async function riskOf(book: Position[], now = new Date()): Promise<SourcedRisk> {
  const key = riskKey(book, now);
  const hit = await cachedRisk(book, now);
  if (hit) return hit;
  const running = inflight.get(key);
  if (running) return running;
  const p = computeRisk(book, key, now).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

async function computeRisk(book: Position[], key: string, now: Date): Promise<SourcedRisk> {
  const input = inputOf(book);
  const tickers = [...new Set(input.filter((p) => p.weight).map((p) => p.ticker))];
  const c = await dailyCloses([...tickers, BENCHMARK], HISTORY_FROM, { max: 40, deadline: Date.now() + 20_000 });
  const out: SourcedRisk = { ...bookRisk(input, c.prices, now), sources: [...new Set(c.providers)].map((p) => `${p} daily closes`), missingPrices: c.missing };
  // A partial answer (a feed down, the deadline hit, the benchmark missing) is kept ten minutes, not six hours,
  // so a passing outage does not stick to the page, the report and MCP for the rest of the day.
  const complete = out.betaNet !== null && !c.missing.length;
  await cacheSet(key, JSON.stringify(out), complete ? TTL_MS : 10 * 60_000).catch(() => undefined);
  return out;
}

/** Before a trade: the book's risk with one more position. Prices as above (each answer cached); not kept itself. */
export async function riskWhatIf(book: Position[], add: RiskInput & { weight: number }, now = new Date()): Promise<WhatIf & { sources: string[]; missingPrices: string[] }> {
  const input = inputOf(book);
  // The benchmark and the new name first, so no cap on the list can leave them out.
  const tickers = [...new Set([BENCHMARK, add.ticker, ...input.filter((p) => p.weight).map((p) => p.ticker)])];
  const c = await dailyCloses(tickers, HISTORY_FROM, { max: tickers.length, deadline: Date.now() + 20_000 });
  return { ...whatIf(input, add, c.prices, now), sources: [...new Set(c.providers)].map((p) => `${p} daily closes`), missingPrices: c.missing };
}
