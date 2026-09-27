import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { addPlaybookEntry, listPlaybook } from "@/lib/crm/knowledge";

export const dynamic = "force-dynamic";

export async function GET() {
  return guarded(async (user) => NextResponse.json(await listPlaybook(user.id)));
}

/** Teach the agent an answer before it ever has to ask. */
export async function POST(req: Request) {
  return guarded(async (user) => {
    const body = (await req.json().catch(() => null)) as { question?: string; answer?: string } | null;
    return NextResponse.json(await addPlaybookEntry(user.id, { question: body?.question ?? "", answer: body?.answer ?? "" }), { status: 201 });
  });
}
