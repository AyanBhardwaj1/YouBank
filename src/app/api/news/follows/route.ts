import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { canUse } from "@/lib/billing/entitlements";
import { followsOf, FREE_FOLLOWS } from "@/lib/news/follow";

export const dynamic = "force-dynamic";

/** The stories this person follows, most recently moved first, and how many more they may follow. */
export async function GET() {
  return guarded(async (user) => {
    const [rows, unlimited] = await Promise.all([followsOf(user.id), canUse(user, "news.follows")]);
    return NextResponse.json({
      follows: rows.map((r) => ({ clusterId: r.clusterId, headline: r.headline, updatedAt: r.updatedAt.toISOString(), sourceCount: r.sourceCount, updates: r.updates, since: r.createdAt.toISOString() })),
      limit: unlimited ? null : FREE_FOLLOWS,
    }, { headers: { "Cache-Control": "private, no-store" } });
  });
}
