import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { requireEdge } from "@/lib/edge/access";
import { addEvidence } from "@/lib/edge/agent/store";

export const dynamic = "force-dynamic";

/** A person adds evidence to a thesis (E7): POST { claim, direction, strength, statement, quote, source, url? }; applied by the ladder at once and logged as theirs. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guarded(async (user) => {
    await requireEdge(user.id);
    const id = Number((await ctx.params).id);
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const direction = b.direction === "against" ? "against" as const : "for" as const;
    const strength = (["weak", "moderate", "strong"] as const).find((s) => s === b.strength) ?? "weak";
    const statement = typeof b.statement === "string" ? b.statement.trim() : "", quote = typeof b.quote === "string" ? b.quote.trim() : "", source = typeof b.source === "string" ? b.source.trim() : "";
    if (!Number.isInteger(id) || !Number.isInteger(Number(b.claim)) || !statement || !source) return NextResponse.json({ error: "Say which claim, what the evidence shows and where it comes from." }, { status: 400 });
    const url = typeof b.url === "string" && /^https?:\/\//.test(b.url) ? b.url.slice(0, 500) : undefined;
    return NextResponse.json({ ok: true, state: await addEvidence(user.id, id, { claim: Number(b.claim), direction, strength, statement, quote: quote || statement, source, ...(url ? { url } : {}) }) });
  });
}
