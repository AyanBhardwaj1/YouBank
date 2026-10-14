import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { requireFeature } from "@/lib/billing/entitlements";
import { premiumScope } from "@/lib/billing/use";
import { requireEdge } from "@/lib/edge/access";
import { readCall } from "@/lib/edge/calls/store";
import { requireReady } from "@/lib/edge/premium";
import { rateLimit } from "@/lib/locks";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const TICKER = /^[A-Z][A-Z0-9.\-]{0,9}$/;

/**
 * Read a call with Call Desk (E5): POST { ticker?, eva? }. Pairs each analyst question with management's
 * answer, scores evasion with calibrated probabilities (free, in-process), states the call's rate against the
 * company's last calls, and logs every quantified promise to the forecast ledger. `eva: true` adds the
 * Eva-4B ensemble (premium edge.calls-eva; off unless EDGE_CALLS_EVA=1), run only because the person asked.
 */
export async function POST(req: Request, ctx: { params: Promise<{ docId: string }> }) {
  return guarded(async (user) => {
    await requireEdge(user.id);
    const docId = Number((await ctx.params).docId);
    if (!Number.isInteger(docId) || docId <= 0) return NextResponse.json({ error: "Name a document." }, { status: 400 });
    const body = (await req.json().catch(() => ({}))) as { ticker?: string; eva?: boolean };
    const ticker = typeof body.ticker === "string" ? body.ticker.trim().toUpperCase() : "";
    if (ticker && !TICKER.test(ticker)) return NextResponse.json({ error: "That is not a ticker." }, { status: 400 });
    await rateLimit(`edge-calls-read:${user.id}`, 30, 3_600_000, "Thirty calls read this hour. Try again later.");
    if (body.eva === true) {
      await requireFeature(user, "edge.calls-eva");
      requireReady("edge.calls-eva");
      const view = await premiumScope(user, { require: ["edge.calls-eva"] }, () => readCall(user.id, docId, { ticker, eva: true }));
      return NextResponse.json(view);
    }
    return NextResponse.json(await readCall(user.id, docId, { ticker }));
  });
}
