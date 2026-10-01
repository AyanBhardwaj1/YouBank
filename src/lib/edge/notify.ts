/**
 * Findings to the people who watch them. A big finding (a large, confident ground change; a deal that
 * screens high; a filing that rewrote its risk factors; a high-severity red flag) goes out straight
 * away through the person's alert channels; everything else waits for their daily digest. Each person
 * hears about a finding once. Findings also go onto the contacts who work at the companies in them.
 */
import { and, eq, inArray } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { logError } from "@/lib/errors";
import { alertLater, alertNow } from "./alerts";
import { noteFindingsForNetworks } from "./crm";
import { matches } from "./feed";
import type { Bbox } from "./sources/eia";
import { BETA_ON } from "./watches";

type Detection = typeof schema.edgeDetections.$inferSelect;

/** Whether a finding is big enough to interrupt someone. Pure. */
export function isBig(d: Pick<Detection, "kind" | "confidence" | "magnitude" | "visual">): boolean {
  switch (d.kind) {
    case "ground_change": return d.confidence >= 0.6 && d.magnitude >= 2;
    case "flaring": return d.confidence >= 0.75 && d.magnitude >= 0.6;
    // Radar: some 6,000 m² of new structure, seen clearly; permits: well over the usual pace on state records; methane: a tonne an hour at the plant.
    case "radar_change": return d.confidence >= 0.7 && d.magnitude >= 0.6;
    case "permits": return d.confidence >= 0.8 && d.magnitude >= 0.85;
    case "methane_plume": return d.confidence >= 0.8 && d.magnitude >= 0.5;
    case "deal_proforma": return d.magnitude >= 0.6;
    case "filing_change": return d.magnitude >= 0.5;
    case "graph_flag": return (d.visual as { flag?: { severity?: string } }).flag?.severity === "high";
    default: return false;
  }
}

/** Route new findings to the people whose watches they match; returns how many alerts and digest items went out. */
export async function notifyWatchers(detectionIds: number[]): Promise<{ now: number; later: number; contacts: number }> {
  const out = { now: 0, later: 0, contacts: 0 };
  if (!detectionIds.length) return out;
  const db = requireDb();
  const found = await db.select().from(schema.edgeDetections).where(inArray(schema.edgeDetections.id, [...new Set(detectionIds)].slice(0, 500)));
  if (!found.length) return out;
  const watches = await db.select({ userId: schema.edgeWatches.userId, kind: schema.edgeWatches.kind, label: schema.edgeWatches.label, target: schema.edgeWatches.target })
    .from(schema.edgeWatches).innerJoin(schema.profiles, eq(schema.profiles.userId, schema.edgeWatches.userId)).where(and(BETA_ON));
  for (const d of found) {
    const byUser = new Map<string, string>();
    for (const w of watches) {
      if (d.ownerId && d.ownerId !== w.userId) continue;
      const hit = matches({ tickers: d.tickers, bbox: (d.bbox as Bbox | null) ?? null }, [{ kind: w.kind as "company" | "place", label: w.label, target: w.target, mine: true }]);
      if (hit.length && !byUser.has(w.userId)) byUser.set(w.userId, `You watch ${w.label}`);
    }
    const big = isBig(d);
    for (const [userId, reason] of byUser) {
      try {
        if (big) { if (await alertNow(userId, { subject: `detection:${d.id}`, title: d.title, body: d.summary.slice(0, 400), url: `/app/edge?view=feed`, reasons: [reason], urgent: d.kind === "graph_flag" })) out.now++; }
        else if (await alertLater(userId, `detection:${d.id}`)) out.later++;
      } catch (e) { logError(e, { where: "edge-notify" }); }
    }
  }
  out.contacts = await noteFindingsForNetworks(found, isBig).catch((e) => { logError(e, { where: "edge-notify-crm" }); return 0; });
  return out;
}
