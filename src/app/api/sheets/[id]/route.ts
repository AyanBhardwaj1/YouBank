import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { guarded } from "@/lib/auth/user";
import { requireDb, schema } from "@/db";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guarded(async (user) => {
    const id = Number((await ctx.params).id);
    if (!Number.isInteger(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
    const db = requireDb();
    const [sheet] = await db.select().from(schema.compsSheets).where(and(eq(schema.compsSheets.id, id), eq(schema.compsSheets.userId, user.id)));
    if (!sheet) return NextResponse.json({ error: "not found" }, { status: 404 });
    const notes = await db.select().from(schema.footnotes).where(eq(schema.footnotes.sheetId, id));
    return NextResponse.json({ ...sheet, footnotes: notes });
  });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guarded(async (user) => {
    const id = Number((await ctx.params).id);
    if (!Number.isInteger(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
    await requireDb().delete(schema.compsSheets).where(and(eq(schema.compsSheets.id, id), eq(schema.compsSheets.userId, user.id)));
    return NextResponse.json({ ok: true });
  });
}
