import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { considerDraft } from "@/lib/crm/autopilot";
import { rateLimit } from "@/lib/locks";
import { requireFeature } from "@/lib/billing/entitlements";
import { CAMPAIGNS } from "@/lib/crm/plan";
import {
  addLeads, deleteCampaign, getCampaign, parseLeadList, prepareCampaign, qualifyCampaign, updateCampaign, type LeadInput,
} from "@/lib/crm/campaigns";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const parseId = (v: string) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guarded(async (user) => {
    const id = parseId((await ctx.params).id);
    if (!id) return NextResponse.json({ error: "bad id" }, { status: 400 });
    return NextResponse.json(await getCampaign(user.id, id));
  });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guarded(async (user) => {
    const id = parseId((await ctx.params).id);
    if (!id) return NextResponse.json({ error: "bad id" }, { status: 400 });
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    // Launching (or resuming) a campaign is premium; pausing, editing and archiving stay open.
    if (body?.status === "active") await requireFeature(user, CAMPAIGNS);
    return NextResponse.json(await updateCampaign(user.id, id, body ?? {}));
  });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guarded(async (user) => {
    const id = parseId((await ctx.params).id);
    if (!id) return NextResponse.json({ error: "bad id" }, { status: 400 });
    await deleteCampaign(user.id, id);
    return NextResponse.json({ ok: true });
  });
}

/**
 * action: "add_leads" with `text` (one "email, name, company" per line) and/or `leads`;
 * "qualify" scores sourced leads against the ICP; "prepare" drafts the steps now due.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guarded(async (user) => {
    const id = parseId((await ctx.params).id);
    if (!id) return NextResponse.json({ error: "bad id" }, { status: 400 });
    const body = (await req.json().catch(() => null)) as { action?: string; text?: string; leads?: LeadInput[] } | null;
    if (body?.action === "add_leads") {
      const pasted = parseLeadList(body.text ?? "");
      // Pasted lines with no usable address are reported as skipped rather than silently dropped.
      const unreadable = (body.text ?? "").split(/\r?\n/).filter((l) => l.trim()).length - pasted.length;
      const leads = [...pasted, ...(Array.isArray(body.leads) ? body.leads : [])];
      if (leads.length === 0) return NextResponse.json({ error: "No leads with an email address or a directory company were given" }, { status: 400 });
      const r = await addLeads(user.id, id, leads);
      return NextResponse.json({ ...r, skipped: r.skipped + unreadable });
    }
    // Qualifying and drafting call the model: premium, like the campaign itself.
    if (body?.action === "qualify" || body?.action === "prepare") await requireFeature(user, CAMPAIGNS);
    if (body?.action === "qualify" || body?.action === "prepare") await rateLimit(`crm-draft:${user.id}`, 20, 3_600_000, "Drafting has run many times this hour. Try again later.");
    if (body?.action === "qualify") return NextResponse.json(await qualifyCampaign(user.id, id, Date.now() + 250_000));
    if (body?.action === "prepare") {
      const r = await prepareCampaign(user.id, id, Date.now() + 250_000);
      let scheduled = 0;
      for (const d of r.draftIds) if ((await considerDraft(user.id, d)).scheduled) scheduled++;
      return NextResponse.json({ ...r, scheduled });
    }
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  });
}
