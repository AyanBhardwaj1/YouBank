import { NextResponse } from "next/server";
import { getCompanyData } from "@/lib/company";
import { guarded } from "@/lib/auth/user";
import { errorResponse } from "@/lib/errors";

export async function GET(_req: Request, ctx: { params: Promise<{ ticker: string }> }) {
  return guarded(async () => {
    const { ticker } = await ctx.params;
    try {
      const data = await getCompanyData(ticker);
      if (!data) return NextResponse.json({ error: `Unknown ticker ${ticker.toUpperCase()}` }, { status: 404 });
      return NextResponse.json(data, { headers: { "Cache-Control": "private, max-age=60" } });
    } catch (e) {
      return errorResponse(e, 502);
    }
  });
}
