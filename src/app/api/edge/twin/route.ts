import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { requireEdge } from "@/lib/edge/access";
import { placeFrom } from "@/lib/edge/place";
import { digitalTwin } from "@/lib/edge/twin";
import { rateLimit } from "@/lib/locks";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * A site's digital twin (?asset=ID or ?detection=ID): the ground, tanks and stacks measured by lidar or
 * mapped in OpenStreetMap, pipelines as tubes, data centres and mines, and the plant's recent flaring.
 * Free (public data, kept a week per place and shared); the lidar point cloud is /api/edge/lidar.
 */
export async function GET(req: Request) {
  return guarded(async (user) => {
    await requireEdge(user.id);
    const place = await placeFrom(new URL(req.url).searchParams, user.id);
    await rateLimit(`edge-twin:${user.id}`, 60, 3_600_000, "Many digital twins this hour; try again in a few minutes.");
    const twin = await digitalTwin(place, user.id);
    return NextResponse.json(twin, { headers: { "cache-control": "private, max-age=600" } });
  });
}
