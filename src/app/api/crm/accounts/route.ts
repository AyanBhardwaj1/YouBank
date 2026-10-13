import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { listAccounts, saveImapAccount, toSafe } from "@/lib/crm/accounts";
import { encryptionReady } from "@/lib/crm/crypto";
import { MAIL_PRESETS } from "@/lib/crm/imap";
import { rateLimit } from "@/lib/locks";
import { errorResponse } from "@/lib/errors";
import { requireMailboxRoom } from "@/lib/crm/plan";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Connected mailboxes (never their secrets), and which ways of connecting this server supports. */
export async function GET() {
  return guarded(async (user) => NextResponse.json({
    accounts: (await listAccounts(user.id)).map(toSafe),
    configurable: encryptionReady(),
    oauth: encryptionReady() && !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET,
    presets: Object.fromEntries(Object.entries(MAIL_PRESETS).map(([k, p]) => [k, { label: p.label, appPasswordUrl: p.appPasswordUrl, note: p.note }])),
  }));
}

/** Connect a mailbox with an app password. Both servers are signed in to before anything is saved. */
export async function POST(req: Request) {
  return guarded(async (user) => {
    const body = (await req.json().catch(() => null)) as {
      email?: string; password?: string; name?: string; preset?: string;
      imapHost?: string; imapPort?: number; smtpHost?: string; smtpPort?: number; username?: string;
    } | null;
    if (!body?.email || !body.password) return NextResponse.json({ error: "Email and app password are required" }, { status: 400 });
    await rateLimit(`mail-connect:${user.id}`, 10, 3_600_000, "Too many connection attempts this hour. Check the settings and try again later.");
    // A second mailbox is premium (relationships.extra-mailboxes); a plan without it gets a 402 to show in line.
    await requireMailboxRoom(user, body.email);
    try {
      const account = await saveImapAccount(user.id, { ...body, email: body.email, password: body.password });
      return NextResponse.json(toSafe(account), { status: 201 });
    } catch (e) {
      return errorResponse(e, 400);
    }
  });
}
