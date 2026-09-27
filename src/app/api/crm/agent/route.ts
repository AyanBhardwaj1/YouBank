import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { runAgent } from "@/lib/crm/run";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Run the agent now: scan for suggestions, then draft what nurture rules and live campaigns have due. */
export async function POST() {
  return guarded(async (user) => NextResponse.json(await runAgent(user.id, Date.now() + 250_000)));
}
