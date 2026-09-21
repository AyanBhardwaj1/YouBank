import { NextResponse } from "next/server";
import { asc, desc, eq } from "drizzle-orm";
import { guarded } from "@/lib/auth/user";
import { requireDb, schema } from "@/db";
import type { MemberJson } from "@/db/schema";

export const dynamic = "force-dynamic";

export async function GET() {
  return guarded(async (user) => {
  try {
    const db = requireDb();
    const groups = await db.select().from(schema.peerGroups).where(eq(schema.peerGroups.userId, user.id)).orderBy(desc(schema.peerGroups.createdAt));
    const members = await db.select().from(schema.peerGroupMembers).orderBy(asc(schema.peerGroupMembers.position));
    return NextResponse.json(groups.map((g) => ({
      id: `db-${g.id}`, dbId: g.id, name: g.name, description: g.description, createdBy: g.createdBy, createdAt: g.createdAt,
      members: members.filter((m) => m.groupId === g.id).map((m) => ({ ticker: m.ticker, tier: m.tier as MemberJson["tier"], rationale: m.rationale })),
    })));
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 }); }
  });
}

export async function POST(req: Request) {
  return guarded(async (user) => {
  const body = (await req.json().catch(() => null)) as { name?: string; description?: string; members?: MemberJson[] } | null;
  const name = body?.name?.trim();
  const members = (body?.members ?? []).filter((m) => m && typeof m.ticker === "string").map((m, i) => ({ ticker: m.ticker.toUpperCase().trim(), tier: m.tier === "adjacent" ? "adjacent" : "core", rationale: m.rationale ?? "", position: i }));
  if (!name || members.length === 0) return NextResponse.json({ error: "name and at least one member required" }, { status: 400 });
  try {
    const db = requireDb();
    const [g] = await db.insert(schema.peerGroups).values({ name, description: body?.description ?? "", createdBy: user.name || user.email || "analyst", userId: user.id }).returning();
    await db.insert(schema.peerGroupMembers).values(members.map((m) => ({ ...m, groupId: g.id })));
    return NextResponse.json({ id: `db-${g.id}`, dbId: g.id, name: g.name, description: g.description, members });
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 }); }
  });
}
