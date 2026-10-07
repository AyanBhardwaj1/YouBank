import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { requireFeature } from "@/lib/billing/entitlements";
import { rateLimit } from "@/lib/locks";
import { deepConfigured, deepWallet } from "@/lib/crypto/deep";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Premium deep wallet analytics, started by a click. The plan is checked before any paid indexer is
 * called; nothing calls this route on its own (no prefetch, no cron).
 */
export async function POST(req: Request) {
  return guarded(async (user) => {
    await requireFeature(user, "crypto.wallet-deep");
    // Each run bills the indexers; a per-person ceiling keeps a script or a stuck button from running up the bill.
    await rateLimit(`crypto-deep:${user.id}`, 20, 3_600_000, "Deep analytics has run many times this hour; try again later.");
    if (!deepConfigured()) return NextResponse.json({ error: "Deep analytics is not connected for this workspace yet (an administrator adds an Alchemy or Helius key)." }, { status: 503 });
    const b = (await req.json().catch(() => null)) as { address?: string } | null;
    return NextResponse.json(await deepWallet(String(b?.address ?? "").slice(0, 120)));
  });
}
