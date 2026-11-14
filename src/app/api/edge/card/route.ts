import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { requireEdge } from "@/lib/edge/access";
import { cardById } from "@/lib/edge/feed";
import { listWatches } from "@/lib/edge/watches";

export const dynamic = "force-dynamic";

/** One finding as a card (?id=), when it is public or the person's own: the globe opens markers outside the feed with it. */
export async function GET(req: Request) {
  return guarded(async (user) => {
    const [p, watches] = await Promise.all([requireEdge(user.id), listWatches(user.id)]);
    const id = Number(new URL(req.url).searchParams.get("id"));
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Pick a finding on the map first." }, { status: 400 });
    const card = await cardById(user.id, id, watches, p.prefs.blend);
    if (!card) return NextResponse.json({ error: "That finding is no longer available." }, { status: 404 });
    return NextResponse.json({ card }, { headers: { "cache-control": "private, max-age=30" } });
  });
}
