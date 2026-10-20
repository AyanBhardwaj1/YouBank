import { and, count, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { profileRow } from "@/lib/auth/profile-row";
import { currentUser } from "@/lib/auth/user";
import { memo } from "@/lib/memo";
import { HomeDashboard } from "@/components/workspace/HomeDashboard";
import type { BriefData } from "@/components/news/Boards";
import { briefSlot } from "@/lib/news/brief";
import { allDesks, deskFor } from "@/lib/news/desks";
import { normalizeNewsPrefs } from "@/lib/news/prefs";
import { profileOf } from "@/lib/news/reader";
import { briefView } from "@/lib/news/views";

export const dynamic = "force-dynamic";
export const metadata = { title: "Home" };

/**
 * Today's brief for Home, read on the server so it is in the page's first HTML instead of being asked for
 * by the browser once the page's JavaScript has loaded. JSON-shaped, as /api/news/brief answers, with when
 * it was made (the browser skips its own first fetch while that is fresh). Only once the desk's brief for
 * today is stored: briefView writes the slot's first brief when there is none, a model call that would run on
 * past this response (and again when the browser asks). Null when none is stored yet, or it is not read
 * within SEED_WAIT_MS: the browser then fetches it as before, so the page never waits long for it.
 */
const SEED_WAIT_MS = 600;
/** Whether the brief briefView would show (the person's chosen desk, else their own) is stored for today. */
async function briefStored(userId: string): Promise<boolean> {
  const p = await profileRow(userId);
  if (!p) return false;
  const profile = profileOf(p);
  const prefs = normalizeNewsPrefs(((p.extra ?? {}) as Record<string, unknown>).news, profile);
  const desk = (prefs.desk && allDesks().find((d) => d.id === prefs.desk)) || deskFor(profile);
  const [row] = await db!.select({ id: schema.newsBriefs.id }).from(schema.newsBriefs)
    .where(and(eq(schema.newsBriefs.desk, desk.id), eq(schema.newsBriefs.kind, "morning"), eq(schema.newsBriefs.slot, briefSlot()))).limit(1);
  return !!row;
}
const seededBrief = (userId: string) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    briefStored(userId).then((stored) => (stored ? briefView(userId) : null)).then((v) => (v ? { data: JSON.parse(JSON.stringify(v)) as BriefData, at: Date.now() } : null)).catch(() => null),
    new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), SEED_WAIT_MS); }),
  ]).finally(() => clearTimeout(timer));
};

/** Role home: a dashboard of the user's desk. */
export default async function AppHome() {
  const user = await currentUser();
  if (!user || !db) redirect("/sign-in");
  const [brief, startups, sheets, groups] = await Promise.all([
    seededBrief(user.id),
    // The same for everyone and changes nightly: counted once per instance every ten minutes.
    memo("vc:total", 600_000, () => db!.select({ n: count() }).from(schema.startups).then((r) => r[0]?.n ?? null)).catch(() => null),
    db.select({ n: count() }).from(schema.compsSheets).where(eq(schema.compsSheets.userId, user.id)).then((r) => Number(r[0]?.n ?? 0)).catch(() => 0),
    db.select({ n: count() }).from(schema.peerGroups).where(eq(schema.peerGroups.userId, user.id)).then((r) => Number(r[0]?.n ?? 0)).catch(() => 0),
  ]);
  return <HomeDashboard facts={{ directoryTotal: startups === null ? null : Number(startups), sheets, groups }} brief={brief} />;
}
