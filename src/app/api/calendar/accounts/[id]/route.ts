import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { disconnectAccount } from "@/lib/calendar/accounts";
import { stopPush } from "@/lib/calendar/push";

export const dynamic = "force-dynamic";

/** Disconnect: push channels stopped, then the account, its calendars, events and tokens deleted. */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guarded(async (user) => {
    const id = Number((await ctx.params).id);
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "bad id" }, { status: 400 });
    await disconnectAccount(user.id, id, stopPush);
    return NextResponse.json({ ok: true });
  });
}
