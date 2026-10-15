import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { CROSS_SITE, requestMeta, requireConsent, sameSiteJson } from "@/lib/algo/access";
import { addConnection, brokerSetup, listConnections, removeConnection } from "@/lib/algo/connections";
import { rateLimit } from "@/lib/locks";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** GET — the person's broker connections (no credentials, ever) and what this server has set up. */
export async function GET() {
  return guarded(async (user) => NextResponse.json({ connections: await listConnections(user), setup: brokerSetup() }));
}

/** POST { broker, env?, keyId?, secret?, appKey?, appSecret?, apiKey?, privateKey?, label? } — check and save a connection, encrypted. */
export async function POST(req: Request) {
  if (!sameSiteJson(req)) return NextResponse.json(CROSS_SITE, { status: 403 });
  return guarded(async (user) => {
    await rateLimit(`algo-connect:${user.id}`, 5, 60_000, "Too many connection attempts. Wait a moment and try again.");
    await requireConsent(user.id, "terms");
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return NextResponse.json(await addConnection(user, body, requestMeta(req)));
  });
}

/** DELETE { ref } — revoke a connection; its strategies pause and unsent batches are canceled. */
export async function DELETE(req: Request) {
  if (!sameSiteJson(req)) return NextResponse.json(CROSS_SITE, { status: 403 });
  return guarded(async (user) => {
    const body = (await req.json().catch(() => ({}))) as { ref?: unknown };
    await removeConnection(user, String(body.ref ?? ""), requestMeta(req));
    return NextResponse.json({ ok: true });
  });
}
