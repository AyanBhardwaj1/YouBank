import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { requireEdge } from "@/lib/edge/access";
import { edgeFeed, type Scope } from "@/lib/edge/feed";
import { listWatches } from "@/lib/edge/watches";

export const dynamic = "force-dynamic";

/** The ranked Edge feed: ?scope=all|mine|team|trending&offset=0. */
export async function GET(req: Request) {
  return guarded(async (user) => {
    const p = await requireEdge(user.id);
    const q = new URL(req.url).searchParams;
    const scope = (["mine", "team", "trending"] as Scope[]).find((s) => s === q.get("scope")) ?? "all";
    const watches = await listWatches(user.id);
    const feed = await edgeFeed(user.id, watches, p.prefs.blend, { scope, offset: Number(q.get("offset")) || 0, limit: 20 });
    return NextResponse.json({ ...feed, generatedAt: new Date().toISOString() }, { headers: { "cache-control": "private, max-age=20" } });
  });
}
