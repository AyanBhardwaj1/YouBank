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
 *   ONLY=A7 pnpm exec tsx scripts/test-datalayer.ts      (only the groups whose name matches)
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
  if (process.env.ONLY && !new RegExp(process.env.ONLY).test(name)) return; // ONLY=A7 runs the A7 groups
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
  if (url.includes("/api/xbrl/companyfacts/")) return json(companyFacts());
  if (url.includes("sec.gov")) return json({ ok: true, url });
  if (url.includes("api.openai.com")) return hang(init?.signal);
  throw netErr();
}) as typeof fetch;

/** A companyfacts-shaped document (synthetic): the concepts the app reads plus many it never reads. */
function companyFacts() {
  const rows = (v: number) => [{ start: "2025-02-01", end: "2026-01-31", val: v, accn: "0000000000-26-000001", fy: 2026, fp: "FY", form: "10-K", filed: "2026-03-20" }];
  const gaap: Record<string, { units: Record<string, unknown[]> }> = {};
  for (const c of ["Revenues", "NetIncomeLoss", "OperatingIncomeLoss", "LongTermDebt", "CommonStockDividendsPerShareDeclared"]) gaap[c] = { units: { USD: rows(1e9) } };
  for (let i = 0; i < 300; i++) gaap[`SyntheticUnreadConcept${i}`] = { units: { USD: rows(i) } };
  return { cik: 1, entityName: "SYNTHETIC CO", facts: { "us-gaap": gaap, dei: { EntityCommonStockSharesOutstanding: { units: { shares: rows(3e8) } } }, abc: { TotalRevenueAndOtherIncome: { units: { USD: rows(2e9) } }, SomethingElse: { units: { USD: rows(1) } } } } };
}

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


/* ---------------- A4: circuit breakers ---------------- */

async function testBreaker() {
  const { createBreakers, memoryBreakerStore, nextOnFailure, CLOSED } = await import("@/lib/market/breaker");
  const cfg = { failures: 3, windowMs: 1_000, cooldownMs: 500, probeLeaseMs: 2_000, memoryMs: 0 };
  let now = 1_000_000;
  const store = memoryBreakerStore(() => now);
  const b = createBreakers({ store, now: () => now, cfg });
  const { SourceError } = await import("@/lib/market/source-error");
  const outage = new SourceError("fmp", "timeout", "x");
  for (let i = 0; i < 2; i++) await b.failure("fmp", outage);
  check("A4 closed below the threshold", (await b.view("fmp")) === "closed" && (await b.gate("fmp")).allowed);
  await b.failure("fmp", new SourceError("fmp", "empty", "no rows"));
  check("A4 an empty answer (not covered) does not count toward opening", (await b.view("fmp")) === "closed");
  await b.failure("fmp", outage);
  check("A4 opens after N failures within the window", (await b.view("fmp")) === "open");
  const g = await b.gate("fmp");
  check("A4 open: the gate refuses at once", !g.allowed);
  now += 600; // past the cooldown
  check("A4 half-open after the cooldown", (await b.view("fmp")) === "half-open");
  const [p1, p2] = await Promise.all([b.gate("fmp"), b.gate("fmp")]);
  check("A4 half-open lets exactly one probe through", [p1, p2].filter((x) => x.allowed).length === 1);
  await b.failure("fmp", outage);
  await Promise.all([p1.release?.(), p2.release?.()]);
  check("A4 a failed probe opens it again", (await b.view("fmp")) === "open");
  now += 600;
  const probe = await b.gate("fmp");
  await b.success("fmp");
  await probe.release?.();
  check("A4 a successful probe closes it", probe.allowed && (await b.view("fmp")) === "closed");
  let s = CLOSED;
  s = nextOnFailure(s, 0, cfg); s = nextOnFailure(s, 400, cfg); s = nextOnFailure(s, 1_500, cfg);
  check("A4 failures spread past the window do not open it", s.state === "closed" && s.failures === 1, s);
  const broken = createBreakers({ store: { read: async () => { throw new Error("db down"); }, cas: async () => { throw new Error("db down"); }, probe: async () => { throw new Error("db down"); } }, now: () => now, cfg });
  check("A4 a failed breaker read fails open (the source is tried)", (await broken.gate("fmp")).allowed);
}

async function testBreakerDb() {
  const { createBreakers, dbBreakerStore } = await import("@/lib/market/breaker");
  const { SourceError } = await import("@/lib/market/source-error");
  const cfg = { failures: 3, windowMs: 60_000, cooldownMs: 300, probeLeaseMs: 5_000, memoryMs: 0 };
  const src = `test-${uid()}`;
  const a = createBreakers({ store: dbBreakerStore(), cfg }), b = createBreakers({ store: dbBreakerStore(), cfg });
  const e = new SourceError(src, "network", "x");
  await Promise.all([a.failure(src, e), b.failure(src, e), a.failure(src, e)]);
  check("A4(db) failures from two instances add up atomically and open it for both", (await a.view(src)) === "open" && (await b.view(src)) === "open" && !(await b.gate(src)).allowed);
  await sleep(350);
  const gates = await Promise.all([a.gate(src), b.gate(src), a.gate(src), b.gate(src)]);
  check("A4(db) half-open: one probe across instances (the lease)", gates.filter((g) => g.allowed).length === 1, gates.map((g) => g.allowed));
  await a.success(src);
  await Promise.all(gates.map((g) => g.release?.()));
  check("A4(db) the probe's success closes it for the other instance too", (await b.view(src)) === "closed");
  const { db, schema } = await import("@/db");
  const { like } = await import("drizzle-orm");
  await db!.delete(schema.kvCache).where(like(schema.kvCache.key, `%${src}%`));
}


