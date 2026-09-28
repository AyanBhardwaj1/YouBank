import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { contactKnowledge } from "@/lib/crm/insights";

export const dynamic = "force-dynamic";

/** What one contact has been told, what stuck, what they engage with, and what to raise next. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guarded(async (user) => {
    const id = Number((await ctx.params).id);
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Bad contact id" }, { status: 400 });
    return NextResponse.json(await contactKnowledge(user.id, id));
  });
}
