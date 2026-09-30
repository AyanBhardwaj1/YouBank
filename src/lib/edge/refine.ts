/**
 * A second opinion on a ground change from two foundation models on the ML service: NASA and IBM's
 * Prithvi (a geospatial model trained on Landsat and Sentinel-2) says whether each changed area's
 * embedding moved more than the rest of the scene, and Meta's Segment Anything outlines the object at
 * that spot in both images, so a new pad or pond shows up as a new outline. Agreement raises a finding's
 * confidence, disagreement lowers it, and the outlines are drawn on the card.
 */
import { eq } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { lease } from "@/lib/locks";
import type { Blob } from "./change";
import { MlUnavailable, mlStart, type MlDone } from "./infra/ml";
import { record } from "./provenance";

export type RefineInput = { bbox: number[]; size: number; before: { scene: string; url: string }; after: { scene: string; url: string }; blobs: { kind: 1 | 2; x: number; y: number; bbox: number[]; pixels: number }[] };

type Visual = { bbox?: number[]; size?: number; before?: { url: string; scene: string }; after?: { url: string; scene: string }; blobs?: Blob[]; refine?: Refinement };

export type BlobVerdict = { z: number | null; iou: number | null; areaPx: number | null; score: number; polygon: [number, number][] };
export type Refinement = { at: string; models: string[]; blobs: BlobVerdict[]; agreement: number; verdict: "confirmed" | "doubtful" | "mixed"; confidenceBefore: number };

/** What to send for a finding, or null when it has nothing the models can look at. */
export function refineInput(visual: Visual): RefineInput | null {
  if (!visual.bbox || !visual.before?.scene || !visual.after?.scene || !visual.blobs?.length) return null;
  return {
    bbox: visual.bbox, size: visual.size ?? 256,
    before: { scene: visual.before.scene, url: visual.before.url }, after: { scene: visual.after.scene, url: visual.after.url },
    blobs: visual.blobs.slice(0, 6).map((b) => ({ kind: b.kind, x: b.x, y: b.y, bbox: b.bbox, pixels: b.pixels })),
  };
}

const sigmoid = (v: number) => 1 / (1 + Math.exp(-v));

/**
 * Turn the models' answers into a verdict per changed area and overall. A changed area scores high when
 * its Prithvi embedding moved well beyond the scene's typical patch (z above 1) and Segment Anything's
 * outline there differs between the two dates (low overlap). Pure, for tests.
 */
export function judge(result: Record<string, unknown>, blobs: { pixels: number }[], confidence: number): { refinement: Omit<Refinement, "at">; confidence: number } {
  const prithvi = ((result.prithvi as { blobs?: { z?: number }[] } | undefined)?.blobs ?? []);
  const sam = ((result.sam as { blobs?: { iou?: number; areaPx?: number; polygon?: [number, number][] }[] } | undefined)?.blobs ?? []);
  const verdicts: BlobVerdict[] = blobs.map((_, i) => {
    const z = typeof prithvi[i]?.z === "number" && Number.isFinite(prithvi[i]!.z) ? prithvi[i]!.z! : null;
    const iou = typeof sam[i]?.iou === "number" && Number.isFinite(sam[i]!.iou) ? Math.max(0, Math.min(1, sam[i]!.iou!)) : null;
    const parts = [z === null ? null : sigmoid((z - 1) * 1.6), iou === null ? null : 1 - iou].filter((v): v is number => v !== null);
    return { z, iou, areaPx: sam[i]?.areaPx ?? null, score: parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : 0.5, polygon: (sam[i]?.polygon ?? []).slice(0, 40) };
  });
  const weight = blobs.reduce((s, b) => s + b.pixels, 0) || 1;
  const agreement = Math.round(verdicts.reduce((s, v, i) => s + v.score * blobs[i].pixels, 0) / weight * 100) / 100;
  const verdict = agreement >= 0.62 ? "confirmed" : agreement <= 0.38 ? "doubtful" : "mixed";
  const next = verdict === "confirmed" ? Math.min(0.95, confidence + 0.12) : verdict === "doubtful" ? Math.max(0.05, confidence * 0.6) : confidence;
  const models = [(result.prithvi as { model?: string } | undefined)?.model, (result.sam as { model?: string } | undefined)?.model].filter((m): m is string => !!m);
  return { refinement: { models, blobs: verdicts, agreement, verdict, confidenceBefore: confidence }, confidence: Math.round(next * 100) / 100 };
}

/** Start the check of a finding unless it was checked or is being checked (a lease stops doubles). */
export async function startRefine(id: number): Promise<{ id: number; callId: string } | null> {
  const [d] = await requireDb().select({ visual: schema.edgeDetections.visual }).from(schema.edgeDetections).where(eq(schema.edgeDetections.id, id));
  if (!d || (d.visual as { refine?: unknown }).refine) return null;
  const input = refineInput(d.visual as Visual);
  if (!input || !(await lease(`edge:refine:${id}`, 30 * 60_000))) return null;
  try {
    return { id, callId: await mlStart("geo.refine", input, `detection:${id}`) };
  } catch (e) {
    if (e instanceof MlUnavailable) return null;
    throw e;
  }
}

/** Save the models' verdict on a finding: new confidence, outlines on the visual, a line in "why", and the audit trail. */
export async function applyRefinement(detectionId: number, done: MlDone): Promise<{ verdict: string; confidence: number } | null> {
  const db = requireDb();
  const [d] = await db.select().from(schema.edgeDetections).where(eq(schema.edgeDetections.id, detectionId));
  if (!d || !done.ok || !done.result) return null;
  const visual = d.visual as Visual & Record<string, unknown>;
  const blobs = (visual.blobs ?? []).slice(0, 6);
  if (!blobs.length) return null;
  const base = visual.refine?.confidenceBefore ?? d.confidence;
  const { refinement, confidence } = judge(done.result, blobs, base);
  const line = refinement.verdict === "confirmed" ? "Two foundation models agree: Prithvi sees the changed areas' signature move well beyond the rest of the scene, and Segment Anything outlines a new object there."
    : refinement.verdict === "doubtful" ? "Two foundation models doubt it: Prithvi sees little change beyond the scene's usual variation, and Segment Anything outlines much the same object on both dates, so confidence is lowered."
    : "The foundation models are split, so confidence is unchanged.";
  const why = d.why.replace(/ (Two foundation models|The foundation models)[^]*$/, "");
  await db.update(schema.edgeDetections).set({ confidence, visual: { ...visual, refine: { ...refinement, at: new Date().toISOString() } }, why: `${why} ${line}`.slice(0, 2000) }).where(eq(schema.edgeDetections.id, detectionId));
  await record(`detection:${detectionId}`, [{
    sourceName: "YouBank ML service on Modal", sourceUrl: "", license: "Prithvi-EO-1.0-100M (Apache-2.0), Segment Anything ViT-B (Apache-2.0)",
    method: `foundation-model check: Prithvi embedding distance and Segment Anything outlines per changed area (agreement ${refinement.agreement})`, modelVersion: refinement.models.join(" + "), retrievedAt: new Date(),
  }]);
  return { verdict: refinement.verdict, confidence };
}
