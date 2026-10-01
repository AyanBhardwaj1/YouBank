import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { isAdmin } from "@/lib/auth/admin";
import { upgradesReport } from "@/lib/edge/premium";

export const dynamic = "force-dynamic";

/** Edge's paid upgrades and which are on (administrators only: it names the settings behind them, never their values). */
export async function GET() {
  return guarded(async (user) => {
    if (!isAdmin(user)) return NextResponse.json({ error: "Only administrators can see Edge's upgrades." }, { status: 403 });
    return NextResponse.json({ upgrades: upgradesReport() }, { headers: { "cache-control": "private, no-store" } });
  });
}
