import { count, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { currentUser } from "@/lib/auth/user";
import { HomeDashboard } from "@/components/workspace/HomeDashboard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Home" };

/** Role home: a dashboard of the user's desk. */
export default async function AppHome() {
  const user = await currentUser();
  if (!user || !db) redirect("/sign-in");
  const [startups, sheets, groups] = await Promise.all([
    db.select({ n: count() }).from(schema.startups).then((r) => r[0]?.n ?? null).catch(() => null),
    db.select({ n: count() }).from(schema.compsSheets).where(eq(schema.compsSheets.userId, user.id)).then((r) => Number(r[0]?.n ?? 0)).catch(() => 0),
    db.select({ n: count() }).from(schema.peerGroups).where(eq(schema.peerGroups.userId, user.id)).then((r) => Number(r[0]?.n ?? 0)).catch(() => 0),
  ]);
  return <HomeDashboard facts={{ directoryTotal: startups === null ? null : Number(startups), sheets, groups }} />;
}
