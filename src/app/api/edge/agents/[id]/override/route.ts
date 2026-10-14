import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { requireEdge } from "@/lib/edge/access";
import { overrideClaim } from "@/lib/edge/agent/store";

export const dynamic = "force-dynamic";

/** The owner overrides a claim's probability (E7): POST { claim, p (0-1, or null to clear), note }; shown as a person override and logged. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guarded(async (user) => {
    await requireEdge(user.id);
    const id = Number((await ctx.params).id);
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const p = b.p === null ? null : Number(b.p);
    if (!Number.isInteger(id) || !Number.isInteger(Number(b.claim)) || (p !== null && !(p > 0 && p < 1))) return NextResponse.json({ error: "Give the claim and a probability between 0 and 1." }, { status: 400 });
    return NextResponse.json({ ok: true, state: await overrideClaim(user.id, id, { claim: Number(b.claim), p, note: typeof b.note === "string" ? b.note : "" }) });
  });
}
