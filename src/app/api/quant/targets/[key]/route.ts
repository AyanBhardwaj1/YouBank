import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { getTarget, targetOwner } from "@/lib/quant/targets";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** GET ?at=ISO — the TargetPortfolio version in force at `at` (default: the latest). Owner-scoped keys need the owner. */
export async function GET(req: Request, ctx: { params: Promise<{ key: string }> }) {
  return guarded(async (user) => {
    const key = decodeURIComponent((await ctx.params).key);
    const own = await targetOwner(key);
    if (!own.exists || (own.ownerId && own.ownerId !== user.id)) return NextResponse.json({ error: "No such target." }, { status: 404 });
    const at = new URL(req.url).searchParams.get("at") || undefined;
    if (at && !Number.isFinite(Date.parse(at))) return NextResponse.json({ error: "`at` must be an ISO time." }, { status: 400 });
    const target = await getTarget(key, { at });
    if (!target) return NextResponse.json({ error: "No version of this target was in force then." }, { status: 404 });
    return NextResponse.json({ target });
  });
}
