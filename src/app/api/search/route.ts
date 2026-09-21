import { NextResponse } from "next/server";
import { searchTickers } from "@/lib/edgar/tickers";
import { guarded } from "@/lib/auth/user";

export async function GET(req: Request) {
  return guarded(async () => {
    const q = new URL(req.url).searchParams.get("q") ?? "";
    return NextResponse.json(await searchTickers(q, 8));
  });
}
