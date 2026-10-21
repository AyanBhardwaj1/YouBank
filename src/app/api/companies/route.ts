import { NextResponse } from "next/server";
import { getCompanies } from "@/lib/company";
import { guarded } from "@/lib/auth/user";

export async function GET(req: Request) {
  return guarded(async () => {
  const tickers = (new URL(req.url).searchParams.get("tickers") ?? "").split(",").map((t) => t.trim()).filter(Boolean);
  if (tickers.length === 0) return NextResponse.json({ error: "Enter at least one ticker." }, { status: 400 });
  if (tickers.length > 25) return NextResponse.json({ error: "Ask for at most 25 tickers at a time." }, { status: 400 });
  const out = await getCompanies(tickers);
  // Every company failed, and not because its ticker is unknown: the sources are down (each failure is
  // logged under its own reference). Say so as a 503 rather than answer a page of errors as a success.
  const rows = Object.values(out);
  if (rows.length && rows.every((r) => "error" in r && r.error !== "Unknown ticker")) {
    return NextResponse.json({ error: "SEC EDGAR is not answering right now. Try again shortly." }, { status: 503 });
  }
  return NextResponse.json(out);
  });
}
