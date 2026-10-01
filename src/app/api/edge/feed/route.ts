import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { requireEdge } from "@/lib/edge/access";
import { edgeFeed, type Scope } from "@/lib/edge/feed";
import { listWatches } from "@/lib/edge/watches";

export const dynamic = "force-dynamic";

/** The ranked Edge feed: ?scope=all|mine|team|trending&offset=0, optionally one kind of finding (?kind=ground_change). */
export async function GET(req: Request) {
  return guarded(async (user) => {
    const [p, watches] = await Promise.all([requireEdge(user.id), listWatches(user.id)]);
    const q = new URL(req.url).searchParams;
    const scope = (["mine", "team", "trending"] as Scope[]).find((s) => s === q.get("scope")) ?? "all";
    const kind = /^[a-z_]{3,40}$/.test(q.get("kind") ?? "") ? q.get("kind")! : undefined;
    const feed = await edgeFeed(user.id, watches, p.prefs.blend, { scope, offset: Number(q.get("offset")) || 0, limit: 20, kind });
    return NextResponse.json({ ...feed, generatedAt: new Date().toISOString() }, { headers: { "cache-control": "private, max-age=20" } });
  });
}
