import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { CROSS_SITE, requestMeta, sameSiteJson } from "@/lib/copytrade/access";
import { propose } from "@/lib/copytrade/live";
import { rateLimit } from "@/lib/locks";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** POST — build the orders that would bring a live copy to its targets, for review. Sends nothing. Pro. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!sameSiteJson(req)) return NextResponse.json(CROSS_SITE, { status: 403 });
  return guarded(async (user) => {
    await rateLimit(`copy-propose:${user.id}`, 10, 60_000, "Too many proposals at once. Wait a moment and try again.");
    return NextResponse.json(await propose(user, Number((await ctx.params).id) || 0, requestMeta(req)));
  });
}
