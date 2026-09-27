import { NextResponse } from "next/server";
import { autopilotUsers, tick } from "@/lib/crm/autopilot";
import { secretsMatch } from "@/lib/crm/crypto";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * The autopilot heartbeat, every few minutes.
 *
 * Vercel's Hobby plan only runs cron once a day, so a Neon Function on a five-minute schedule calls
 * this with AUTOPILOT_SECRET (CRON_SECRET is accepted too). Each person with a connected mailbox gets
 * one pass: read new mail, answer what their settings allow, draft due steps, send what is due. A
 * per-person lock means an overlapping call does nothing.
 */
async function handle(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const ok = [process.env.AUTOPILOT_SECRET, process.env.CRON_SECRET].some((s) => s && secretsMatch(auth, `Bearer ${s}`));
  if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const started = Date.now();
  const deadline = started + 270_000;
  const origin = new URL(req.url).origin;
  const results: Record<string, unknown>[] = [];
  for (const userId of await autopilotUsers()) {
    if (Date.now() > deadline - 30_000) break;
    const r = await tick(userId, origin, Math.min(deadline, Date.now() + 120_000)).catch((e) => ({ error: e instanceof Error ? e.message : String(e) }));
    results.push({
      user: userId.slice(0, 8),
      ...("error" in r ? r : {
        locked: r.locked, synced: r.synced.reduce((n, s) => n + s.triaged, 0), replies: r.replies,
        followUps: r.followUps, campaigns: r.campaigns, sent: r.queue?.sent ?? 0, held: r.queue?.held ?? 0, errors: r.errors.length,
      }),
    });
  }
  return NextResponse.json({ ok: true, ms: Date.now() - started, visited: results.length, results });
}

export const GET = handle;
export const POST = handle;
