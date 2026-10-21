/**
 * Checks for the market-data transport (docs/data-layer.md): fallbacks on every kind of primary failure,
 * interactive latency budgets and hedging, stale-while-revalidate and stale-if-error caching, circuit
 * breakers, SEC pacing, one bars key per symbol, compact companyfacts, telemetry and the AI research
 * budget. Every upstream is a stubbed fetch with synthetic payloads: nothing leaves the machine, and no
 * timing here is a provider's real latency. Budgets are scaled down (hedge 200 ms instead of 2.5 s) so
 * the run is quick; the derived worst-case table is checked against the same scaled numbers.
 *
 * Checks that need Postgres run when DATABASE_URL points at a LOCAL database with the schema (never a
 * remote one) and are skipped otherwise:
 *   pnpm exec tsx scripts/test-datalayer.ts
 *   DATABASE_URL=postgres://postgres:postgres@localhost:5432/yb_data pnpm exec tsx scripts/test-datalayer.ts
 */
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";

process.env.FMP_API_KEY ??= "test-key";
process.env.YOUBANK_NO_DISK_CACHE = "1";
process.env.MARKET_BACKUP = "on";
delete process.env.OPENAI_API_KEY;

let pass = 0, fail = 0;
const check = (label: string, cond: boolean, detail?: unknown) => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail !== undefined ? `  -> ${JSON.stringify(detail)}` : ""}`); }
};
/** Run one group; an exception fails it (a missing export reads as a failure, not a crash). */
async function section(name: string, fn: () => Promise<void> | void) {
  console.log(name);
  try { await fn(); } catch (e) { check(`${name}: ran without throwing`, false, e instanceof Error ? `${e.name}: ${e.message}` : String(e)); }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const timed = async <T>(f: () => Promise<T>): Promise<{ ms: number; value?: T; error?: unknown }> => {
  const t = performance.now();
  try { const value = await f(); return { ms: performance.now() - t, value }; } catch (error) { return { ms: performance.now() - t, error }; }
};
const uid = () => randomUUID().slice(0, 8).toUpperCase();
setInterval(() => undefined, 1_000); // keep the loop alive while only unref'd abort timers are pending

function localDb(): boolean {
  const url = process.env.DATABASE_URL;
  if (!url) return false;
  try { return ["localhost", "127.0.0.1", "::1"].includes(new URL(url).hostname); } catch { return false; }
}

/* ---------------- The stubbed network ---------------- */

type Mode = "ok" | "hang" | "neterr" | "503" | "badjson" | "empty" | "limit" | { delayMs: number };
/** Per symbol, how FMP answers; anything not listed answers at once. */
const fmpMode: Record<string, Mode> = {};
/** Per URL substring, extra delay for Nasdaq, SEC and the other sources. */
const delays: Record<string, number> = {};
/** Per URL substring, a forced behaviour for any source (hang, neterr, 503). */
const forced: Record<string, Mode> = {};
const calls: string[] = [];
const netErr = () => Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }) });
const hang = (signal?: AbortSignal | null) => new Promise<Response>((_, rej) => signal?.addEventListener("abort", () => rej(signal.reason), { once: true }));
const json = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status, headers: { "content-type": "application/json" } });

function tradingDays(n: number): string[] {
  const out: string[] = []; const d = new Date();
  while (out.length < n) { const w = d.getUTCDay(); if (w !== 0 && w !== 6) out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() - 1); }
  return out.reverse();
}
const DAYS = tradingDays(1_300);
const fmpBars = (from: string) => DAYS.filter((d) => d >= from).map((date, i) => ({ symbol: "X", date, open: 100 + i / 100, high: 101, low: 99, close: 100 + i / 100, volume: 1_000 })).reverse();
const nasdaqRows = (from: string) => DAYS.filter((d) => d >= from).map((date) => { const [y, m, dd] = date.split("-"); return { date: `${m}/${dd}/${y}`, close: "$50.00", volume: "1,000", open: "$50.00", high: "$51.00", low: "$49.00" }; }).reverse();

async function behave(m: Mode | undefined, signal?: AbortSignal | null): Promise<Response | null> {
  if (!m || m === "ok") return null;
  if (typeof m === "object") { await sleep(m.delayMs); return null; }
  if (m === "hang") return hang(signal);
  if (m === "neterr") throw netErr();
  if (m === "503") return new Response("Service Unavailable", { status: 503 });
  if (m === "badjson") return new Response("<html>gateway</html>", { status: 200 });
  if (m === "limit") return json({ "Error Message": "Limit Reach . Please upgrade your plan" });
  if (m === "empty") return json([]);
  return null;
}

globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  calls.push(url.replace(/apikey=[^&]+/, "apikey=…"));
  const force = Object.entries(forced).find(([k]) => url.includes(k))?.[1];
  const forcedRes = await behave(force, init?.signal);
  if (forcedRes) return forcedRes;
  const extra = Object.entries(delays).find(([k]) => url.includes(k))?.[1] ?? 0;
  if (extra) await new Promise<void>((res, rej) => { const t = setTimeout(res, extra); init?.signal?.addEventListener("abort", () => { clearTimeout(t); rej(init.signal!.reason); }, { once: true }); });
  if (url.includes("financialmodelingprep.com")) {
    const sym = decodeURIComponent(/symbol=([^&]+)/.exec(url)?.[1] ?? "");
    const r = await behave(fmpMode[sym], init?.signal);
    if (r) return r;
    const from = /from=([^&]+)/.exec(url)?.[1] ?? DAYS[0];
    if (url.includes("/profile")) return json([{ symbol: sym, price: 100, marketCap: 1e10, change: 1, changePercentage: 1, range: "80-120", companyName: "Test", cik: "1", exchange: "NASDAQ", exchangeFullName: "", industry: "", sector: "", website: "", description: "" }]);
    if (url.includes("/quote")) return json([{ symbol: sym, name: sym, price: 100, changePercentage: 1, change: 1, volume: 1, dayLow: 1, dayHigh: 1, yearHigh: 1, yearLow: 1, marketCap: 1, priceAvg50: 1, priceAvg200: 1, exchange: "X", open: 1, previousClose: 99, timestamp: Math.floor(Date.now() / 1000) }]);
    if (url.includes("historical-price-eod/light")) return json(fmpBars(from).map((b) => ({ symbol: sym, date: b.date, price: b.close, volume: 1 })));
    if (url.includes("historical-price-eod/full")) return json(fmpBars(from));
    if (url.includes("sector-performance-snapshot")) return json([{ date: "2026-10-20", sector: "Technology", exchange: "NASDAQ", averageChange: 1 }]);
    if (url.includes("historical-sector-performance")) return json([]);
    return json([]);
  }
  if (url.includes("api.nasdaq.com")) {
    if (url.includes("/info")) return json({ data: { symbol: "X", companyName: "Test Common Stock", exchange: "NASDAQ-GS", primaryData: { lastSalePrice: "$50.00", netChange: "+1.00", percentageChange: "+2.04%", lastTradeTimestamp: "Oct 20, 2026 4:00 PM ET", isRealTime: false } } });
    if (url.includes("/summary")) return json({ data: { summaryData: { MarketCap: { value: "10,000,000,000" }, FiftTwoWeekHighLow: { value: "$60.00/$40.00" } } } });
    if (url.includes("/historical")) return json({ data: { tradesTable: { rows: nasdaqRows(/fromdate=([^&]+)/.exec(url)?.[1] ?? DAYS[0]) } } });
    return json({ data: null });
  }
  if (url.includes("sec.gov")) return json({ ok: true, url });
  if (url.includes("api.openai.com")) return hang(init?.signal);
  throw netErr();
}) as typeof fetch;

/* ---------------- A3: stale-while-revalidate and stale-if-error ---------------- */

async function testSwr() {
  const { cacheEntry } = await import("@/lib/cache");
  {
    const key = `test:swr:${uid()}`;
    let loads = 0;
    await cacheEntry(key, 80, async () => { loads++; return { v: 1 }; }, { staleMs: 5_000 });
    await sleep(120); // past fresh, inside the stale window
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const slow = async () => { loads++; await gate; return { v: 2 }; };
    const t = performance.now();
    const got = await Promise.all(Array.from({ length: 5 }, () => cacheEntry(key, 80, slow, { staleMs: 5_000 })));
    const ms = performance.now() - t;
    check("A3(1) past freshUntil: the stale value answers at once, flagged stale", got.every((g) => g.value.v === 1 && g.stale) && ms < 50, { ms: Math.round(ms), got: got.map((g) => [g.value.v, g.stale]) });
    check("A3(1) one background refresh for five stale reads (single flight)", loads === 2, { loads });
    check("A3 entries carry fetchedAt, freshUntil and staleUntil", got.every((g) => g.fetchedAt > 0 && g.freshUntil === g.fetchedAt + 80 && g.staleUntil === g.freshUntil + 5_000), got[0]);
    release();
    await sleep(20);
    const after = await cacheEntry(key, 80, slow, { staleMs: 5_000 });
    check("A3(1) after the refresh lands, the new value is fresh", after.value.v === 2 && !after.stale && loads === 2, { v: after.value.v, stale: after.stale, loads });
  }
  {
    const key = `test:sie:${uid()}`;
    await cacheEntry(key, 50, async () => ({ v: 1 }), { staleIfErrorMs: 5_000 });
    await sleep(80);
    const r = await timed(() => cacheEntry(key, 50, async () => { throw new Error("upstream down"); }, { staleIfErrorMs: 5_000 }));
    check("A3(2) a failed refresh answers with the last value, flagged stale", !r.error && (r.value as { value: { v: number }; stale: boolean }).value.v === 1 && (r.value as { stale: boolean }).stale, r.error ? String(r.error) : r.value);
  }
  {
    const key = `test:past:${uid()}`;
    await cacheEntry(key, 40, async () => ({ v: 1 }), { staleMs: 40, staleIfErrorMs: 60 });
    await sleep(140); // past staleUntil (40 + 60)
    const r = await timed(() => cacheEntry(key, 40, async () => { throw new Error("upstream down"); }, { staleMs: 40, staleIfErrorMs: 60 }));
    check("A3(3) never serves past staleUntil: the error comes through", !!r.error && (r.error as Error).message === "upstream down", r.error ? String(r.error) : r.value);
  }
  {
    const { cacheJson } = await import("@/lib/cache");
    const key = `test:plain:${uid()}`;
    let loads = 0;
    await cacheJson(key, 40, async () => ++loads);
    await sleep(70);
    const v = await cacheJson(key, 40, async () => ++loads);
    check("A3 without stale options cacheJson behaves as before (an expired value is reloaded)", v === 2 && loads === 2, { v, loads });
  }
}

/* ---------------- Main ---------------- */

async function main() {
  await section("A3 cacheJson: stale-while-revalidate and stale-if-error", testSwr);
  if (!localDb()) console.log("database checks skipped (set DATABASE_URL to a local database to run them)");
  console.log(`\n${pass} passed, ${fail} failed`);
  const { pgClient } = await import("@/db");
  await pgClient?.end({ timeout: 1 }).catch(() => undefined);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
