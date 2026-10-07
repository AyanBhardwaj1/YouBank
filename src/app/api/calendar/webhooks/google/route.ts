import { NextResponse, after } from "next/server";
import { eq } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { calendarForPush } from "@/lib/calendar/push";
import { syncAccount } from "@/lib/calendar/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Google Calendar push: a channel says "something changed" (no content). Verified by the channel
 * token, then that calendar is synced after the response. Unknown or forged calls get the same 200,
 * so they learn nothing. The first "sync" message on a new channel needs no work.
 */
export async function POST(req: Request) {
  const channelId = req.headers.get("x-goog-channel-id") ?? "";
  const token = req.headers.get("x-goog-channel-token") ?? "";
  const state = req.headers.get("x-goog-resource-state") ?? "";
  if (state === "sync") return new NextResponse(null, { status: 200 });
  const cal = await calendarForPush("google", channelId, token).catch(() => null);
  if (cal) {
    after(async () => {
      const [account] = await requireDb().select().from(schema.calendarAccounts).where(eq(schema.calendarAccounts.id, cal.accountId));
      if (account?.status === "connected") await syncAccount(account, { calendars: false, only: [cal.id] }).catch(() => undefined);
    });
  }
  return new NextResponse(null, { status: 200 });
}
