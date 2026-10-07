import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { entitlements } from "@/lib/billing/entitlements";
import { upgradesView } from "@/lib/edge/premium";

export const dynamic = "force-dynamic";

/**
 * Edge's paid upgrades as this person sees them: what each improves, whether YouBank has it switched on,
 * and whether their plan includes it. Administrators also get each upgrade's settings (names only, never
 * values) and its setup steps, and the platform settings that are not plan features; nobody else does.
 */
export async function GET() {
  return guarded(async (user) => {
    const e = await entitlements(user);
    const upgrades = upgradesView(e).filter((u) => e.admin || u.plan);
    return NextResponse.json({ admin: e.admin, plan: e.plan, upgrades }, { headers: { "cache-control": "private, no-store" } });
  });
}
