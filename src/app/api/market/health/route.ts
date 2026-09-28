import { NextResponse } from "next/server";
import { secretsMatch } from "@/lib/crm/crypto";
import { cacheGet } from "@/lib/cache";
import { BASE as NASDAQ, HEADERS as NASDAQ_HEADERS, backupEnabled } from "@/lib/market/nasdaq";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Which market-data layers answer from where the app runs: FMP, Nasdaq, the ECB rates and CoinGecko.
 * For operators only (Bearer CRON_SECRET). Each probe is a direct request, past the cache, so it shows
 * whether this deployment can reach the source now (a cloud IP can be blocked where a laptop is not).
 * It reports reachability and latency, not data. AI research is not called here, because each lookup
 * costs money; its switch and models are reported instead.
 */
export async function GET(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  if (!process.env.CRON_SECRET || !secretsMatch(auth, `Bearer ${process.env.CRON_SECRET}`)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const probe = async (name: string, url: string, headers: Record<string, string>, ok: (j: unknown) => boolean) => {
    const t0 = Date.now();
    try {
      const res = await fetch(url, { headers, cache: "no-store", signal: AbortSignal.timeout(12_000) });
      if (!res.ok) return { name, ok: false, ms: Date.now() - t0, error: `HTTP ${res.status}` };
      return { name, ok: ok(await res.json().catch(() => null)), ms: Date.now() - t0 };
    } catch (e) {
      return { name, ok: false, ms: Date.now() - t0, error: e instanceof Error ? e.message.slice(0, 120) : "failed" };
    }
  };
  const today = new Date().toISOString().slice(0, 10), from = new Date(Date.now() - 20 * 86_400_000).toISOString().slice(0, 10);
  const json = { Accept: "application/json" };
  /** A value deep in parsed JSON: at(j, "data", "primaryData") is j.data.primaryData, or undefined. */
  const at = (j: unknown, ...path: string[]) => path.reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), j);
  const key = process.env.FMP_API_KEY;
  const results = await Promise.all([
    key ? probe("FMP profile", `https://financialmodelingprep.com/stable/profile?symbol=AAPL&apikey=${key}`, json, (j) => Array.isArray(j) && j.length > 0) : { name: "FMP profile", ok: false, ms: 0, error: "no FMP_API_KEY" },
    probe("Nasdaq quote", `${NASDAQ}/quote/SNOW/info?assetclass=stocks`, NASDAQ_HEADERS, (j) => !!at(j, "data", "primaryData", "lastSalePrice")),
    probe("Nasdaq history", `${NASDAQ}/quote/SPY/historical?assetclass=etf&fromdate=${from}&limit=30&todate=${today}`, NASDAQ_HEADERS, (j) => ((at(j, "data", "tradesTable", "rows") as unknown[] | undefined)?.length ?? 0) > 5),
    probe("ECB rates", `https://api.frankfurter.app/${from}..${today}?from=EUR&to=USD`, json, (j) => Object.keys((at(j, "rates") as object | undefined) ?? {}).length > 5),
    probe("CoinGecko", "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd", json, (j) => Number(at(j, "bitcoin", "usd")) > 0),
  ]);
  return NextResponse.json({
    backups: backupEnabled() ? "on" : "off (MARKET_BACKUP=off)",
    fmpDailyLimitHit: !!(await cacheGet("fmp:daily-limit")),
    research: { model: process.env.MARKET_RESEARCH_MODEL || "gpt-5.6-luna", escalation: process.env.MARKET_RESEARCH_ESCALATION_MODEL || "gpt-5.4-mini", openaiKey: !!process.env.OPENAI_API_KEY },
    results,
  }, { headers: { "Cache-Control": "no-store" } });
}
