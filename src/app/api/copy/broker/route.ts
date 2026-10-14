import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { canUse } from "@/lib/billing/entitlements";
import { CROSS_SITE, requestMeta, sameSiteJson } from "@/lib/copytrade/access";
import { accounts, brokerSetup, connectLink, disconnect } from "@/lib/copytrade/live";
import { rateLimit } from "@/lib/locks";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** GET — whether brokers are set up here, and the person's connected accounts (Pro). */
export async function GET() {
  return guarded(async (user) => {
    const setup = brokerSetup();
    if (!setup.ready || !(await canUse(user, "copytrade.broker"))) return NextResponse.json({ setup, connected: false, accounts: [] });
    return NextResponse.json({ setup, ...(await accounts(user)) });
  });
}

/** POST { reconnect? } — a link to SnapTrade's connection portal. Starts SnapTrade's monthly charge for this person on first use. Pro. */
export async function POST(req: Request) {
  if (!sameSiteJson(req)) return NextResponse.json(CROSS_SITE, { status: 403 });
  return guarded(async (user) => {
    await rateLimit(`copy-connect:${user.id}`, 5, 60_000, "Too many connection attempts. Wait a moment and try again.");
    const body = (await req.json().catch(() => ({}))) as { reconnect?: unknown };
    return NextResponse.json({ url: await connectLink(user, requestMeta(req), typeof body.reconnect === "string" ? body.reconnect : undefined) });
  });
}

/** DELETE — disconnect every broker (deletes the SnapTrade user) and pause live copies. */
export async function DELETE(req: Request) {
  if (!sameSiteJson(req)) return NextResponse.json(CROSS_SITE, { status: 403 });
  return guarded(async (user) => {
    await disconnect(user, requestMeta(req));
    return NextResponse.json({ ok: true });
  });
}
