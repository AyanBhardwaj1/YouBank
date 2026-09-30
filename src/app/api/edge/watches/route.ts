import { after, NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { requireEdge } from "@/lib/edge/access";
import { addWatch, checkWatch, listWatches, type WatchInput } from "@/lib/edge/watches";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  return guarded(async (user) => {
    await requireEdge(user.id);
    return NextResponse.json({ watches: await listWatches(user.id) });
  });
}

/** Watch a company or a place; its sites are looked at right after the response. */
export async function POST(req: Request) {
  return guarded(async (user) => {
    await requireEdge(user.id);
    const body = (await req.json().catch(() => null)) as WatchInput | null;
    if (!body) return NextResponse.json({ error: "bad request" }, { status: 400 });
    const watch = await addWatch(user.id, body);
    const deadline = Date.now() + 50_000;
    after(() => checkWatch(watch, deadline, 3));
    return NextResponse.json({ watch });
  });
}
