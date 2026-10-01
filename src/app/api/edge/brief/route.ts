import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { requireEdge } from "@/lib/edge/access";
import { edgeBrief } from "@/lib/edge/brief";
import { listWatches } from "@/lib/edge/watches";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** The week across the person's watches, in a few cited lines (null when there is too little new). */
export async function GET() {
  return guarded(async (user) => {
    const p = await requireEdge(user.id);
    const brief = await edgeBrief(user.id, await listWatches(user.id), p.prefs.blend).catch(() => null);
    return NextResponse.json({ brief }, { headers: { "cache-control": "private, max-age=600" } });
  });
}
