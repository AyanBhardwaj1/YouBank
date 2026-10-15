import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { liveAdapter } from "@/lib/algo/connections";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** GET ?ref= — the accounts behind a connection, with type, trading permission and what the broker's API supports. */
export async function GET(req: Request) {
  return guarded(async (user) => {
    const ref = new URL(req.url).searchParams.get("ref") ?? "";
    if (ref === "paper") return NextResponse.json({ accounts: [{ id: "paper", name: "YouBank paper account", number: "", paper: true, type: "cash", tradingAllowed: true }], capabilities: null });
    const a = await liveAdapter(user.id, ref, null);
    if (!a) return NextResponse.json({ error: "That connection was not found." }, { status: 404 });
    return NextResponse.json({ accounts: await a.adapter.accounts(), capabilities: a.adapter.capabilities() });
  });
}
