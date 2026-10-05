import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { addAddress, costsFor, listAddresses, removeAddress, setCost } from "@/lib/crypto/store";
import { walletView } from "@/lib/crypto/wallet";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The read-only portfolio. GET: the person's saved addresses with balances, prices and risk
 * (?role=own|watch; ?address=… reads one pasted address without saving it). POST: add or remove an
 * address, or set what they paid for an asset. Addresses only: no keys, no signing, no transfers.
 */
export async function GET(req: Request) {
  return guarded(async (user) => {
    const q = new URL(req.url).searchParams;
    const one = q.get("address")?.trim();
    const role = q.get("role") === "watch" ? "watch" : "own";
    const [saved, costs] = await Promise.all([listAddresses(user.id), costsFor(user.id)]);
    const inputs = one ? [{ address: one.slice(0, 120) }] : saved.filter((a) => a.role === role).map((a) => ({ address: a.address, label: a.label }));
    const view = inputs.length ? await walletView(inputs, role === "own" ? costs : {}) : null;
    return NextResponse.json({ addresses: saved, costs, view }, { headers: { "cache-control": "no-store" } });
  });
}

export async function POST(req: Request) {
  return guarded(async (user) => {
    const b = (await req.json().catch(() => null)) as { action?: string; address?: string; label?: string; role?: string; source?: string; id?: number; asset?: string; costUsd?: number | null } | null;
    switch (b?.action) {
      case "add": return NextResponse.json({ address: await addAddress(user.id, { address: String(b.address ?? ""), label: b.label, role: b.role, source: b.source }) });
      case "remove": await removeAddress(user.id, Number(b.id)); return NextResponse.json({ ok: true });
      case "cost": await setCost(user.id, String(b.asset ?? ""), typeof b.costUsd === "number" ? b.costUsd : null); return NextResponse.json({ ok: true });
      default: return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  });
}
