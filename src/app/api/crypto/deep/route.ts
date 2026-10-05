import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { requireFeature } from "@/lib/billing/entitlements";
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
    if (!deepConfigured()) return NextResponse.json({ error: "Deep analytics is not connected for this workspace yet (an administrator adds an Alchemy or Helius key)." }, { status: 503 });
    const b = (await req.json().catch(() => null)) as { address?: string } | null;
    return NextResponse.json(await deepWallet(String(b?.address ?? "").slice(0, 120)));
  });
}
