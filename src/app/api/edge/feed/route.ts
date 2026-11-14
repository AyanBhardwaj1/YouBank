import { after, NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { requireEdge } from "@/lib/edge/access";
import { edgeFeed, type Scope } from "@/lib/edge/feed";
import { flareFreshness, refreshIfStale } from "@/lib/edge/passes";
import { listWatches } from "@/lib/edge/watches";

export const dynamic = "force-dynamic";
// A stale flare pass runs after the response, inside this budget.
export const maxDuration = 60;

/**
 * The ranked Edge feed: ?scope=all|mine|team|trending&offset=0, optionally one kind of finding (?kind=ground_change).
 * With it, how fresh flaring is; and when the last flare pass is over an hour old, another runs after the
 * response, so an open feed (polled every two minutes) keeps flaring within the hour without a cron.
 */
export async function GET(req: Request) {
  return guarded(async (user) => {
    const [p, watches] = await Promise.all([requireEdge(user.id), listWatches(user.id)]);
    const q = new URL(req.url).searchParams;
    const scope = (["mine", "team", "trending"] as Scope[]).find((s) => s === q.get("scope")) ?? "all";
    const kind = /^[a-z_]{3,40}$/.test(q.get("kind") ?? "") ? q.get("kind")! : undefined;
    const [feed, flares] = await Promise.all([
      edgeFeed(user.id, watches, p.prefs.blend, { scope, offset: Number(q.get("offset")) || 0, limit: 20, kind }),
      flareFreshness().catch(() => null),
    ]);
    after(() => refreshIfStale(45_000));
    return NextResponse.json({ ...feed, flares, generatedAt: new Date().toISOString() }, { headers: { "cache-control": "private, max-age=20" } });
  });
}
