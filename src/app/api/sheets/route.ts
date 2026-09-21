import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { guarded } from "@/lib/auth/user";
import { requireDb, schema } from "@/db";
import type { MemberJson } from "@/db/schema";

export const dynamic = "force-dynamic";

export async function GET() {
  return guarded(async (user) => {
    const rows = await requireDb().select({ id: schema.compsSheets.id, name: schema.compsSheets.name, targetTicker: schema.compsSheets.targetTicker, createdBy: schema.compsSheets.createdBy, updatedAt: schema.compsSheets.updatedAt })
      .from(schema.compsSheets).where(eq(schema.compsSheets.userId, user.id)).orderBy(desc(schema.compsSheets.updatedAt));
    return NextResponse.json(rows);
  });
}

export async function POST(req: Request) {
  return guarded(async (user) => {
  const body = (await req.json().catch(() => null)) as { id?: number; name?: string; targetTicker?: string; members?: MemberJson[]; excluded?: string[]; columnSet?: string; sort?: { key: string; dir: 1 | -1 } | null; snapshot?: unknown } | null;
  const name = body?.name?.trim(); const target = body?.targetTicker?.toUpperCase().trim();
  if (!name || !target || !Array.isArray(body?.members)) return NextResponse.json({ error: "name, targetTicker, members required" }, { status: 400 });
  const values = { name, targetTicker: target, members: body!.members!, excluded: body?.excluded ?? [], columnSet: body?.columnSet ?? "all", sort: body?.sort ?? null, snapshot: body?.snapshot ?? null, updatedAt: new Date() };
  try {
    const db = requireDb();
    if (body?.id) {
      const [row] = await db.update(schema.compsSheets).set(values).where(and(eq(schema.compsSheets.id, body.id), eq(schema.compsSheets.userId, user.id))).returning();
      if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
      return NextResponse.json(row);
    }
    const [row] = await db.insert(schema.compsSheets).values({ ...values, createdBy: user.name || user.email || "analyst", userId: user.id }).returning();
    return NextResponse.json(row);
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 }); }
  });
}
