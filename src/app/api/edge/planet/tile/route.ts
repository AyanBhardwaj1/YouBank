import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { requireFeature } from "@/lib/billing/entitlements";
import { requireEdge } from "@/lib/edge/access";
import { upgradeOn } from "@/lib/edge/premium";
import { planetTile, validScene, validTile } from "@/lib/edge/premium/planet";
import { rateLimit } from "@/lib/locks";

export const dynamic = "force-dynamic";

/**
 * One XYZ tile of a Planet scene (?type=&id=&z=&x=&y=), read with YouBank's key so it never reaches the
 * browser, for draping the scene over the 3D terrain. Needs the Planet in 3D feature and PLANET_API_KEY;
 * 404 { off: true } without the key. Tiles are only asked for after someone turns the drape on.
 */
export async function GET(req: Request) {
  return guarded(async (user) => {
    await requireEdge(user.id);
    if (!upgradeOn("planet")) return NextResponse.json({ off: true }, { status: 404 });
    await requireFeature(user, "maps.planet-drape");
    const q = new URL(req.url).searchParams;
    const type = q.get("type") ?? "", id = q.get("id") ?? "";
    const z = Number(q.get("z")), x = Number(q.get("x")), y = Number(q.get("y"));
    if (!validScene(type, id) || !validTile(z, x, y)) return NextResponse.json({ error: "Not a Planet tile." }, { status: 400 });
    await rateLimit(`edge-planet-tile:${user.id}`, 3000, 3_600_000, "Many Planet tiles this hour; try again in a few minutes.");
    const t = await planetTile(type, id, z, x, y);
    return new Response(t.body, { headers: { "content-type": t.contentType, "cache-control": "private, max-age=86400" } });
  });
}
