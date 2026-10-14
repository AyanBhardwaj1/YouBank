import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { requireDb } from "@/db";
import { currentUser } from "@/lib/auth/user";
import { CalendarWorkspace } from "@/components/calendar/CalendarWorkspace";

export const dynamic = "force-dynamic";
export const metadata = { title: "Calendar" };

/** The calendar: ?view=day|week|agenda. Shows setup steps instead when the tables are missing. */
export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/sign-in");
  const rows = await requireDb().execute(sql`select to_regclass('public.calendar_events') is not null as ok`).catch(() => null);
  const ok = (rows as unknown as { rows?: { ok: boolean }[] } | null)?.rows?.[0]?.ok ?? false;
  const { view } = await searchParams;
  return <CalendarWorkspace needsMigration={!ok} initialView={view ?? null} />;
}
