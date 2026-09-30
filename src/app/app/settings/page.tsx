import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { currentUser } from "@/lib/auth/user";
import { SettingsClient } from "@/components/workspace/SettingsClient";
import { normalizePrefs } from "@/lib/ai/models";
import { edgePrefs } from "@/lib/edge/access";
import type { RoleId } from "@/lib/roles";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings" };

export default async function SettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await currentUser();
  if (!user || !db) redirect("/sign-in");
  const [p] = await db.select({ extra: schema.profiles.extra, role: schema.profiles.role }).from(schema.profiles).where(eq(schema.profiles.userId, user.id));
  const extra = (p?.extra ?? {}) as Record<string, unknown>;
  const tab = (await searchParams).tab;
  return <SettingsClient email={user.email} prefs={normalizePrefs(extra.ai)} initialTab={typeof tab === "string" ? tab : undefined} edgeOn={edgePrefs(extra, (p?.role ?? "banker") as RoleId).beta} />;
}
