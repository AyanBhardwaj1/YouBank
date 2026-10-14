import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth/admin";
import { guarded } from "@/lib/auth/user";
import { requireEdge } from "@/lib/edge/access";
import { readDeal } from "@/lib/edge/deals/extract";
import { dealById } from "@/lib/edge/deals/store";
import { rateLimit } from "@/lib/locks";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Read a deal's documents now (E1, free): for a deal the database has found but not yet read (or, for an
 * administrator, again). The small model reads each section (about half a cent a deal), counted in the
 * person's own AI allowance; every term is quoted and checked before it is stored, for everyone.
 */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guarded(async (user) => {
    await requireEdge(user.id);
    await rateLimit(`edge-deals-read:${user.id}`, 10, 3_600_000, "Ten deals read this hour; thank you. Try again later.");
    const id = Number((await ctx.params).id);
    const d = Number.isInteger(id) && id > 0 ? await dealById(id) : null;
    if (!d) return NextResponse.json({ error: "That deal is not in the database." }, { status: 404 });
    // The readings are shared by everyone, so reading a deal again is for administrators (or the premium re-read).
    if (d.deal.extractedAt && !isAdmin(user)) return NextResponse.json({ error: "This deal has already been read. Re-reading it with the stronger model is part of a paid plan." }, { status: 409 });
    const r = await readDeal(id, { deadline: Date.now() + 270_000 });
    if (r.error) return NextResponse.json({ error: r.error, result: r }, { status: 429 });
    return NextResponse.json({ ok: true, result: r });
  });
}
