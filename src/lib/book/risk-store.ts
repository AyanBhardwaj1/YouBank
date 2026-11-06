/**
 * The Book's risk on the server (src/lib/book/risk.ts has the arithmetic): daily closes for the held names and
 * SPY since 2020 (the market data layer, each answer cached), worked out and kept for six hours per book, so
 * a page load, the report and an MCP call share one computation.
 */
import { createHash } from "node:crypto";
import { cacheGet, cacheSet } from "@/lib/cache";
import { dailyCloses } from "@/lib/copytrade/prices";
import type { Position } from "./position";
import { BENCHMARK, bookRisk, HISTORY_FROM, type SourcedRisk } from "./risk";

const TTL_MS = 6 * 3_600_000;
export type { SourcedRisk };

const inputOf = (book: Position[]) => book.map((p) => ({ ticker: p.ticker, direction: p.direction, weight: p.weight }));

/** Keyed by what the arithmetic reads (names, sides, weights) and the day, so an edited thesis does not refetch. */
export const riskKey = (book: Position[], now: Date) =>
  `book-risk:v1:${createHash("sha256").update(JSON.stringify([now.toISOString().slice(0, 10), [...inputOf(book)].sort((a, b) => a.ticker.localeCompare(b.ticker) || a.direction.localeCompare(b.direction))])).digest("base64url").slice(0, 32)}`;

export async function riskOf(book: Position[], now = new Date()): Promise<SourcedRisk> {
  const input = inputOf(book);
  const key = riskKey(book, now);
  const hit = await cacheGet(key).catch(() => null);
  if (hit) { try { return JSON.parse(hit) as SourcedRisk; } catch { /* recompute */ } }
  const tickers = [...new Set(input.filter((p) => p.weight).map((p) => p.ticker))];
  const c = await dailyCloses([...tickers, BENCHMARK], HISTORY_FROM, { max: 40, deadline: Date.now() + 20_000 });
  const out: SourcedRisk = { ...bookRisk(input, c.prices, now), sources: [...new Set(c.providers)].map((p) => `${p} daily closes`), missingPrices: c.missing };
  await cacheSet(key, JSON.stringify(out), TTL_MS).catch(() => undefined);
  return out;
}
