import { NextResponse } from "next/server";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { guarded } from "@/lib/auth/user";
import { requireFeature } from "@/lib/billing/entitlements";
import { requireEdge } from "@/lib/edge/access";
import { MlUnavailable } from "@/lib/edge/infra/ml";
import { placeFrom } from "@/lib/edge/place";
import { changeCube, footprintImage, heatFromOverlay, landUse, pollJob, startJob } from "@/lib/edge/scene";
import type { Bbox } from "@/lib/edge/sources/eia";
import { boxAround } from "@/lib/edge/sources/sentinel";
import { digitalTwin } from "@/lib/edge/twin";
import { rateLimit } from "@/lib/locks";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Which plan feature each analysis needs; "heat" (a finding's own change, in 3D) is free. */
const FEATURE = { landuse: "maps.scene", cube: "maps.scene", "ai-change": "maps.ai-change", footprints: "maps.footprints" } as const;
type Kind = keyof typeof FEATURE;

/**
 * GET ?detection=ID&kind=heat: a ground-change finding's change as 3D cells (free).
 * GET ?job=ID: an ML analysis's result once it has finished ({ pending: true } until then).
 */
export async function GET(req: Request) {
  return guarded(async (user) => {
    await requireEdge(user.id);
    const q = new URL(req.url).searchParams;
    const job = q.get("job");
    if (job) {
      if (!/^[0-9a-f-]{36}$/.test(job)) return NextResponse.json({ error: "Not an analysis." }, { status: 400 });
      const result = await pollJob(job, user.id).catch((e) => { if (e instanceof MlUnavailable) throw Object.assign(new Error(e.message), { status: 503 }); throw e; });
      return NextResponse.json(result ? { result } : { pending: true });
    }
    const id = Number(q.get("detection"));
    if (q.get("kind") !== "heat" || !Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Pick a ground change." }, { status: 400 });
    const [d] = await requireDb().select({ overlay: sql<string | null>`${schema.edgeDetections.visual}->>'overlay'`, box: sql<Bbox | null>`${schema.edgeDetections.visual}->'bbox'` }).from(schema.edgeDetections)
      .where(and(eq(schema.edgeDetections.id, id), or(isNull(schema.edgeDetections.ownerId), eq(schema.edgeDetections.ownerId, user.id))));
    if (!d?.overlay?.startsWith("data:image/png;base64,") || !d.box) return NextResponse.json({ error: "That finding has no change mask to draw." }, { status: 404 });
    return NextResponse.json({ result: heatFromOverlay(d.overlay, d.box) }, { headers: { "cache-control": "private, max-age=86400" } });
  });
}

/**
 * POST { kind: "landuse" | "cube" | "ai-change" | "footprints", asset?: ID, detection?: ID }: start an
 * analysis of the place, after checking the plan. Land use and the change stack answer at once; the ML
 * ones answer { job } to poll with GET (or { result } when the same place was analysed this month).
 */
export async function POST(req: Request) {
  return guarded(async (user) => {
    await requireEdge(user.id);
    const body = (await req.json().catch(() => ({}))) as { kind?: string; asset?: number; detection?: number };
    const kind = body.kind as Kind;
    if (!(kind in FEATURE)) return NextResponse.json({ error: "Pick an analysis." }, { status: 400 });
    await requireFeature(user, FEATURE[kind]);
    const place = await placeFrom(body as Record<string, unknown>, user.id);
    const bbox: Bbox = place.bbox ?? boxAround(place.lon, place.lat, 2.5);
    if (kind === "landuse" || kind === "cube") {
      await rateLimit(`edge-scene:${user.id}`, 40, 3_600_000, "Many scene analyses this hour; try again in a few minutes.");
      return NextResponse.json({ result: kind === "landuse" ? await landUse(bbox) : await changeCube(bbox) });
    }
    await rateLimit(`edge-scene-ml:${user.id}`, 12, 3_600_000, "Many AI analyses this hour; try again later.");
    try {
      if (kind === "ai-change") return NextResponse.json(await startJob("ai-change", bbox, user.id));
      // Footprints are traced on the twin's aerial photograph (its 1.6 km box) where there is one.
      const twin = await digitalTwin(place, user.id);
      const image = await footprintImage(twin.site?.photo ? twin.bbox : bbox, twin.site?.photo?.url ?? null);
      return NextResponse.json(await startJob("footprints", twin.site?.photo ? twin.bbox : bbox, user.id, image));
    } catch (e) {
      if (e instanceof MlUnavailable) return NextResponse.json({ error: `The AI analyses are not available right now: ${e.message}` }, { status: 503 });
      throw e;
    }
  });
}
