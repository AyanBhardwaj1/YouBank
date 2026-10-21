import { NextResponse } from "next/server";
import { searchTickers } from "@/lib/edgar/tickers";
import { guarded } from "@/lib/auth/user";
import { sourceDownResponse } from "@/lib/net";

export async function GET(req: Request) {
  return guarded(async () => {
    const q = new URL(req.url).searchParams.get("q") ?? "";
    try {
      return NextResponse.json(await searchTickers(q, 8));
    } catch (e) {
      // SEC's company list could not be fetched: a 503 that says so (the command bar offers an exact ticker).
      const down = sourceDownResponse(e, "SEC EDGAR", "search");
      if (down) return down;
      throw e;
    }
  });
}