/* ---------------- A8: telemetry ---------------- */

async function testStats() {
  const st = await import("@/lib/market/stats");
  check("A8 bucket bounds: 80 ms in the first, 300 ms in the third, 20 s in the last", st.bucketOf(80) === 0 && st.bucketOf(300) === 2 && st.bucketOf(20_000) === st.BUCKETS.length);
  const r = st.emptyRollup();
  for (const ms of [50, 60, 70, 80, 90, 120, 200, 400, 900, 3_000]) st.addCall(r, { ms, outcome: "ok" });
  st.addCall(r, { ms: 6_000, outcome: "fail", kind: "timeout" });
  st.addCall(r, { ms: 0, outcome: "skip", kind: "breaker-open" });
  check("A8 rollup counts calls, failures (skips included) and kinds", r.calls === 12 && r.failures === 2 && r.kinds.timeout === 1 && r.kinds["breaker-open"] === 1, r);
  check("A8 rollup keeps sum and max", r.sumMs === 50 + 60 + 70 + 80 + 90 + 120 + 200 + 400 + 900 + 3_000 + 6_000 && r.maxMs === 6_000);
  const p50 = st.percentile(r, 0.5), p95 = st.percentile(r, 0.95);
  check("A8 p50 from the histogram lies in the right bucket", p50 !== null && p50 > 100 && p50 <= 250, p50);
  check("A8 p95 from the histogram lies in the right bucket", p95 !== null && p95 > 5_000 && p95 <= 6_000, p95);
  const m = st.mergeRollups([r, r]);
  check("A8 merged rollups add up and keep percentiles", m.calls === 24 && m.buckets.reduce((a, b) => a + b, 0) === 22 && st.percentile(m, 0.5) === p50);
  const { serverTiming, parseServerTiming } = await import("@/lib/market/provenance");
  const h = serverTiming([{ source: "fmp", ms: 412.34, ok: false }, { source: "nasdaq", ms: 88, ok: true, hedge: true }, { source: "fmp", ms: 12, ok: true }], 530, true);
  check("A8 Server-Timing header format", h === 'fmp;dur=412.3;desc="2 calls, 1 failed", nasdaq;dur=88.0;desc="1 call, 1 hedged", cache;desc="stale", total;dur=530.0', h);
  const parsed = parseServerTiming(h);
  check("A8 Server-Timing parses back", parsed.length === 4 && parsed[0].name === "fmp" && parsed[0].dur === 412.3 && parsed[2].dur === null && parsed[3].dur === 530, parsed);
  const { withProvenance, noteSource } = await import("@/lib/market/provenance");
  const { sourceHeaders } = await import("@/lib/market/source-header");
  const run = await withProvenance(async () => {
    noteSource("FMP", undefined, { fetchedAt: "2026-10-21T10:00:00Z", asOf: "2026-10-21T09:59:00Z" });
    noteSource("Nasdaq", "S&P 500 tracked by the SPY ETF", { fetchedAt: "2026-10-21T08:00:00Z", stale: true, delayed: true });
    st.recordSourceCall({ source: "fmp", op: "test", ms: 5, outcome: "ok" });
  });
  const hdr = sourceHeaders(run, 10);
  const xs = JSON.parse(hdr["x-data-sources"]);
  check("A8/contract withProvenance exposes stale, delayed, oldestFetchedAt and asOf", run.stale && run.delayed && run.oldestFetchedAt === "2026-10-21T08:00:00Z" && run.asOf === "2026-10-21T09:59:00Z", run);
  check("A8/contract x-data-sources carries the freshness summary", xs.stale === true && xs.delayed === true && xs.oldestFetchedAt === "2026-10-21T08:00:00Z" && xs.providers.length === 2, xs);
  check("A8 Server-Timing comes from the calls the request made", /^fmp;dur=5\.0;desc="1 call", cache;desc="stale", total;dur=10\.0$/.test(hdr["Server-Timing"]), hdr["Server-Timing"]);
}

