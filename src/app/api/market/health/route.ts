import { NextResponse } from "next/server";
import { secretsMatch } from "@/lib/crm/crypto";
import { cacheGet } from "@/lib/cache";
import { UA as SEC_UA } from "@/lib/edgar/client";
import { breakers } from "@/lib/market/breaker";
import { budget } from "@/lib/market/budgets";
import { BASE as NASDAQ, HEADERS as NASDAQ_HEADERS, backupEnabled } from "@/lib/market/nasdaq";
import { REGISTRY } from "@/lib/market/registry";
import { flushSourceStats, sourceHealth } from "@/lib/market/stats";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Sources the data layer calls, so each shows a breaker state even before any call was recorded. */
const SOURCES = ["fmp", "nasdaq", "sec", "treasury", "fred", "bls", "ecb", "coingecko", "defillama"];

/**
 * Which data sources answer from where the app runs, and how they have been doing. For operators only
 * (Bearer CRON_SECRET). docs/data-layer.md explains each field.
 * - `results`: a direct probe of each source, past the cache (FMP, Nasdaq, SEC data and full-text search,
 *   the Treasury's curve, FRED, BLS, the ECB rates, CoinGecko, DefiLlama), so it shows whether this
 *   deployment can reach the source now (a cloud IP can be blocked where a laptop is not). It reports
 *   reachability and latency, not data. The BLS probe spends one of its keyless 25 daily requests.
 * - `sources`: the last hour of every instance's calls (source_stats, drizzle/0028): calls, p50/p95,
 *   error rate, failures by kind, fallbacks and hedges; with each source's circuit breaker.
 * - `chains`: each dataset's sources in default order (market/registry).
 * AI research is not called here, because each lookup costs money; its switch and models are reported instead.
 */
export async function GET(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  if (!process.env.CRON_SECRET || !secretsMatch(auth, `Bearer ${process.env.CRON_SECRET}`)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const probe = async (name: string, url: string, headers: Record<string, string>, ok: (body: unknown) => boolean, as: "json" | "text" = "json") => {
    const t0 = Date.now();
    try {
      const res = await fetch(url, { headers, cache: "no-store", signal: AbortSignal.timeout(12_000) });
      if (!res.ok) return { name, ok: false, ms: Date.now() - t0, error: `HTTP ${res.status}` };
      const body = as === "json" ? await res.json().catch(() => null) : await res.text().catch(() => "");
      return { name, ok: ok(body), ms: Date.now() - t0 };
    } catch (e) {
      return { name, ok: false, ms: Date.now() - t0, error: e instanceof Error ? e.message.slice(0, 120) : "failed" };
    }
  };
  const today = new Date().toISOString().slice(0, 10), from = new Date(Date.now() - 20 * 86_400_000).toISOString().slice(0, 10);
  const year = new Date().getUTCFullYear();
  const json = { Accept: "application/json" };
  const sec = { "User-Agent": SEC_UA, Accept: "application/json" };
  /** A value deep in parsed JSON: at(j, "data", "primaryData") is j.data.primaryData, or undefined. */
  const at = (j: unknown, ...path: string[]) => path.reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), j);
  const key = process.env.FMP_API_KEY;
  // This instance's last calls first, so the rollups below include them.
  await flushSourceStats();
  const [results, sources] = await Promise.all([
    Promise.all([
      key ? probe("FMP profile", `https://financialmodelingprep.com/stable/profile?symbol=AAPL&apikey=${key}`, json, (j) => Array.isArray(j) && j.length > 0) : { name: "FMP profile", ok: false, ms: 0, error: "no FMP_API_KEY" },
      probe("Nasdaq quote", `${NASDAQ}/quote/SNOW/info?assetclass=stocks`, NASDAQ_HEADERS, (j) => !!at(j, "data", "primaryData", "lastSalePrice")),
      probe("Nasdaq history", `${NASDAQ}/quote/SPY/historical?assetclass=etf&fromdate=${from}&limit=30&todate=${today}`, NASDAQ_HEADERS, (j) => ((at(j, "data", "tradesTable", "rows") as unknown[] | undefined)?.length ?? 0) > 5),
      probe("SEC submissions", "https://data.sec.gov/submissions/CIK0000320193.json", sec, (j) => !!at(j, "cik")),
      probe("SEC full-text search", `https://efts.sec.gov/LATEST/search-index?q=%22Agreement%20and%20Plan%20of%20Merger%22&forms=8-K&dateRange=custom&startdt=${from}&enddt=${today}`, sec, (j) => at(j, "hits", "hits") !== undefined),
      probe("Treasury yield curve", `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/${year}/all?type=daily_treasury_yield_curve&field_tdr_date_value=${year}&page&_format=csv`, {}, (t) => typeof t === "string" && /^"?Date/.test(t.trim()), "text"),
      probe("FRED", "https://fred.stlouisfed.org/graph/fredgraph.csv?id=FEDFUNDS", { "User-Agent": "YouBank research terminal" }, (t) => typeof t === "string" && t.split("\n").length > 10, "text"),
      probe("BLS", "https://api.bls.gov/publicAPI/v1/timeseries/data/CUUR0000SA0", json, (j) => at(j, "status") === "REQUEST_SUCCEEDED"),
      probe("ECB rates", `https://api.frankfurter.app/${from}..${today}?from=EUR&to=USD`, json, (j) => Object.keys((at(j, "rates") as object | undefined) ?? {}).length > 5),
      probe("CoinGecko", "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd", json, (j) => Number(at(j, "bitcoin", "usd")) > 0),
      probe("DefiLlama", "https://api.llama.fi/v2/chains", json, (j) => Array.isArray(j) && j.length > 10),
    ]),
    sourceHealth(60).catch(() => []),
  ]);
  const names = [...new Set([...SOURCES, ...sources.map((s) => s.source)])];
  const breakerViews = Object.fromEntries(await Promise.all(names.map(async (n) => [n, await breakers.view(n).catch(() => "unknown")] as const)));
  const b = budget("interactive");
  return NextResponse.json({
    backups: backupEnabled() ? "on" : "off (MARKET_BACKUP=off)",
    fmpDailyLimitHit: !!(await cacheGet("fmp:daily-limit")),
    secUserAgentSet: !!process.env.EDGAR_USER_AGENT,
    research: { model: process.env.MARKET_RESEARCH_MODEL || "gpt-5.6-luna", escalation: process.env.MARKET_RESEARCH_ESCALATION_MODEL || "gpt-5.4-mini", openaiKey: !!process.env.OPENAI_API_KEY, budgetMs: b.researchMs },
    budgets: { hedgeDelayMs: b.hedgeDelayMs, fmpTimeoutMs: b.fmpTimeoutMs, nasdaqTimeoutMs: b.nasdaqTimeoutMs, secTimeoutMs: b.secTimeoutMs, macroTimeoutMs: b.macroTimeoutMs },
    results,
    sources: names.map((n) => ({ ...(sources.find((s) => s.source === n) ?? { calls: 0 }), source: n, breaker: breakerViews[n] })),
    chains: Object.fromEntries(Object.entries(REGISTRY).map(([d, list]) => [d, list.map((a) => a.id)])),
  }, { headers: { "Cache-Control": "no-store" } });
}
