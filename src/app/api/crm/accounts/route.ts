import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { listAccounts, toSafe } from "@/lib/crm/accounts";
import { encryptionReady } from "@/lib/crm/crypto";

export const dynamic = "force-dynamic";

/** Connected mailboxes, without tokens, plus whether the server can store one at all. */
export async function GET() {
  return guarded(async (user) => NextResponse.json({
    accounts: (await listAccounts(user.id)).map(toSafe),
    configurable: encryptionReady() && !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET,
  }));
}
