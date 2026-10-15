import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { CROSS_SITE, requestMeta, requireConsent, sameSiteJson } from "@/lib/algo/access";
import { agentHistory, agentTurn } from "@/lib/algo/agent";
import { canUse } from "@/lib/billing/entitlements";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** GET — the conversation so far (empty without the plan). */
export async function GET() {
  return guarded(async (user) => NextResponse.json({ messages: (await canUse(user, "algo.agent")) ? await agentHistory(user.id) : [] }));
}

/** POST { message } — one turn with the trading agent (Pro; its model calls count against the AI allowance). */
export async function POST(req: Request) {
  if (!sameSiteJson(req)) return NextResponse.json(CROSS_SITE, { status: 403 });
  return guarded(async (user) => {
    await requireConsent(user.id, "terms");
    const body = (await req.json().catch(() => ({}))) as { message?: unknown };
    return NextResponse.json(await agentTurn(user, String(body.message ?? ""), requestMeta(req)));
  });
}
