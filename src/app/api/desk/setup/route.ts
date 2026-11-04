import { NextResponse } from "next/server";
import { updateExtra } from "@/lib/prefs/extra";
import { eq } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { guarded } from "@/lib/auth/user";
import { rateLimit } from "@/lib/locks";
import { normalizeDesk } from "@/lib/desk/desk";
import { setupFromWords } from "@/lib/desk/setup";
import { normalizeNavPrefs } from "@/lib/nav";
import type { RoleId } from "@/lib/roles";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * POST { words? }: set up the person's desk (features on, Home layout and widgets, the top bar) from their
 * own description, or from their survey when there are no words. Keeps their notes. Returns the new desk,
 * the pinned features and why each choice was made.
 */
export async function POST(req: Request) {
  return guarded(async (user) => {
    await rateLimit(`desk-setup:${user.id}`, 10, 3_600_000, "The desk has been set up many times this hour. Try again later.");
    const body = (await req.json().catch(() => ({}))) as { words?: unknown };
    const db = requireDb();
    const [row] = await db.select({ role: schema.profiles.role, goals: schema.profiles.goals, specialty: schema.profiles.specialty }).from(schema.profiles).where(eq(schema.profiles.userId, user.id));
    if (!row) return NextResponse.json({ error: "Finish setting up your profile first." }, { status: 400 });
    const role = row.role as RoleId;
    const words = typeof body.words === "string" ? body.words.slice(0, 1500) : "";
    const r = await setupFromWords(role, words || [row.specialty, row.goals].filter(Boolean).join(". "));
    // Merged into what is stored now, not what was read before the model answered: notes typed meanwhile stay.
    let desk = { ...r.desk, notes: "", source: words ? r.desk.source : ("auto" as const) };
    await updateExtra(user.id, (extra) => {
      desk = { ...desk, notes: normalizeDesk(extra.desk, role).notes };
      extra.desk = desk;
      extra.nav = { ...normalizeNavPrefs(extra.nav, role, desk.hidden), pinned: r.pinned };
      return extra;
    });
    return NextResponse.json({ desk, pinned: r.pinned, reasons: r.reasons, via: r.via });
  });
}
