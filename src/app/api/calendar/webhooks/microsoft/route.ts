import { NextResponse, after } from "next/server";
import { eq } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { calendarForPush } from "@/lib/calendar/push";
import { syncAccount } from "@/lib/calendar/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Microsoft Graph change notifications. When a subscription is created Graph checks the endpoint
 * by posting ?validationToken=..., which must be echoed back as text within ten seconds. After that,
 * each notification carries the subscription id and our clientState secret; matching calendars are
 * synced after the response (Graph wants an answer within three seconds).
 */
export async function POST(req: Request) {
  const validation = new URL(req.url).searchParams.get("validationToken");
  if (validation !== null) return new NextResponse(validation.slice(0, 1000), { status: 200, headers: { "content-type": "text/plain" } });
  const body = (await req.json().catch(() => null)) as { value?: { subscriptionId?: string; clientState?: string }[] } | null;
  const ids = new Set<number>();
  for (const n of body?.value ?? []) {
    const cal = await calendarForPush("microsoft", n.subscriptionId ?? "", n.clientState ?? "").catch(() => null);
    if (cal) ids.add(cal.id);
  }
  if (ids.size) {
    after(async () => {
      const db = requireDb();
      for (const id of ids) {
        const [row] = await db.select({ account: schema.calendarAccounts }).from(schema.calendarCalendars)
          .innerJoin(schema.calendarAccounts, eq(schema.calendarAccounts.id, schema.calendarCalendars.accountId)).where(eq(schema.calendarCalendars.id, id));
        if (row?.account.status === "connected") await syncAccount(row.account, { calendars: false, only: [id] }).catch(() => undefined);
      }
    });
  }
  return new NextResponse(null, { status: 202 });
}
