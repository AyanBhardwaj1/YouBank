import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { guarded } from "@/lib/auth/user";
import { requireDb, schema } from "@/db";

export const dynamic = "force-dynamic";

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guarded(async (user) => {
    const id = Number((await ctx.params).id);
    if (!Number.isInteger(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
    await requireDb().delete(schema.peerGroups).where(and(eq(schema.peerGroups.id, id), eq(schema.peerGroups.userId, user.id)));
    return NextResponse.json({ ok: true });
  });
}