async function testStatsDb() {
  const st = await import("@/lib/market/stats");
  const src = `test-${uid()}`.toLowerCase();
  for (let i = 0; i < 30; i++) st.recordSourceCall({ source: src, op: "bars", ms: 100 + i, outcome: i < 3 ? "fail" : "ok", kind: i < 3 ? "timeout" : undefined });
  await st.flushSourceStats();
  for (let i = 0; i < 10; i++) st.recordSourceCall({ source: src, op: "bars", ms: 3_000, outcome: "ok" });
  for (let i = 0; i < 4; i++) st.recordSourceCall({ source: src, op: "chain:daily-bars", ms: 3_000, outcome: "ok", fallback: true, hedge: i === 0 });
  await st.flushSourceStats();
  const rows = await st.readRollups(15);
  const mine = rows.filter((x) => x.source === src);
  const sum = st.mergeRollups(mine.map((x) => x.rollup));
  check("A8(db) two flushes in one minute add up in one row per source and op (batched upsert)", mine.length === 2 && sum.calls === 44 && sum.failures === 3 && sum.fallbacks === 4 && sum.kinds.timeout === 3, { rows: mine.length, sum });
  const health = await st.sourceHealth(15);
  const h = health.find((x) => x.source === src);
  check("A8(db) health summary: p50, p95 and error rate from upstream calls, fallbacks from the chain", !!h && h.calls === 40 && Math.abs(h.errorRate - 3 / 40) < 1e-9 && h.p50 !== null && h.p95 !== null && h.p95 > 2_500 && h.fallbacks === 4 && h.hedges === 1, h);
  const { db, schema } = await import("@/db");
  const { eq } = await import("drizzle-orm");
  await db!.delete(schema.sourceStats).where(eq(schema.sourceStats.source, src));
}


/* ---------------- The registry and the chain ---------------- */

async function testRegistry() {
  const { resolveChain, REGISTRY, fromChain } = await import("@/lib/market/registry");
  const ids = (d: Parameters<typeof resolveChain>[0], o?: Parameters<typeof resolveChain>[1]) => resolveChain(d, o).map((a) => a.id);
  check("registry: daily bars default order is FMP, then Nasdaq", JSON.stringify(ids("daily-bars")) === '["fmp","nasdaq"]', ids("daily-bars"));
  check("registry: currencies FMP then the ECB; crypto FMP then CoinGecko", JSON.stringify(ids("fx")) === '["fmp","ecb"]' && JSON.stringify(ids("crypto")) === '["fmp","coingecko"]');
  check("registry: a preferred order goes first, the rest follow in default order", JSON.stringify(ids("daily-bars", { prefer: ["nasdaq"] })) === '["nasdaq","fmp"]');
  check("registry: exclude removes a source; unknown ids are ignored", JSON.stringify(ids("daily-bars", { exclude: ["fmp"], prefer: ["nope"] })) === '["nasdaq"]');
  const every = Object.values(REGISTRY).flat();
  check("registry: every adapter has an id, a label and says whether it is free", every.length > 10 && every.every((a) => a.id && a.label && typeof a.free === "boolean"));
  const datasets = Object.keys(REGISTRY);
  check("registry: the datasets are listed", ["quote", "daily-bars", "intraday", "profile", "fundamentals", "estimates", "dividends", "deals", "curve", "macro", "fx", "crypto"].every((d) => datasets.includes(d)), datasets);
  const { withProvenance } = await import("@/lib/market/provenance");
  const { historyFrom } = await import("@/lib/market/data");
  const sym = `R${uid()}`;
  calls.length = 0;
  const run = await withProvenance(() => historyFrom(sym, undefined, false, { prefer: ["nasdaq"] }));
  check("registry: a caller's preference is used (Nasdaq first: no FMP call)", run.value.source === "Nasdaq" && !calls.some((c) => c.includes("financialmodelingprep")), { source: run.value.source, calls: calls.length });
  check("registry: provenance records the adapter that answered (id and label)", run.sources.length === 1 && run.sources[0].id === "nasdaq" && /Nasdaq/.test(run.sources[0].label), run.sources);
  const chained = await fromChain("daily-bars", { symbol: `Q${uid()}`, from: DAYS[DAYS.length - 30] }).catch((e) => e);
  check("registry: fromChain answers from the default order (FMP)", chained?.by?.id === "fmp" && chained.data.length > 0, chained?.by);
}

async function testChainGeneric() {
  const { runChain } = await import("@/lib/market/chain");
  const { breakers } = await import("@/lib/market/breaker");
  const { SourceError } = await import("@/lib/market/source-error");
  const src = `test-chain-${uid()}`;
  for (let i = 0; i < 12; i++) await breakers.failure(src, new SourceError(src, "timeout", "x"));
  const t = await timed(() => runChain([
    { id: "a", source: src, op: "t", run: async () => { await sleep(5_000); return [1]; } },
    { id: "b", source: `${src}-b`, op: "t", run: async () => [2] },
  ], { hedgeDelayMs: null }));
  check("A4 an open breaker answers breaker-open at once and the chain falls back without waiting", !t.error && (t.value as { index: number }).index === 1 && t.ms < 100, { ms: Math.round(t.ms), err: t.error ? String(t.error) : null });
}

/* ---------------- A1: any primary failure falls back ---------------- */

