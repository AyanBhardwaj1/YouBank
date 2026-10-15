import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { moveDeal } from "@/lib/crm/db";
import { isStage } from "@/lib/crm/model";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guarded(async (user) => {
    const id = Number((await ctx.params).id);
    if (!Number.isInteger(id)) return NextResponse.json({ error: "That link is not valid. Check it, or go back and open the item again." }, { status: 400 });
    const body = (await req.json().catch(() => null)) as { stage?: string } | null;
    if (!isStage(body?.stage)) return NextResponse.json({ error: "A valid stage is required" }, { status: 400 });
    return NextResponse.json(await moveDeal(user.id, id, body.stage));
  });
}
