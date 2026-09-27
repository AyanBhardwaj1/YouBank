import { NextResponse } from "next/server";
import { secretsMatch } from "@/lib/crm/crypto";
import { nightlyUsers, runAgent } from "@/lib/crm/run";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Nightly agent pass, triggered by Vercel Cron with the CRON_SECRET bearer token.
 *
 * It prepares suggestions and drafts for the morning. It cannot send: sending lives behind the
 * Send button alone. Users are visited least-recently-run first until the time budget is spent.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !secretsMatch(req.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const deadline = Date.now() + 270_000;
  const results: { userId: string; drafted?: number; suggestions?: number; errors?: number; error?: string }[] = [];
  for (const userId of await nightlyUsers()) {
    if (Date.now() > deadline - 20_000) break;
    try {
      const r = await runAgent(userId, deadline - 10_000);
      results.push({ userId, drafted: r.nurture.drafted + r.campaigns.drafted, suggestions: r.signals + r.followUps + r.checkIns, errors: r.errors.length });
    } catch (e) {
      results.push({ userId, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return NextResponse.json({ ok: true, visited: results.length, results });
}
