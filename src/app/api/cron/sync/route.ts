import { NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/auth/admin";
import { runSync } from "@/lib/vc/sync";
import { failureMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Nightly refresh, triggered by Vercel Cron with the CRON_SECRET bearer token. */
export async function GET(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const results = [];
  for (const [source, days] of [["hn", 3], ["formd", 3], ["yc", 0], ["a16z", 0], ["thiel", 0]] as const) {
    try { results.push(await runSync(source, days)); } catch (e) { results.push({ source, error: failureMessage(e, `cron-sync:${source}`) }); }
  }
  return NextResponse.json({ ok: true, results });
}
