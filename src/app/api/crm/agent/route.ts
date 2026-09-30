import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { runAgent } from "@/lib/crm/run";
import { claimLock, releaseLock } from "@/lib/crm/settings";
import { rateLimit } from "@/lib/locks";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Run the agent now: scan for suggestions, then draft what nurture rules and live campaigns have due. */
export async function POST() {
  return guarded(async (user) => {
    await rateLimit(`crm-agent:${user.id}`, 6, 3_600_000, "The agent has run several times this hour. It also runs on its own, so try again later.");
    // The heartbeat may be working for this person right now; never run the agent twice at once.
    if (!(await claimLock(user.id, 5))) return NextResponse.json({ error: "The agent is already working. Try again in a minute." }, { status: 409 });
    try { return NextResponse.json(await runAgent(user.id, Date.now() + 250_000)); }
    finally { await releaseLock(user.id); }
  });
}
