import { NextResponse } from "next/server";
import { cronAuthorized, isAdmin } from "@/lib/auth/admin";
import { currentUser, unauthorized } from "@/lib/auth/user";
import { lease } from "@/lib/locks";
import { runSync, type SyncSource } from "@/lib/vc/sync";
import { handled, logError } from "@/lib/errors";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SOURCES: SyncSource[] = ["yc", "a16z", "hn", "formd", "thiel"];

/**
 * Refresh one source of the shared startup directory now. It rewrites what everyone sees and reads SEC
 * filings in bulk, so only the cron secret or an administrator (ADMIN_EMAILS) may run it, one run per
 * source at a time. The nightly cron (/api/cron/sync) keeps the directory fresh on its own.
 */
export async function POST(req: Request) {
  return handled(() => sync(req));
}

async function sync(req: Request) {
  if (!cronAuthorized(req)) {
    const user = await currentUser();
    if (!user) return unauthorized();
    if (!isAdmin(user)) return NextResponse.json({ error: "Only an administrator can refresh the startup directory. It refreshes on its own every night." }, { status: 403 });
  }
  const p = new URL(req.url).searchParams;
  const source = p.get("source") as SyncSource | null;
  const days = Math.min(Math.max(Number(p.get("days") ?? 2) || 0, 0), 60);
  if (!source || !SOURCES.includes(source)) return NextResponse.json({ error: `source must be one of ${SOURCES.join(", ")}` }, { status: 400 });
  const release = await lease(`vc-sync:${source}`, 330_000);
  if (!release) return NextResponse.json({ error: `A ${source} sync is already running.` }, { status: 409 });
  try { return NextResponse.json(await runSync(source, days)); }
  catch (e) { const ref = logError(e, { status: 502, where: `vc-sync:${source}` }); return NextResponse.json({ error: `The ${source} sync failed (ref ${ref}). Try again later.`, ref }, { status: 502 }); }
  finally { await release(); }
}
