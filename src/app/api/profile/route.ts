import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { guarded } from "@/lib/auth/user";
import { ROLES, type RoleId } from "@/lib/roles";

export const dynamic = "force-dynamic";

export async function GET() {
  return guarded(async (user) => {
    const [row] = await requireDb().select().from(schema.profiles).where(eq(schema.profiles.userId, user.id));
    return NextResponse.json(row ?? null);
  });
}

export async function POST(req: Request) {
  return guarded(async (user) => {
    const body = (await req.json().catch(() => null)) as Partial<{ role: RoleId; specialty: string; seniority: string; firmType: string; firmName: string; firmTicker: string; sectors: string[]; goals: string }> | null;
    if (!body?.role || !(body.role in ROLES)) return NextResponse.json({ error: "role required" }, { status: 400 });
    const values = {
      email: user.email, name: user.name, role: body.role, specialty: body.specialty ?? "", seniority: body.seniority ?? "", firmType: body.firmType ?? "",
      firmName: (body.firmName ?? "").slice(0, 120), firmTicker: (body.firmTicker ?? "").toUpperCase().slice(0, 8), sectors: Array.isArray(body.sectors) ? body.sectors.slice(0, 8) : [],
      goals: (body.goals ?? "").slice(0, 2000), completedAt: new Date(), updatedAt: new Date(),
    };
    const db = requireDb();
    const [row] = await db.insert(schema.profiles).values({ userId: user.id, ...values }).onConflictDoUpdate({ target: schema.profiles.userId, set: values }).returning();
    return NextResponse.json(row);
  });
}
