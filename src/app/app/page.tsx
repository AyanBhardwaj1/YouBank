import { count, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { currentUser } from "@/lib/auth/user";
import { memo } from "@/lib/memo";
import { HomeDashboard } from "@/components/workspace/HomeDashboard";
import type { BriefData } from "@/components/news/Boards";
import { briefView } from "@/lib/news/views";

export const dynamic = "force-dynamic";
export const metadata = { title: "Home" };

/**
 * Today's brief for Home, made on the server so it streams in with the page instead of being asked for by
 * the browser once the page's JavaScript has loaded. JSON-shaped, as /api/news/brief answers, with when it
 * was made (the browser skips its own first fetch while that is fresh). Null when it cannot be made, or
 * is not ready within SEED_WAIT_MS (a desk's first brief of the morning is still being written): the
 * browser then fetches it as before, and the page's stream is not held open.
 */
const SEED_WAIT_MS = 2_500;
const seededBrief = (userId: string) => Promise.race([
  briefView(userId).then((v) => (v ? { data: JSON.parse(JSON.stringify(v)) as BriefData, at: Date.now() } : null)).catch(() => null),
  new Promise<null>((resolve) => setTimeout(() => resolve(null), SEED_WAIT_MS)),
]);

/** Role home: a dashboard of the user's desk. */
export default async function AppHome() {
  const user = await currentUser();
  if (!user || !db) redirect("/sign-in");
  // Started now and streamed in with the page (not awaited here).
  const brief = seededBrief(user.id);
  const [startups, sheets, groups] = await Promise.all([
    // The same for everyone and changes nightly: counted once per instance every ten minutes.
    memo("vc:total", 600_000, () => db!.select({ n: count() }).from(schema.startups).then((r) => r[0]?.n ?? null)).catch(() => null),
    db.select({ n: count() }).from(schema.compsSheets).where(eq(schema.compsSheets.userId, user.id)).then((r) => Number(r[0]?.n ?? 0)).catch(() => 0),
    db.select({ n: count() }).from(schema.peerGroups).where(eq(schema.peerGroups.userId, user.id)).then((r) => Number(r[0]?.n ?? 0)).catch(() => 0),
  ]);
  return <HomeDashboard facts={{ directoryTotal: startups === null ? null : Number(startups), sheets, groups }} brief={brief} />;
}
