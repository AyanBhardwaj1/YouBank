import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { resolveTicker } from "@/lib/edgar/tickers";
import { getSubmissions, listFilings } from "@/lib/edgar/submissions";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ ticker: string }> }) {
  return guarded(async () => {
    const { ticker } = await ctx.params;
    const row = await resolveTicker(ticker);
    if (!row) return NextResponse.json({ error: `Unknown ticker ${ticker}` }, { status: 404 });
    const url = new URL(req.url);
    const forms = (url.searchParams.get("forms") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const limit = Math.min(120, Number(url.searchParams.get("limit") ?? 60));
    const sub = await getSubmissions(row.cik);
    return NextResponse.json({ ticker: row.ticker, name: sub.name, cik: row.cik, filings: listFilings(sub, forms, limit) });
  });
}
