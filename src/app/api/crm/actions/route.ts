import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { listActions } from "@/lib/crm/actions";

export const dynamic = "force-dynamic";

/** Pending suggestions: stage moves, follow-ups, check-ins, reconnections. */
export async function GET() {
  return guarded(async (user) => NextResponse.json(await listActions(user.id)));
}
