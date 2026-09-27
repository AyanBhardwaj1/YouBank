import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { createRule, listRules } from "@/lib/crm/nurture";

export const dynamic = "force-dynamic";

/** Rules, plus the recent decision log so every draft and every skip can be explained. */
export async function GET() {
  return guarded(async (user) => NextResponse.json(await listRules(user.id)));
}

export async function POST(req: Request) {
  return guarded(async (user) => {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    return NextResponse.json(await createRule(user.id, body ?? {}), { status: 201 });
  });
}
