import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { requireDb } from "@/db";
import { isAdmin } from "@/lib/auth/admin";
import { guarded } from "@/lib/auth/user";

export const dynamic = "force-dynamic";

/**
 * Claims people reported as wrong, newest first, with the claim, its support, its passages' quotes and the
 * verifier that scored it: the review queue for growing Calibrated Claims' calibration set. Administrators only.
 */
export async function GET(req: Request) {
  return guarded(async (user) => {
    if (!isAdmin(user)) return NextResponse.json({ error: "Administrators only." }, { status: 403 });
    const limit = Math.max(1, Math.min(200, Number(new URL(req.url).searchParams.get("limit")) || 50));
    const rows = (await requireDb().execute(sql`
      select a.id, a.question, a.mode, r.value as report, a.answer->'verifier' as verifier,
        case when (r.value->>'held')::boolean then a.answer->'held'->((r.value->>'claim')::int) else a.answer->'claims'->((r.value->>'claim')::int) end as claim,
        a.answer->'citations' as citations
      from edge_answers a, jsonb_array_elements(coalesce(a.answer->'reports', '[]'::jsonb)) r
      order by (r.value->>'at') desc limit ${limit}`)).rows;
    return NextResponse.json({ reports: rows });
  });
}
