import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { requireEdge } from "@/lib/edge/access";
import { upgradeOn } from "@/lib/edge/premium";
import { planetThumb, validScene } from "@/lib/edge/premium/planet";
import { rateLimit } from "@/lib/locks";

export const dynamic = "force-dynamic";

/** A Planet scene's thumbnail (?type=PSScene|SkySatCollect&id=), read with YouBank's key so it never reaches the browser. 404 { off: true } until PLANET_API_KEY is set. */
export async function GET(req: Request) {
  return guarded(async (user) => {
    await requireEdge(user.id);
    if (!upgradeOn("planet")) return NextResponse.json({ off: true }, { status: 404 });
    const q = new URL(req.url).searchParams;
    const type = q.get("type") ?? "", id = q.get("id") ?? "";
    if (!validScene(type, id)) return NextResponse.json({ error: "Not a Planet scene." }, { status: 400 });
    await rateLimit(`edge-planet-thumb:${user.id}`, 600, 3_600_000, "Many Planet thumbnails this hour; try again in a few minutes.");
    const t = await planetThumb(type, id);
    return new Response(t.body, { headers: { "content-type": t.contentType, "cache-control": "private, max-age=86400" } });
  });
}
