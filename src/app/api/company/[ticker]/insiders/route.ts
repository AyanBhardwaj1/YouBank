import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { resolveTicker } from "@/lib/edgar/tickers";
import { insiderTransactions } from "@/lib/edgar/insiders";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ ticker: string }> }) {
  return guarded(async () => {
    const { ticker } = await ctx.params;
    const row = await resolveTicker(ticker);
    if (!row) return NextResponse.json({ error: `Unknown ticker ${ticker}` }, { status: 404 });
    const limit = Math.min(30, Number(new URL(req.url).searchParams.get("limit") ?? 16));
    return NextResponse.json({ ticker: row.ticker, transactions: await insiderTransactions(row.ticker, row.cik, limit) });
  });
}
