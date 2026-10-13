import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { getAccount, listAccounts } from "@/lib/crm/accounts";
import { afterTriage, sendDue } from "@/lib/crm/autopilot";
import { claimLock, releaseLock } from "@/lib/crm/settings";
import { syncAccount } from "@/lib/crm/sync";
import { rateLimit } from "@/lib/locks";
import { siteUrl } from "@/lib/site";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Read the mailbox now. Works for every connected mailbox type (Gmail sign-in or app password).
 * New mail is triaged and, as the autopilot settings allow, answered; anything autopilot has due
 * afterwards is sent inside the person's sending hours.
 */
export async function POST(req: Request) {
  return guarded(async (user) => {
    const body = (await req.json().catch(() => null)) as { accountId?: number; max?: number } | null;
    const account = body?.accountId ? await getAccount(user.id, body.accountId) : (await listAccounts(user.id))[0];
    if (!account) return NextResponse.json({ error: "No mailbox is connected" }, { status: 400 });
    await rateLimit(`mail-sync:${user.id}`, 20, 3_600_000, "The mailbox has been read many times this hour. It also syncs on its own, so try again later.");
    // The heartbeat may be working on this mailbox right now; never read it twice at once.
    if (!(await claimLock(user.id, 5))) {
      return NextResponse.json({ error: "The agent is reading your mailbox right now. Try again in a minute." }, { status: 409 });
    }
    try {
      const origin = siteUrl();
      const deadline = Date.now() + 250_000;
      let drafted = 0, scheduled = 0;
      const result = await syncAccount(user.id, account, origin, {
        max: Math.min(Math.max(body?.max ?? 15, 1), 40), deadline: deadline - 30_000,
        onTriaged: async (threadId) => {
          const r = await afterTriage(user.id, threadId).catch(() => null);
          if (r?.drafted) drafted++;
          if (r?.scheduled) scheduled++;
        },
      });
      const queue = await sendDue(user.id, origin, deadline).catch(() => null);
      return NextResponse.json({ ...result, drafted, scheduled, sent: queue?.sent ?? 0 });
    } finally {
      await releaseLock(user.id);
    }
  });
}