async function testFallback() {
  const { historyFrom } = await import("@/lib/market/data");
  const { withProvenance } = await import("@/lib/market/provenance");
  const { bufferedRollups } = await import("@/lib/market/stats");
  const { withMode } = await import("@/lib/market/budgets");
  const cases: [Mode, string][] = [["hang", "timeout"], ["neterr", "network"], ["badjson", "schema"], ["503", "http"], ["limit", "rate-limit"], ["empty", "empty"]];
  for (const [mode, kind] of cases) {
    const sym = `F${uid()}`;
    fmpMode[sym] = mode;
    const r = await timed(() => withMode("interactive", () => withProvenance(() => historyFrom(sym))));
    if (mode === "hang") await sleep(700); // the primary's own timeout lands after the fallback answered
    const v = r.value as Awaited<ReturnType<typeof withProvenance<Awaited<ReturnType<typeof historyFrom>>>>> | undefined;
    const kinds = bufferedRollups().filter((x) => x.source === "fmp").reduce((a, x) => a + (x.rollup.kinds[kind as never] ?? 0), 0);
    if (mode === "limit") { const { cacheSet } = await import("@/lib/cache"); await cacheSet("fmp:daily-limit", "", 1); } // the flag would skip FMP for 30 minutes
    check(`A1 FMP ${mode}: answered from Nasdaq, failure recorded as ${kind}`, !r.error && v?.value.source === "Nasdaq" && v.sources[0]?.id === "nasdaq" && kinds > 0, { err: r.error ? String(r.error) : null, source: v?.value.source, kinds });
  }
  const sym = `M${uid()}`;
  fmpMode[sym] = "neterr";
  await historyFrom(sym).catch(() => null);
  const again = await timed(() => historyFrom(sym));
  check("A1 the same symbol again (failure remembered for 30 s) still answers from Nasdaq", !again.error && (again.value as { source: string }).source === "Nasdaq", again.error ? String(again.error) : null);
  const bg = `B${uid()}`;
  fmpMode[bg] = "hang";
  const r = await timed(() => withMode("background", () => historyFrom(bg)));
  check("A1 background mode: no hedge; the fallback starts after the primary's (longer) timeout", !r.error && (r.value as { source: string }).source === "Nasdaq" && r.ms >= 900, { ms: Math.round(r.ms), err: r.error ? String(r.error) : null });
}

/* ---------------- A2: interactive latency budget ---------------- */

async function testBudgets() {
  const { historyFrom, quoteProfile } = await import("@/lib/market/data");
  const { worstCase, budget, withMode } = await import("@/lib/market/budgets");
  // Slack for scheduling; with Postgres, each cold call also makes a few round trips (fill lease, FMP's
  // limit flag and budget slots) through a 10-connection pool, which the scaled budgets make visible.
  const BACKUP = 40, SLACK = localDb() ? 1_000 : 250;
  delays["api.nasdaq.com"] = BACKUP;
  const w = worstCase(BACKUP, budget("interactive"));
  const sym = `H${uid()}`;
  fmpMode[sym] = "hang";
  const h = await timed(() => withMode("interactive", () => historyFrom(sym)));
  check(`A2 history with FMP hanging answers from Nasdaq within hedge + backup (${w.history} ms derived)`, !h.error && h.ms <= w.history + SLACK && (h.value as { source: string }).source === "Nasdaq", { ms: Math.round(h.ms), err: h.error ? String(h.error) : null });
  const p = `P${uid()}`;
  fmpMode[p] = "hang";
  const q = await timed(() => withMode("interactive", () => quoteProfile(p)));
  check(`A2 DES price with FMP hanging answers from Nasdaq within ${w.profile} ms derived`, !q.error && !!q.value && q.ms <= w.profile + SLACK, { ms: Math.round(q.ms), err: q.error ? String(q.error) : null });
  // Boards: every FMP call hangs (one FMP outage for the whole board).
  forced["financialmodelingprep.com"] = "hang";
  const { worldIndices, sectorsView } = await import("@/lib/terminal/markets");
  const b = await timed(() => withMode("interactive", () => worldIndices()));
  const rows = (b.value ?? []) as { price: number | null }[];
  check(`A2 WEI board with FMP hanging: rows from the backups within ${w.board} ms derived`, !b.error && b.ms <= w.board + SLACK && rows.filter((r) => r.price !== null).length >= 14, { ms: Math.round(b.ms), priced: rows.filter((r) => r.price !== null).length, err: b.error ? String(b.error) : null });
  const sct = await timed(() => withMode("interactive", () => sectorsView()));
  check(`A2 SECT with FMP hanging: the sector ETFs answer within ${w.sectors} ms derived`, !sct.error && sct.ms <= w.sectors + SLACK && (sct.value as { via?: string }).via === "SPDR sector ETFs", { ms: Math.round(sct.ms), err: sct.error ? String(sct.error) : null });
  delete forced["financialmodelingprep.com"];
  delete delays["api.nasdaq.com"];
  // Hedging needs a reason: with a healthy recent record, a slow-but-answering primary is not hedged.
  const { recordSourceCall } = await import("@/lib/market/stats");
  const { hedgeDelayFor } = await import("@/lib/market/chain");
  const healthy = `healthy-${uid()}`;
  const delayNow = () => withMode("interactive", async () => hedgeDelayFor(healthy));
  check("A2 no recent record: hedge at the fixed delay", (await delayNow()) === budget("interactive").hedgeDelayMs);
  for (let i = 0; i < 25; i++) recordSourceCall({ source: healthy, op: "t", ms: 20, outcome: "ok" });
  check("A2 closed breaker and recent p95 under the delay: no hedge (extra calls capped)", (await delayNow()) === null);
  for (let i = 0; i < 5; i++) recordSourceCall({ source: healthy, op: "t", ms: 20, outcome: "fail", kind: "timeout" });
  check("A2 errors in the recent record bring the hedge back", (await delayNow()) === budget("interactive").hedgeDelayMs);
  check("A2 background mode never hedges", (await withMode("background", async () => hedgeDelayFor("anything"))) === null);
  const { mapLimit } = await import("@/lib/market/chain");
  let peak = 0, live = 0;
  const t0 = performance.now();
  await mapLimit([1, 2, 3, 4, 5, 6], 3, async () => { live++; peak = Math.max(peak, live); await sleep(50); live--; });
  const ms = performance.now() - t0;
  check("A2 PULSE-style work runs in parallel under a limit (6 jobs, 3 at a time: 2 waves)", peak === 3 && ms >= 95 && ms < 200, { peak, ms: Math.round(ms) });
}

