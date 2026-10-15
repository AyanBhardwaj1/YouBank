import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { targetHistory, targetOwner } from "@/lib/quant/targets";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** GET — every version of a target, newest first. Owner-scoped keys need the owner. */
export async function GET(_req: Request, ctx: { params: Promise<{ key: string }> }) {
  return guarded(async (user) => {
    const key = decodeURIComponent((await ctx.params).key);
    const own = await targetOwner(key);
    if (!own.exists || (own.ownerId && own.ownerId !== user.id)) return NextResponse.json({ error: "No such target." }, { status: 404 });
    return NextResponse.json({ key, versions: await targetHistory(key) });
  });
}
