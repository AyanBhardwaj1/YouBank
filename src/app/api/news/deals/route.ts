import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { dealsView } from "@/lib/news/views";

export const dynamic = "force-dynamic";

/** The deal tracker: ?days= &kind=acquisition,ipo &sector=energy, with advisor league tables for the year. */
export async function GET(req: Request) {
  return guarded(async () => {
    const p = new URL(req.url).searchParams;
    const list = (k: string) => p.get(k)?.split(",").map((s) => s.trim()).filter(Boolean);
    return NextResponse.json(await dealsView({ days: Math.min(365, Number(p.get("days")) || 30), kinds: list("kind"), sectors: list("sector") }));
  });
}
