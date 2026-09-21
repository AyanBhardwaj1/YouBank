import { NextResponse } from "next/server";
import { getCompanies } from "@/lib/company";
import { guarded } from "@/lib/auth/user";

export async function GET(req: Request) {
  return guarded(async () => {
  const tickers = (new URL(req.url).searchParams.get("tickers") ?? "").split(",").map((t) => t.trim()).filter(Boolean);
  if (tickers.length === 0) return NextResponse.json({ error: "tickers required" }, { status: 400 });
  if (tickers.length > 25) return NextResponse.json({ error: "max 25 tickers" }, { status: 400 });
  return NextResponse.json(await getCompanies(tickers));
  });
}
