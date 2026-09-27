import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { updateContact } from "@/lib/crm/contacts";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guarded(async (user) => {
    const id = Number((await ctx.params).id);
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "bad id" }, { status: 400 });
    const body = (await req.json().catch(() => null)) as Parameters<typeof updateContact>[2] | null;
    if (!body) return NextResponse.json({ error: "bad request" }, { status: 400 });
    return NextResponse.json(await updateContact(user.id, id, body));
  });
}
