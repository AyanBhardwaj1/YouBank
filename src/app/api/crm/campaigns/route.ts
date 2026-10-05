import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { createCampaign, listCampaigns } from "@/lib/crm/campaigns";
import { requireFeature } from "@/lib/billing/entitlements";
import { CAMPAIGNS } from "@/lib/crm/plan";

export const dynamic = "force-dynamic";

export async function GET() {
  return guarded(async (user) => NextResponse.json(await listCampaigns(user.id)));
}

/** Create a campaign. Premium (relationships.campaigns): a plan without it gets a 402 to show in line. */
export async function POST(req: Request) {
  return guarded(async (user) => {
    await requireFeature(user, CAMPAIGNS);
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    return NextResponse.json(await createCampaign(user.id, body ?? {}), { status: 201 });
  });
}
