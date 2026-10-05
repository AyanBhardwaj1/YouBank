import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { requireFeature } from "@/lib/billing/entitlements";
import { hasLlamaPro } from "@/lib/crypto/deals";
import { hasCoinGeckoPro } from "@/lib/crypto/market";
import { cryptoCompute, PRO_FNS } from "@/lib/crypto/views";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Premium: one crypto screen recomputed from the paid feeds (CoinGecko Pro, DefiLlama Pro), when a
 * person clicks "Pro data". The plan is checked first; screens never call this on load.
 */
export async function POST(req: Request) {
  return guarded(async (user) => {
    const b = (await req.json().catch(() => null)) as { fn?: string; q?: string } | null;
    const fn = String(b?.fn ?? "");
    if (!PRO_FNS.has(fn)) return NextResponse.json({ error: "Pro data is not offered for this screen" }, { status: 400 });
    await requireFeature(user, "crypto.pro-data");
    const needs = fn === "token" ? hasCoinGeckoPro() : hasLlamaPro();
    if (!needs) return NextResponse.json({ error: `Pro data for this screen is not connected yet (an administrator adds a ${fn === "token" ? "CoinGecko Pro" : "DefiLlama Pro"} key). The free data stays as it is.` }, { status: 503 });
    const params = new URLSearchParams(b?.q ? { q: String(b.q).slice(0, 60) } : {});
    return NextResponse.json(await cryptoCompute(fn, params, "pro"), { headers: { "cache-control": "no-store" } });
  });
}
