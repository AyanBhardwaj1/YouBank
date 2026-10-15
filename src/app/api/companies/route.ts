import { NextResponse } from "next/server";
import { getCompanies } from "@/lib/company";
import { guarded } from "@/lib/auth/user";

export async function GET(req: Request) {
  return guarded(async () => {
  const tickers = (new URL(req.url).searchParams.get("tickers") ?? "").split(",").map((t) => t.trim()).filter(Boolean);
  if (tickers.length === 0) return NextResponse.json({ error: "Enter at least one ticker." }, { status: 400 });
  if (tickers.length > 25) return NextResponse.json({ error: "Ask for at most 25 tickers at a time." }, { status: 400 });
  return NextResponse.json(await getCompanies(tickers));
  });
}
