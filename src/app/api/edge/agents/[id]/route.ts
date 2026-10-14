import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { requireEdge } from "@/lib/edge/access";
import { thesisView } from "@/lib/edge/agent/store";

export const dynamic = "force-dynamic";

/** One thesis (E7): its state (plan, claims, evidence, red team, kill criteria, memo) and its steps, paged (?before=&kind=). */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guarded(async (user) => {
    await requireEdge(user.id);
    const id = Number((await ctx.params).id);
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Name a thesis." }, { status: 400 });
    const u = new URL(req.url).searchParams;
    const kind = u.get("kind") ?? "";
    return NextResponse.json(await thesisView(user.id, id, { before: Number(u.get("before")) || undefined, kind: /^[a-z]{2,12}$/.test(kind) ? kind : undefined }));
  });
}
