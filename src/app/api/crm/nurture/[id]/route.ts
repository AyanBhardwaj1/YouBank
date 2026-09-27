import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { guarded } from "@/lib/auth/user";
import { considerDraft } from "@/lib/crm/autopilot";
import { deleteRule, previewRule, runRule, updateRule } from "@/lib/crm/nurture";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const parseId = (v: string) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };

async function ruleFor(userId: string, id: number) {
  const [rule] = await requireDb().select().from(schema.crmNurtureRules).where(and(eq(schema.crmNurtureRules.id, id), eq(schema.crmNurtureRules.userId, userId)));
  if (!rule) throw Object.assign(new Error("Rule not found"), { status: 404 });
  return rule;
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guarded(async (user) => {
    const id = parseId((await ctx.params).id);
    if (!id) return NextResponse.json({ error: "bad id" }, { status: 400 });
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    return NextResponse.json(await updateRule(user.id, id, body ?? {}));
  });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guarded(async (user) => {
    const id = parseId((await ctx.params).id);
    if (!id) return NextResponse.json({ error: "bad id" }, { status: 400 });
    await deleteRule(user.id, id);
    return NextResponse.json({ ok: true });
  });
}

/** action: "preview" lists who is due without calling the model; "run" drafts for them now. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guarded(async (user) => {
    const id = parseId((await ctx.params).id);
    if (!id) return NextResponse.json({ error: "bad id" }, { status: 400 });
    const body = (await req.json().catch(() => null)) as { action?: string } | null;
    const rule = await ruleFor(user.id, id);
    if (body?.action === "run") {
      const r = await runRule(user.id, rule, Date.now() + 250_000);
      let scheduled = 0;
      for (const d of r.draftIds) if ((await considerDraft(user.id, d)).scheduled) scheduled++;
      return NextResponse.json({ ...r, scheduled });
    }
    return NextResponse.json(await previewRule(user.id, rule));
  });
}
