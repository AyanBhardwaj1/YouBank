import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { requireDb } from "@/db";
import { aiAllowance } from "@/lib/ai/limits";
import { typicalCost, type Estimate } from "@/lib/ai/cost-preview";
import { isAdmin } from "@/lib/auth/admin";
import { guarded } from "@/lib/auth/user";
import { memo } from "@/lib/memo";

export const dynamic = "force-dynamic";

/** The kinds of run a person can ask about: deep research, a terminal answer, or one workflow. */
const FEATURE = /^(ai\.deep-research|terminal-ai|tool:[a-z0-9][a-z0-9-]{0,79})$/;

/**
 * The median cost of recent runs of one kind, across everyone (30 days, at most 300 runs, read from the
 * newest 20,000 usage rows so a rare kind never scans the table), reused for ten minutes per instance.
 */
const typical = (feature: string) => memo(`ai-estimate:${feature}`, 600_000, async () => {
  const rows = await requireDb().execute(sql`
    select cost_usd as c from (
      select feature, cost_usd from ai_usage where created_at > now() - interval '30 days' order by created_at desc limit 20000
    ) recent where feature = ${feature} limit 300`);
  const costs = (rows.rows as { c: number }[]).map((r) => Number(r.c));
  return { typicalUsd: typicalCost(costs), runs: costs.length };
});

/**
 * GET ?feature=ai.deep-research | terminal-ai | tool:<id>: what such a run usually costs, with this
 * person's monthly allowance and what is left of it, for the line shown before a run starts
 * (src/lib/ai/cost-preview.ts). Reads only.
 */
export async function GET(req: Request) {
  return guarded(async (user) => {
    const feature = new URL(req.url).searchParams.get("feature") ?? "";
    if (!FEATURE.test(feature)) return NextResponse.json({ error: "Unknown kind of run." }, { status: 400 });
    const [t, a] = await Promise.all([typical(feature).catch(() => ({ typicalUsd: null, runs: 0 })), aiAllowance(user.id, isAdmin(user)).catch(() => null)]);
    const estimate: Estimate = { ...t, monthlyUsd: a?.monthlyUsd ?? null, monthUsd: a?.monthUsd ?? 0, leftUsd: a?.credits.leftUsd ?? 0 };
    return NextResponse.json(estimate, { headers: { "Cache-Control": "private, no-store" } });
  });
}
