import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { runSync, type SyncSource } from "@/lib/vc/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SOURCES: SyncSource[] = ["yc", "a16z", "hn", "formd", "thiel"];

export async function POST(req: Request) {
  return guarded(async () => {
    const p = new URL(req.url).searchParams;
    const source = p.get("source") as SyncSource | null;
    const days = Math.min(Number(p.get("days") ?? 2), 60);
    if (!source || !SOURCES.includes(source)) return NextResponse.json({ error: `source must be one of ${SOURCES.join(", ")}` }, { status: 400 });
    try { return NextResponse.json(await runSync(source, days)); }
    catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 }); }
  });
}
