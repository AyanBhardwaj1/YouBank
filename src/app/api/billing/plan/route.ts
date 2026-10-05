import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { entitlements } from "@/lib/billing/entitlements";

export const dynamic = "force-dynamic";

/** This person's plan and the premium features it unlocks. */
export async function GET() {
  return guarded(async (user) => NextResponse.json(await entitlements(user)));
}
