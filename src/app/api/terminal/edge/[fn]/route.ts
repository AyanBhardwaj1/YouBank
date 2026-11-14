import { after, NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { requireEdge } from "@/lib/edge/access";
import { refreshIfStale } from "@/lib/edge/passes";
import { describeFailure } from "@/lib/errors";
import { withMode } from "@/lib/market/budgets";
import { withProvenance } from "@/lib/market/provenance";
import { sourceHeaders } from "@/lib/market/source-header";
import { flushSourceStats } from "@/lib/market/stats";
import { parseTape } from "@/lib/terminal/edge-signals";
import { altView } from "@/lib/terminal/edge/alt";
import { evtsView } from "@/lib/terminal/edge/evts";
import { flrView } from "@/lib/terminal/edge/flr";
import { marbView, spreadHistoryView } from "@/lib/terminal/edge/marb";
import { satView } from "@/lib/terminal/edge/sat";

export const dynamic = "force-dynamic";
// A stale flare pass runs after FLR's response, inside this budget.
export const maxDuration = 60;

const TICKER = /^[A-Z][A-Z0-9.\-]{0,9}$/;
/** How long the browser may reuse an answer: the tape and the flare board are live, deals a little slower. */
const TTL: Record<string, number> = { spread: 900, marb: 60, sat: 60, flr: 30, alt: 300, evts: 15 };
const fail = (message: string, status: number) => Object.assign(new Error(message), { status });

async function compute(fn: string, p: URLSearchParams, userId: string): Promise<unknown> {
  const ticker = (p.get("ticker") ?? "").toUpperCase();
  const needTicker = () => { if (!TICKER.test(ticker)) throw fail("Give a ticker, e.g. SAT XOM", 400); };
  switch (fn) {
    case "marb": return marbView();
    case "spread": {
      // One deal's spread history (MARB's drill-down): its tickers, terms and announcement date.
      const acquirer = (p.get("acquirer") ?? "").toUpperCase(), from = p.get("from") ?? "";
      if (!TICKER.test(ticker) || (acquirer && !TICKER.test(acquirer)) || !/^\d{4}-\d{2}-\d{2}$/.test(from)) throw fail("Give the deal's tickers and announcement date", 400);
      const n = (k: string) => { const v = Number(p.get(k)); return p.get(k) && Number.isFinite(v) && v > 0 ? v : null; };
      const cons = p.get("cons");
      return spreadHistoryView({ target: ticker, acquirer, from, terms: { consideration: cons === "cash" || cons === "stock" || cons === "mixed" ? cons : "", cash: n("cash"), ratio: n("ratio"), stated: n("stated") } });
    }
    case "sat": needTicker(); return satView(userId, ticker);
    case "alt": needTicker(); return altView(ticker);
    case "flr": return flrView({ all: p.get("all") === "1" });
    case "evts": {
      const words = parseTape(p.get("q") ?? "");
      return evtsView(userId, { group: (p.get("group") ?? words.group)?.toUpperCase() || null, ticker: (p.get("ticker") || words.ticker || "").toUpperCase() || null, severity: words.severity });
    }
    default: throw fail(`Unknown Edge monitor ${fn.slice(0, 20)}`, 404);
  }
}

/**
 * The Terminal's Edge monitors (MARB, SAT, FLR, ALT, EVTS): GET /api/terminal/edge/<fn>. Each answer
 * carries its sources' states in the body; market prices also go in x-data-sources, as for every
 * terminal function, so the screen badges a backup or a delayed quote.
 */
export async function GET(req: Request, ctx: { params: Promise<{ fn: string }> }) {
  return guarded(async (user) => {
    await requireEdge(user.id);
    const fn = (await ctx.params).fn;
    const params = new URL(req.url).searchParams;
    const t0 = performance.now();
    const work = async () => { try { return { data: await compute(fn, params, user.id) } as const; } catch (error) { return { error } as const; } };
    const run = await withProvenance(() => withMode("interactive", work));
    try { after(flushSourceStats); } catch { /* outside a request */ }
    // An open flare board keeps flaring within the hour without a cron, like the feed.
    if (fn === "flr" || fn === "sat") { try { after(() => refreshIfStale(40_000)); } catch { /* outside a request */ } }
    const headers = sourceHeaders(run, performance.now() - t0);
    if ("data" in run.value) return NextResponse.json(run.value.data, { headers: { ...headers, "Cache-Control": `private, max-age=${TTL[fn] ?? 30}` } });
    const f = describeFailure(run.value.error, 500, `terminal-edge-${fn}`);
    return NextResponse.json({ error: f.message, ...(f.ref ? { ref: f.ref } : {}) }, { status: f.status, headers });
  });
}
