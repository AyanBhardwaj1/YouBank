import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { rateLimit } from "@/lib/locks";
import { verifyAll } from "@/lib/ledger/store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** GET: recompute every hash in the person's ledger and say whether the chain is intact. */
export async function GET() {
  return guarded(async (user) => {
    await rateLimit(`ledger-verify:${user.id}`, 30, 3_600_000, "The ledger was checked many times this hour. Try again later.");
    return NextResponse.json({ ...(await verifyAll(user.id)), at: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
  });
}
