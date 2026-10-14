import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { requireDb } from "@/db";
import { guarded } from "@/lib/auth/user";
import { requireEdge } from "@/lib/edge/access";
import { record } from "@/lib/edge/provenance";
import { rateLimit } from "@/lib/locks";

export const dynamic = "force-dynamic";

const REASONS = new Set(["wrong-number", "wrong-period", "wrong-company", "not-in-source", "misleading", "other"]);

/**
 * "This claim is wrong" on one of your answers: { claim (its index), held (true for a held-back claim),
 * reason, note }. Kept on the answer and in its audit trail; reports are reviewed before any joins the
 * calibration set (GET /api/edge/claims/reports, administrators), never added automatically.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guarded(async (user) => {
    await requireEdge(user.id);
    await rateLimit(`edge-claim-report:${user.id}`, 60, 3_600_000, "Many reports this hour; thank you. Try again later.");
    const id = Number((await ctx.params).id);
    const body = (await req.json().catch(() => ({}))) as { claim?: number; held?: boolean; reason?: string; note?: string };
    const reason = REASONS.has(String(body.reason)) ? String(body.reason) : "other";
    const report = { claim: Math.max(0, Math.floor(Number(body.claim) || 0)), held: body.held === true, reason, note: String(body.note ?? "").slice(0, 500), at: new Date().toISOString(), status: "new" };
    const res = await requireDb().execute(sql`update edge_answers set answer = jsonb_set(answer, '{reports}', coalesce(answer->'reports', '[]'::jsonb) || ${JSON.stringify([report])}::jsonb) where id = ${id} and owner_id = ${user.id} returning id`);
    if (!res.rows.length) return NextResponse.json({ error: "That answer is not yours or does not exist." }, { status: 404 });
    await record(`answer:${id}`, [{ sourceName: `Claim ${report.claim + 1} reported: ${reason}`, sourceUrl: "", license: "", method: report.note || "reported by the person who asked", modelVersion: "", retrievedAt: new Date() }]);
    return NextResponse.json({ ok: true });
  });
}
