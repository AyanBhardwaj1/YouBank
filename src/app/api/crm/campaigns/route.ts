import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { createCampaign, listCampaigns } from "@/lib/crm/campaigns";

export const dynamic = "force-dynamic";

export async function GET() {
  return guarded(async (user) => NextResponse.json(await listCampaigns(user.id)));
}

export async function POST(req: Request) {
  return guarded(async (user) => {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    return NextResponse.json(await createCampaign(user.id, body ?? {}), { status: 201 });
  });
}
