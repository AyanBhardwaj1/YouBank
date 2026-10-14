import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { assembleBrief, generateBrief, storedBrief } from "@/lib/calendar/briefs";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const idOf = async (ctx: { params: Promise<{ id: string }> }) => {
  const id = Number((await ctx.params).id);
  return Number.isInteger(id) && id > 0 ? id : null;
};

/** The assembled brief (free, from YouBank's own data) and the AI brief if one was already written. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guarded(async (user) => {
    const id = await idOf(ctx);
    if (!id) return NextResponse.json({ error: "bad id" }, { status: 400 });
    const [assembled, ai] = await Promise.all([assembleBrief(user.id, id), storedBrief(user.id, id)]);
    if (!assembled) return NextResponse.json({ error: "That meeting is not in your calendar any more." }, { status: 404 });
    return NextResponse.json({ assembled, ai });
  });
}

/** Write the AI brief. Premium; only ever started by this explicit request. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guarded(async (user) => {
    const id = await idOf(ctx);
    if (!id) return NextResponse.json({ error: "bad id" }, { status: 400 });
    await generateBrief(user, id);
    return NextResponse.json({ ai: await storedBrief(user.id, id) });
  });
}
