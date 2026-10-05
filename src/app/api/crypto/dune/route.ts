import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { requireFeature } from "@/lib/billing/entitlements";
import { duneResults } from "@/lib/crypto/dune";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Premium: a saved Dune query's latest results, on request. The plan is checked before Dune is called. */
export async function POST(req: Request) {
  return guarded(async (user) => {
    await requireFeature(user, "crypto.dune");
    const b = (await req.json().catch(() => null)) as { queryId?: number | string } | null;
    const id = Number(String(b?.queryId ?? "").replace(/^.*queries\//, "").replace(/\D.*$/, ""));
    return NextResponse.json(await duneResults(id));
  });
}
