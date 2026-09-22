import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { getAccount, listAccounts, syncMailbox } from "@/lib/crm/accounts";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Pull recent threads and read them. Triggered by the person, never on a schedule. */
export async function POST(req: Request) {
  return guarded(async (user) => {
    const body = (await req.json().catch(() => null)) as { accountId?: number; max?: number; query?: string } | null;
    const account = body?.accountId ? await getAccount(user.id, body.accountId) : (await listAccounts(user.id))[0];
    if (!account) return NextResponse.json({ error: "No mailbox is connected" }, { status: 400 });
    const max = Math.min(Math.max(body?.max ?? 10, 1), 25);
    const result = await syncMailbox(user.id, account, new URL(req.url).origin, { max, query: body?.query });
    return NextResponse.json(result);
  });
}
