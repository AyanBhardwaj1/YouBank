import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { disconnectAccount } from "@/lib/crm/accounts";

export const dynamic = "force-dynamic";

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guarded(async (user) => {
    const id = Number((await ctx.params).id);
    if (!Number.isInteger(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
    await disconnectAccount(user.id, id);
    return NextResponse.json({ ok: true });
  });
}
