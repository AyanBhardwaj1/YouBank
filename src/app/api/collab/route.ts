import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { createSession, listSessions } from "@/lib/collab/db";

export const dynamic = "force-dynamic";

export async function GET() {
  return guarded(async (user) => NextResponse.json(await listSessions(user)));
}

export async function POST(req: Request) {
  return guarded(async (user) => {
    const body = (await req.json().catch(() => null)) as
      { kind?: string; refId?: string; title?: string; teamId?: number | null; state?: Record<string, unknown> } | null;
    const session = await createSession(user, {
      kind: body?.kind, refId: body?.refId, title: body?.title,
      teamId: body?.teamId ?? null, state: body?.state ?? {},
    });
    return NextResponse.json(session, { status: 201 });
  });
}
