import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { composeDraft } from "@/lib/crm/compose";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Write a new email from a brief. It waits in the review queue; new emails are always sent by a person. */
export async function POST(req: Request) {
  return guarded(async (user) => {
    const body = (await req.json().catch(() => null)) as { to?: string; name?: string; company?: string; brief?: string } | null;
    return NextResponse.json(await composeDraft(user.id, { to: body?.to ?? "", name: body?.name, company: body?.company, brief: body?.brief ?? "" }), { status: 201 });
  });
}
