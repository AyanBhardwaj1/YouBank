import { NextResponse } from "next/server";
import { and, eq, gt, sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { guarded } from "@/lib/auth/user";

export const dynamic = "force-dynamic";

/** The person's AI usage over the last 30 days: cost and tokens by feature and model, and how much input came from the prompt cache. */
export async function GET() {
  return guarded(async (user) => {
    const db = requireDb();
    const since = new Date(Date.now() - 30 * 86_400_000);
    const where = and(eq(schema.aiUsage.userId, user.id), gt(schema.aiUsage.createdAt, since));
    const cols = {
      calls: sql<number>`count(*)::int`, cost: sql<number>`coalesce(sum(${schema.aiUsage.costUsd}), 0)::float`,
      input: sql<number>`coalesce(sum(${schema.aiUsage.inputTokens}), 0)::bigint`, cached: sql<number>`coalesce(sum(${schema.aiUsage.cachedTokens}), 0)::bigint`,
      output: sql<number>`coalesce(sum(${schema.aiUsage.outputTokens}), 0)::bigint`,
    };
    const [total] = await db.select(cols).from(schema.aiUsage).where(where);
    const byFeature = await db.select({ feature: schema.aiUsage.feature, ...cols }).from(schema.aiUsage).where(where).groupBy(schema.aiUsage.feature).orderBy(sql`sum(${schema.aiUsage.costUsd}) desc`).limit(15);
    const byModel = await db.select({ model: schema.aiUsage.model, ...cols }).from(schema.aiUsage).where(where).groupBy(schema.aiUsage.model).orderBy(sql`sum(${schema.aiUsage.costUsd}) desc`).limit(8);
    const num = (x: unknown) => Number(x ?? 0);
    const norm = <T extends Record<string, unknown>>(r: T) => ({ ...r, calls: num(r.calls), cost: num(r.cost), input: num(r.input), cached: num(r.cached), output: num(r.output) });
    return NextResponse.json({ total: norm(total ?? {}), byFeature: byFeature.map(norm), byModel: byModel.map(norm) });
  });
}
