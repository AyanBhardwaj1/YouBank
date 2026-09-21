import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { guarded } from "@/lib/auth/user";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guarded(async (user) => {
    const { id } = await ctx.params;
    const [row] = await requireDb().select().from(schema.workflowRuns).where(and(eq(schema.workflowRuns.id, Number(id)), eq(schema.workflowRuns.userId, user.id)));
    if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(row);
  });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guarded(async (user) => {
    const { id } = await ctx.params;
    await requireDb().delete(schema.workflowRuns).where(and(eq(schema.workflowRuns.id, Number(id)), eq(schema.workflowRuns.userId, user.id)));
    return NextResponse.json({ ok: true });
  });
}
