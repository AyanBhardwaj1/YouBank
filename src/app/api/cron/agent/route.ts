import { NextResponse } from "next/server";
import { secretsMatch } from "@/lib/crm/crypto";
import { nightlyUsers, runAgent } from "@/lib/crm/run";
import { runAsUser } from "@/lib/ai/usage";
import { describeFailure } from "@/lib/errors";
import { pool, poolSize } from "@/lib/pool";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Nightly agent pass, triggered by Vercel Cron with the CRON_SECRET bearer token.
 *
 * It prepares suggestions and drafts for the morning. It cannot send: sending lives behind the
 * Send button alone. Users are visited least-recently-run first, a few at a time (AGENT_POOL, 4 by
 * default), until the time budget is spent.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !secretsMatch(req.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const deadline = Date.now() + 270_000;
  const results = await pool(await nightlyUsers(), poolSize(process.env.AGENT_POOL, 4), async (userId): Promise<{ userId: string; drafted?: number; suggestions?: number; errors?: number; error?: string }> => {
    try {
      const r = await runAsUser(userId, () => runAgent(userId, deadline - 10_000));
      return { userId, drafted: r.nurture.drafted + r.campaigns.drafted, suggestions: r.signals + r.followUps + r.checkIns, errors: r.errors.length };
    } catch (e) {
      return { userId, error: describeFailure(e, 500, "nightly-agent").message };
    }
  }, deadline - 20_000);
  return NextResponse.json({ ok: true, visited: results.length, results });
}
