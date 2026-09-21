import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { guarded } from "@/lib/auth/user";
import { isThemeId } from "@/lib/themes";
import { MODELS, normalizePrefs } from "@/lib/ai/models";

export const dynamic = "force-dynamic";

/** Per-account preferences kept in profiles.extra: { theme, ai: { provider, model, effort } }. */
export async function GET() {
  return guarded(async (user) => {
    const [row] = await requireDb().select({ extra: schema.profiles.extra }).from(schema.profiles).where(eq(schema.profiles.userId, user.id));
    return NextResponse.json(row?.extra ?? {});
  });
}

export async function POST(req: Request) {
  return guarded(async (user) => {
    const body = (await req.json().catch(() => null)) as { theme?: string; ai?: unknown } | null;
    if (!body) return NextResponse.json({ error: "bad request" }, { status: 400 });
    const db = requireDb();
    const [row] = await db.select({ extra: schema.profiles.extra }).from(schema.profiles).where(eq(schema.profiles.userId, user.id));
    const extra: Record<string, unknown> = { ...(row?.extra ?? {}) };
    if (typeof body.theme === "string" && isThemeId(body.theme)) extra.theme = body.theme;
    if (body.ai !== undefined) {
      const ai = normalizePrefs(body.ai);
      if (ai.model && !MODELS.some((m) => m.id === ai.model)) return NextResponse.json({ error: `Unknown model ${ai.model}` }, { status: 400 });
      extra.ai = { ...((extra.ai as object) ?? {}), ...ai };
    }
    if (!row) {
      // Preferences before onboarding completes: create a stub profile row.
      await db.insert(schema.profiles).values({ userId: user.id, email: user.email, name: user.name, role: "banker", extra }).onConflictDoUpdate({ target: schema.profiles.userId, set: { extra } });
    } else {
      await db.update(schema.profiles).set({ extra, updatedAt: new Date() }).where(eq(schema.profiles.userId, user.id));
    }
    return NextResponse.json(extra);
  });
}
