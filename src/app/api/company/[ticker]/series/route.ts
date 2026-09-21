import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { resolveTicker } from "@/lib/edgar/tickers";
import { conceptSeries, findConcepts } from "@/lib/edgar/series";

export const dynamic = "force-dynamic";

/** ?concepts=LongTermDebt,InterestExpense&periods=8 or ?find=Debt|Notes */
export async function GET(req: Request, ctx: { params: Promise<{ ticker: string }> }) {
  return guarded(async () => {
    const { ticker } = await ctx.params;
    const row = await resolveTicker(ticker);
    if (!row) return NextResponse.json({ error: `Unknown ticker ${ticker}` }, { status: 404 });
    const url = new URL(req.url);
    const find = url.searchParams.get("find");
    if (find) return NextResponse.json({ ticker: row.ticker, matches: await findConcepts(row.cik, find.slice(0, 80)) });
    const concepts = (url.searchParams.get("concepts") ?? "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 24);
    const periods = Math.min(16, Math.max(1, Number(url.searchParams.get("periods") ?? 8)));
    return NextResponse.json({ ticker: row.ticker, cik: row.cik, series: await conceptSeries(row.cik, concepts, periods) });
  });
}
