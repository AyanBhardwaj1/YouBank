import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { requireFeature } from "@/lib/billing/entitlements";
import { rateLimit } from "@/lib/locks";
import { duneResults } from "@/lib/crypto/dune";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Premium: a saved Dune query's latest results, on request. The plan is checked before Dune is called. */
export async function POST(req: Request) {
  return guarded(async (user) => {
    await requireFeature(user, "crypto.dune");
    // Any public query id can be read and each new one costs Dune credits: a per-person ceiling bounds the spend.
    await rateLimit(`crypto-dune:${user.id}`, 30, 3_600_000, "Many Dune queries this hour; try again later.");
    const b = (await req.json().catch(() => null)) as { queryId?: number | string } | null;
    const id = Number(String(b?.queryId ?? "").replace(/^.*queries\//, "").replace(/\D.*$/, ""));
    return NextResponse.json(await duneResults(id));
  });
}
