import { NextResponse } from "next/server";
import { autopilotUsers, tick } from "@/lib/crm/autopilot";
import { secretsMatch } from "@/lib/crm/crypto";
import { runAsUser } from "@/lib/ai/usage";
import { describeFailure, handled } from "@/lib/errors";
import { pool, poolSize } from "@/lib/pool";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * The autopilot heartbeat, every few minutes.
 *
 * Vercel's Hobby plan only runs cron once a day, so a Neon Function on a five-minute schedule calls
 * this with AUTOPILOT_SECRET (CRON_SECRET is accepted too). Each person with a connected mailbox gets
 * one pass: read new mail, answer what their settings allow, draft due steps, send what is due. A
 * per-person lock means an overlapping call does nothing. People are worked a few at a time
 * (AUTOPILOT_POOL, 6 by default), so a few busy mailboxes do not hold everyone else back.
 */
async function handle(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const ok = [process.env.AUTOPILOT_SECRET, process.env.CRON_SECRET].some((s) => s && secretsMatch(auth, `Bearer ${s}`));
  if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  return handled(() => beat(new URL(req.url).origin));
}

async function beat(origin: string) {
  const started = Date.now();
  const deadline = started + 270_000;
  const results = await pool(await autopilotUsers(), poolSize(process.env.AUTOPILOT_POOL, 6), async (userId): Promise<Record<string, unknown>> => {
    const r = await runAsUser(userId, () => tick(userId, origin, Math.min(deadline, Date.now() + 120_000))).catch((e) => ({ error: describeFailure(e, 500, "autopilot").message }));
    return {
      user: userId.slice(0, 8),
      ...("error" in r ? r : {
        locked: r.locked, synced: r.synced.reduce((n, s) => n + s.triaged, 0), replies: r.replies,
        followUps: r.followUps, campaigns: r.campaigns, sent: r.queue?.sent ?? 0, held: r.queue?.held ?? 0, errors: r.errors.length,
      }),
    };
  }, deadline - 30_000);
  return NextResponse.json({ ok: true, ms: Date.now() - started, visited: results.length, results });
}

export const GET = handle;
export const POST = handle;
