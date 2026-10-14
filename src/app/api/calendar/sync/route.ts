import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { getAccount } from "@/lib/calendar/accounts";
import { relinkUser, syncAccount, syncUser } from "@/lib/calendar/sync";
import { rateLimit } from "@/lib/locks";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Sync now: one account ({ accountId }) or all of them. Free work; it also syncs on its own. */
export async function POST(req: Request) {
  return guarded(async (user) => {
    const body = (await req.json().catch(() => ({}))) as { accountId?: number };
    await rateLimit(`calendar-sync:${user.id}`, 30, 3_600_000, "Your calendars have been synced many times this hour. They also sync on their own, so try again later.");
    if (body.accountId) {
      const account = await getAccount(user.id, Number(body.accountId));
      if (!account) return NextResponse.json({ error: "That calendar account is not connected." }, { status: 404 });
      const result = await syncAccount(account);
      await relinkUser(user.id).catch(() => undefined);
      return NextResponse.json({ results: [result] });
    }
    return NextResponse.json({ results: await syncUser(user.id) });
  });
}
