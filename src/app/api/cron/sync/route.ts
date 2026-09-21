import { NextResponse } from "next/server";
import { runSync } from "@/lib/vc/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Nightly refresh, triggered by Vercel Cron with the CRON_SECRET bearer token. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const results = [];
  for (const [source, days] of [["hn", 3], ["formd", 3], ["yc", 0], ["a16z", 0], ["thiel", 0]] as const) {
    try { results.push(await runSync(source, days)); } catch (e) { results.push({ source, error: e instanceof Error ? e.message : String(e) }); }
  }
  return NextResponse.json({ ok: true, results });
}