/* ---------------- A6: one bars key per symbol ---------------- */

async function testBarsKey() {
  const { history, closes, historyFrom } = await import("@/lib/market/data");
  const sym = `K${uid()}`;
  calls.length = 0;
  const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
  const got = await Promise.all([history(sym), closes(sym, day(400)), closes(sym, day(730)), historyFrom(sym, day(50), true), historyFrom(sym, day(10), true)]);
  const fmp = calls.filter((c) => c.includes("financialmodelingprep") && c.includes(sym));
  check("A6 five features with different start dates make one upstream call", fmp.length === 1, fmp);
  const firsts = [got[1][0].date, got[2][0].date, got[3].data[0].date, got[4].data[0].date];
  check("A6 each caller gets its own slice", firsts[0] >= day(400) && firsts[1] >= day(730) && firsts[2] >= day(50) && firsts[3] >= day(10) && got[4].data.length < got[3].data.length && got[0].length > got[2].length, firsts);
}


/* ---------------- A5: SEC pacing ---------------- */

async function testSecPacing() {
  const { edgarFetch } = await import("@/lib/edgar/client");
  delays["slow-doc"] = 1_500;
  const t0 = performance.now();
  const slow = edgarFetch(`https://www.sec.gov/slow-doc-${uid()}`).then(() => performance.now() - t0);
  await sleep(20);
  const t1 = performance.now();
  const fast = await edgarFetch(`https://www.sec.gov/fast-doc-${uid()}`).then(() => performance.now() - t1);
  check("A5 a fast SEC request started after a slow one does not wait for it (was 2,982 ms behind a 3 s one)", fast < 400, { fastMs: Math.round(fast) });
  await slow;
  delete delays["slow-doc"];
  const t2 = performance.now();
  const starts: number[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (u: string | URL | Request, i?: RequestInit) => { starts.push(performance.now() - t2); return realFetch(u, i); }) as typeof fetch;
  await Promise.all(Array.from({ length: 9 }, () => edgarFetch(`https://www.sec.gov/burst-${uid()}`)));
  globalThis.fetch = realFetch;
  const gaps = starts.slice(1).map((x, i) => x - starts[i]);
  check("A5 request starts are still paced at ≤ 8 a second", gaps.every((g) => g >= 110) && starts[starts.length - 1] >= 8 * 110, { starts: starts.map(Math.round) });
}

/* ---------------- A7: compact companyfacts in the shared cache ---------------- */

async function testCompactFacts() {
  const { compactFacts } = await import("@/lib/edgar/compact");
  const full = companyFacts();
  const c = compactFacts(full as never);
  check("A7 compact form keeps the concepts the app reads (and revenue-like extensions, and dei)", !!c.facts["us-gaap"].Revenues && !!c.facts["us-gaap"].CommonStockDividendsPerShareDeclared && !!c.facts.dei?.EntityCommonStockSharesOutstanding && !!c.facts.abc?.TotalRevenueAndOtherIncome);
  check("A7 compact form drops what the app never reads", !c.facts["us-gaap"].SyntheticUnreadConcept7 && !c.facts.abc?.SomethingElse && JSON.stringify(c).length < JSON.stringify(full).length / 5, { full: JSON.stringify(full).length, compact: JSON.stringify(c).length });
}

async function testCompactFactsDb() {
  const { getCompanyFacts } = await import("@/lib/edgar/facts");
  const { sharedMap } = await import("@/lib/shared");
  const cik = String(9_000_000_000 + Math.floor(Math.random() * 99_999_999)).padStart(10, "0");
  calls.length = 0;
  const a = await getCompanyFacts(cik);
  const first = calls.filter((u) => u.includes("companyfacts")).length;
  for (const k of ["cache:mem", "edgar:mem", "cache:loading", "cache:failed", "edgar:inflight"]) sharedMap(k).clear(); // a second instance: memory empty
  calls.length = 0;
  const b = await getCompanyFacts(cik);
  check("A7 a second instance (memory cleared) makes 0 SEC calls for companyfacts", first === 1 && calls.filter((u) => u.includes("companyfacts")).length === 0 && JSON.stringify(a) === JSON.stringify(b), { first, second: calls.length });
  const { db, schema } = await import("@/db");
  const { like } = await import("drizzle-orm");
  await db!.delete(schema.kvCache).where(like(schema.kvCache.key, `%${cik}%`));
}

