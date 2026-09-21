import { NextResponse } from "next/server";
import { getCompanyData } from "@/lib/company";
import { guarded } from "@/lib/auth/user";

export async function GET(_req: Request, ctx: { params: Promise<{ ticker: string }> }) {
  return guarded(async () => {
    const { ticker } = await ctx.params;
    try {
      const data = await getCompanyData(ticker);
      if (!data) return NextResponse.json({ error: `Unknown ticker ${ticker.toUpperCase()}` }, { status: 404 });
      return NextResponse.json(data, { headers: { "Cache-Control": "private, max-age=60" } });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
    }
  });
}
