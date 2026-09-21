import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { searchFormD } from "@/lib/vc/formd";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: Request) {
  return guarded(async () => {
    const q = new URL(req.url).searchParams.get("q") ?? "";
    if (!q.trim()) return NextResponse.json({ error: "q required" }, { status: 400 });
    try { return NextResponse.json(await searchFormD(q, 8)); }
    catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 }); }
  });
}