/* ---------------- A3: the company record and the EDGAR layer serve stale ---------------- */

async function testCompanyStaleDb() {
  const { db, schema } = await import("@/db");
  const { eq } = await import("drizzle-orm");
  const { getCompanyData } = await import("@/lib/company");
  const { withProvenance } = await import("@/lib/market/provenance");
  const ticker = `Z${uid()}`.slice(0, 8);
  const record = { ticker, name: "Stale Co", cik: "0000000001", price: null, balance: { asOf: "2026-01-31", cash: 1, debt: 0, sharesOut: 100 }, ltm: {}, quarters: [], filings: [], description: "", sources: { concepts: {}, notes: [] } };
  forced["sec.gov"] = "neterr"; // SEC is down: a refresh cannot succeed
  try {
    await db!.insert(schema.companyCache).values({ ticker, data: record, fetchedAt: new Date(Date.now() - 8 * 3_600_000) });
    const r = await timed(() => withProvenance(() => getCompanyData(ticker)));
    const v = r.value as Awaited<ReturnType<typeof withProvenance<unknown>>> | undefined;
    check("A3 a company record past 6 h is served (flagged stale) while SEC is down", !r.error && !!v?.value && v.stale === true && (v.value as { name: string }).name === "Stale Co", { err: r.error ? String(r.error) : null, stale: v?.stale });
    await db!.update(schema.companyCache).set({ fetchedAt: new Date(Date.now() - 8 * 86_400_000) }).where(eq(schema.companyCache.ticker, ticker));
    const { forgetMemo } = await import("@/lib/memo");
    forgetMemo(`company:${ticker}`);
    const old = await timed(() => getCompanyData(ticker));
    check("A3 a record past its stale window (7 days) is not served when SEC is down", !!old.error || old.value === null, old.error ? String(old.error) : old.value);
  } finally {
    delete forced["sec.gov"];
    await db!.delete(schema.companyCache).where(eq(schema.companyCache.ticker, ticker));
  }
}

/* ---------------- A9: AI research has a hard budget ---------------- */

async function testResearchBudget() {
  const { research } = await import("@/lib/market/research");
  const { budget, withMode } = await import("@/lib/market/budgets");
  process.env.OPENAI_API_KEY = "test-key";
  try {
    calls.length = 0;
    const r = await timed(() => withMode("interactive", () => research(`Budget Co ${uid()}`, ["price"])));
    const ms = budget("interactive").researchMs;
    check(`A9 research with a hanging model is cut off at its budget (${ms} ms scaled) and answers null`, !r.error && r.value === null && r.ms >= ms - 20 && r.ms < ms + 300, { ms: Math.round(r.ms), err: r.error ? String(r.error) : null, openai: calls.filter((c) => c.includes("openai")).length });
    check("A9 the model was actually asked (the stub saw the request)", calls.some((c) => c.includes("api.openai.com")));
  } finally {
    delete process.env.OPENAI_API_KEY;
  }
}


async function testHealthRoute() {
  const { GET } = await import("@/app/api/market/health/route");
  process.env.CRON_SECRET = "test-secret";
  try {
    const anon = await GET(new Request("http://localhost/api/market/health"));
    const wrong = await GET(new Request("http://localhost/api/market/health", { headers: { authorization: "Bearer nope" } }));
    check("A8 /api/market/health stays operator-only (401 without the CRON_SECRET bearer)", anon.status === 401 && wrong.status === 401);
    const res = await GET(new Request("http://localhost/api/market/health", { headers: { authorization: "Bearer test-secret" } }));
    const body = await res.json() as { results: { name: string }[]; sources: { source: string; breaker: string }[]; chains: Record<string, string[]> };
    const probes = body.results.map((r) => r.name);
    check("A8 health probes SEC, Treasury, FRED, BLS and DefiLlama", ["SEC submissions", "SEC full-text search", "Treasury yield curve", "FRED", "BLS", "DefiLlama"].every((n) => probes.includes(n)), probes);
    check("A8 health reports each source's breaker and the registry's chains", ["fmp", "nasdaq", "sec", "treasury"].every((n) => body.sources.some((x) => x.source === n && typeof x.breaker === "string")) && body.chains["daily-bars"]?.[0] === "fmp", body.sources.slice(0, 3));
  } finally {
    delete process.env.CRON_SECRET;
  }
}


/* ---------------- A10: the latency script ---------------- */

