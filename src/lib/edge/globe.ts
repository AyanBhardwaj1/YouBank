/**
 * The globe's markers: every public finding of the last month that sits somewhere on the Earth (flares,
 * radar and ground changes, the satellite analyses, nuclear units, deal pictures and deal-watch cards),
 * not only the ones in a person's feed, each with its tickers, what was seen, why it may move the stock
 * and how sure Edge is. Clicking one opens the full card. The pure parts are tested in
 * scripts/test-edge-globe.ts.
 */
import { sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { memo } from "@/lib/memo";
import { GROUP_OF, markerOf, type Row } from "./globe-core";

export * from "./globe-core";

/** Every public finding of the last month with a place, newest first, at most 600. Shared for two minutes. */
export const globeMarkers = () => memo("edge:globe:markers:v1", 120_000, async () => {
  const rows = await requireDb().select({
    id: schema.edgeDetections.id, kind: schema.edgeDetections.kind, title: schema.edgeDetections.title, tickers: schema.edgeDetections.tickers, bbox: schema.edgeDetections.bbox,
    // Only the parts a marker needs: a visual can hold a large overlay image.
    visual: sql<Record<string, unknown>>`jsonb_build_object('site', ${schema.edgeDetections.visual}->'site', 'thesis', ${schema.edgeDetections.visual}->'thesis', 'effects', ${schema.edgeDetections.visual}->'effects', 'merchant', ${schema.edgeDetections.visual}->'merchant', 'updatedAt', ${schema.edgeDetections.visual}->'updatedAt')`,
    confidence: schema.edgeDetections.confidence, observedAt: schema.edgeDetections.observedAt, detectedAt: schema.edgeDetections.detectedAt,
  }).from(schema.edgeDetections)
    .where(sql`${schema.edgeDetections.ownerId} is null and ${schema.edgeDetections.detectedAt} > now() - interval '30 days' and ${schema.edgeDetections.kind} in (${sql.join(Object.keys(GROUP_OF).map((k) => sql`${k}`), sql`, `)})`)
    .orderBy(sql`${schema.edgeDetections.detectedAt} desc`).limit(600);
  const now = Date.now();
  return rows.flatMap((r) => { const m = markerOf(r as Row, now); return m ? [m] : []; });
});
