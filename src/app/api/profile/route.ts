import { NextResponse } from "next/server";
import { updateExtra } from "@/lib/prefs/extra";
import { eq } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { guarded } from "@/lib/auth/user";
import { ROLES, type RoleId } from "@/lib/roles";
import { normalizeDesk, recommendDesk } from "@/lib/desk/desk";
import { normalizeNavPrefs } from "@/lib/nav";

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
    if (!body?.role || !(body.role in ROLES)) return NextResponse.json({ error: "Choose a role." }, { status: 400 });
    const values = {
      email: user.email, name: user.name, role: body.role, specialty: body.specialty ?? "", seniority: body.seniority ?? "", firmType: body.firmType ?? "",
      firmName: (body.firmName ?? "").slice(0, 120), firmTicker: (body.firmTicker ?? "").toUpperCase().slice(0, 8), sectors: Array.isArray(body.sectors) ? body.sectors.slice(0, 8) : [],
      goals: (body.goals ?? "").slice(0, 2000), completedAt: new Date(), updatedAt: new Date(),
    };
    const db = requireDb();
    // Whether the survey was finished before this save: only the first finish sets the desk up.
    const [before] = await db.select({ completedAt: schema.profiles.completedAt }).from(schema.profiles).where(eq(schema.profiles.userId, user.id));
    const [row] = await db.insert(schema.profiles).values({ userId: user.id, ...values }).onConflictDoUpdate({ target: schema.profiles.userId, set: values }).returning();
    // The first time the survey is finished, YouBank sets up the desk from it (features, Home, the top
    // bar). Editing the profile later, or anyone who finished it before desks existed, keeps the desk and
    // top bar they have (Settings → My desk can redo it). Merged under the row lock, like every prefs save.
    if (!before?.completedAt && !normalizeDesk((row.extra as Record<string, unknown> | null)?.desk, values.role).setupAt) {
      const r = recommendDesk(values.role, [values.specialty, values.goals].filter(Boolean).join(". "));
      const next = await updateExtra(user.id, (extra) => {
        const desk = { ...r.desk, source: "auto" as const, notes: normalizeDesk(extra.desk, values.role).notes };
        return { ...extra, desk, nav: { ...normalizeNavPrefs(extra.nav, values.role, desk.hidden), pinned: r.pinned } };
      }).catch(() => null);
      if (next) return NextResponse.json({ ...row, extra: next });
    }
    return NextResponse.json(row);
  });
}