async function testLatencyScript() {
  const { createServer } = await import("node:http");
  const { execFile } = await import("node:child_process");
  const { mkdtempSync, readFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  let n = 0;
  const server = createServer((req, res) => {
    n++;
    const fmp = 300 + (n % 5) * 10;
    res.setHeader("server-timing", `fmp;dur=${fmp};desc="1 call", nasdaq;dur=90.5;desc="1 call, 1 hedged", total;dur=${fmp + 20}`);
    res.setHeader("x-data-sources", JSON.stringify({ providers: ["FMP"], notes: [], stale: req.url?.includes("indices") ?? false }));
    res.setHeader("content-type", "application/json");
    res.end(req.headers.cookie === "session=abc" ? "{}" : JSON.stringify({ error: "sign in" }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as { port: number }).port;
  const out = join(mkdtempSync(join(tmpdir(), "latency-")), "out.json");
  const run = await new Promise<{ code: number; stdout: string }>((resolve) => {
    execFile("pnpm", ["exec", "tsx", "scripts/data-latency.mts", "--base", `http://127.0.0.1:${port}`, "--cookie", "session=abc", "--runs", "3", "--tickers", "AAPL", "--fns", "price,indices,companies", "--json", out], { timeout: 60_000 }, (err, stdout) => resolve({ code: err ? 1 : 0, stdout }));
  });
  server.close();
  let report: { commands?: Record<string, { n: number; p50: number }>; sources?: Record<string, { n: number; p50: number; p95: number }>; samples?: { stale: boolean }[] } = {};
  try { report = JSON.parse(readFileSync(out, "utf8")); } catch { /* missing */ }
  check("A10 data-latency.mts measures every command it was asked for", run.code === 0 && report.commands?.price?.n === 3 && report.commands?.indices?.n === 3 && report.commands?.companies?.n === 3, { code: run.code, commands: report.commands, tail: run.stdout.slice(-300) });
  check("A10 per-source p50/p95 come from the server's Server-Timing (not this machine's clock)", report.sources?.fmp?.n === 9 && report.sources.fmp.p50 >= 300 && report.sources.fmp.p95 <= 340 && report.sources?.nasdaq?.p50 === 90.5 && !("total" in (report.sources ?? {})), report.sources);
  check("A10 it counts stale answers from x-data-sources", (report.samples ?? []).filter((x) => x.stale).length === 3);
}

/* ---------------- Review regressions ---------------- */

/** A Nasdaq outage (or its open breaker) must not be remembered as "this symbol is not on Nasdaq". */
async function testNasdaqClassAfterOutage() {
  const { nasdaqHistory } = await import("@/lib/market/nasdaq");
  const { sharedMap } = await import("@/lib/shared");
  const sym = `N${uid()}`;
  const from = DAYS[DAYS.length - 30];
  forced[`/quote/${sym}/info`] = "503";
  let during: unknown[] = [];
  try { during = await nasdaqHistory(sym, from); } finally { delete forced[`/quote/${sym}/info`]; }
  sharedMap("cache:failed").clear(); // the half-minute failure memo has passed
  const after = await nasdaqHistory(sym, from);
  check("R1 a Nasdaq 503 while probing a symbol's class is not cached as \"none\" (bars come back once Nasdaq does)", during.length === 0 && after.length > 0, { during: during.length, after: after.length });
}

/** Under a full shared SEC budget, requests that wait for a slot still start ≥ 125 ms apart in this process. */
async function testSecPacingContendedDb() {
  const { edgarFetch } = await import("@/lib/edgar/client");
  const { db, schema } = await import("@/db");
  const { like } = await import("drizzle-orm");
  await sleep(1_000 - (Date.now() % 1_000) + 5); // the start of a fresh one-second window
  const win = Math.floor(Date.now() / 1_000);
  await db!.insert(schema.kvCache).values({ key: `rate:edgar:${win}`, value: "100", expiresAt: new Date(Date.now() + 120_000) })
    .onConflictDoUpdate({ target: schema.kvCache.key, set: { value: "100" } });
  const t0 = performance.now(), starts: number[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (u: string | URL | Request, i?: RequestInit) => { if (String(u).includes("contended-")) starts.push(performance.now() - t0); return realFetch(u, i); }) as typeof fetch;
  try {
    await Promise.all(Array.from({ length: 8 }, () => edgarFetch(`https://www.sec.gov/contended-${uid()}`).catch(() => null)));
  } finally {
    globalThis.fetch = realFetch;
    await db!.delete(schema.kvCache).where(like(schema.kvCache.key, "rate:edgar:%"));
  }
  starts.sort((a, b) => a - b);
  const gaps = starts.slice(1).map((x, i) => x - starts[i]);
  check("R2 SEC request starts stay ≥ 125 ms apart after waiting for the shared budget (no burst when a window opens)", starts.length === 8 && gaps.every((g) => g >= 110), { starts: starts.map(Math.round) });
}

/** source_stats keeps 30 days: older rows are pruned, a batch at a time. */
async function testStatsPruneDb() {
  const st = await import("@/lib/market/stats");
  const { db, schema } = await import("@/db");
  const { eq } = await import("drizzle-orm");
  const src = `test-prune-${uid()}`.toLowerCase();
  const minute = (daysAgo: number) => new Date(Math.floor((Date.now() - daysAgo * 86_400_000) / 60_000) * 60_000);
  await db!.insert(schema.sourceStats).values([{ minute: minute(40), source: src, op: "old", calls: 1 }, { minute: minute(1), source: src, op: "recent", calls: 1 }]);
  try {
    await st.pruneSourceStats();
    const left = (await db!.select().from(schema.sourceStats).where(eq(schema.sourceStats.source, src))).map((r) => r.op).sort();
    check("R3 rows older than 30 days are pruned and recent ones kept", JSON.stringify(left) === '["recent"]', left);
  } finally {
    await db!.delete(schema.sourceStats).where(eq(schema.sourceStats.source, src));
  }
}

/** The latency script refuses aggressive runs against a non-local deployment, before any request. */
async function testLatencyScriptLimits() {
  const { execFile } = await import("node:child_process");
  const run = (args: string[]) => new Promise<{ code: number; out: string }>((resolve) => {
    execFile("pnpm", ["exec", "tsx", "scripts/data-latency.mts", ...args], { timeout: 60_000 }, (err, stdout, stderr) => resolve({ code: err ? (typeof err.code === "number" ? err.code : 1) : 0, out: `${stdout}${stderr}` }));
  });
  const many = await run(["--base", "https://youbank.invalid", "--runs", "50", "--fns", "price"]);
  const fast = await run(["--base", "https://youbank.invalid", "--gap", "0", "--fns", "price"]);
  check("R4 data-latency.mts refuses more than 20 runs per command against a non-local deployment", many.code === 2 && /refus/i.test(many.out) && !/Measuring/.test(many.out), many);
  check("R4 data-latency.mts refuses a gap under 500 ms between requests against a non-local deployment", fast.code === 2 && /refus/i.test(fast.out) && !/Measuring/.test(fast.out), fast);
}

/** The compact companyfacts cache key changes when the allowlist does, so a new concept is never read from an old entry. */
async function testCompactVersion() {
  const { compactVersion, FACT_CONCEPTS } = await import("@/lib/edgar/compact");
  check("R5 the compact companyfacts version follows the allowlist", compactVersion() === compactVersion(FACT_CONCEPTS) && compactVersion(new Set([...FACT_CONCEPTS, "SomeNewConcept"])) !== compactVersion(), compactVersion());
}

/* ---------------- Main ---------------- */

async function main() {
  const { overrideBudgets } = await import("@/lib/market/budgets");
  // Scaled budgets: hedge 200 ms, FMP 600 ms per attempt (interactive); 1 s (background).
  overrideBudgets("interactive", { hedgeDelayMs: 200, fmpTimeoutMs: 600, nasdaqTimeoutMs: 600, freeTimeoutMs: 600, secTimeoutMs: 600, macroTimeoutMs: 600, fmpSlotTries: 2, researchMs: 400 });
  overrideBudgets("background", { fmpTimeoutMs: 1_000, nasdaqTimeoutMs: 1_000, freeTimeoutMs: 1_000, secTimeoutMs: 1_000, macroTimeoutMs: 1_000, fmpSlotTries: 2, researchMs: 400 });
  await section("registry: datasets and adapters", testRegistry);
  await section("A1 any primary failure falls back", testFallback);
  await (await import("@/lib/market/breaker")).breakers.reset("fmp");
  await section("A2 interactive latency budgets and hedging", testBudgets);
  const { breakers } = await import("@/lib/market/breaker");
  await breakers.reset("fmp"); // the outages above opened FMP's breaker, as they should
  await section("A6 one daily-bars key per symbol", testBarsKey);
  await section("A3 cacheJson: stale-while-revalidate and stale-if-error", testSwr);
  await section("A5 SEC pacing schedules starts, not whole requests", testSecPacing);
  await section("A7 compact companyfacts", testCompactFacts);
  if (localDb()) await section("A7 companyfacts through the shared cache", testCompactFactsDb);
  if (localDb()) await section("A3 the company record serves stale within its window", testCompanyStaleDb);
  await section("A9 AI research budget", testResearchBudget);
  await section("A4 circuit breakers", testBreaker);
  await section("A4 an open breaker in the chain", testChainGeneric);
  if (localDb()) await section("A4 circuit breakers shared through Postgres", testBreakerDb);
  await section("A8 telemetry: rollups and Server-Timing", testStats);
  if (localDb()) await section("A8 telemetry: per-minute rollups in Postgres", testStatsDb);
  await section("A8 health route", testHealthRoute);
  await section("A10 the latency script", testLatencyScript);
  await section("R1 a Nasdaq outage is not cached as \"not on Nasdaq\"", testNasdaqClassAfterOutage);
  if (localDb()) await section("R2 SEC starts stay paced under a full shared budget", testSecPacingContendedDb);
  if (localDb()) await section("R3 source_stats retention", testStatsPruneDb);
  await section("R4 the latency script's limits", testLatencyScriptLimits);
  await section("R5 compact companyfacts versioning", testCompactVersion);
  if (!localDb()) console.log("database checks skipped (set DATABASE_URL to a local database to run them)");
  console.log(`\n${pass} passed, ${fail} failed`);
  const { pgClient } = await import("@/db");
  await pgClient?.end({ timeout: 1 }).catch(() => undefined);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
