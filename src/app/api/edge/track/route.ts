import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { requireEdge } from "@/lib/edge/access";
import { trackRecord } from "@/lib/edge/forecasts/ledger";
import { memo } from "@/lib/memo";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const KIND = /^[a-z_]{3,40}$/;

/**
 * The Track record (F3): ?kind=deal_target (or every kind). One panel per model: the reliability diagram's
 * bins, Brier against the base rates shown beside each forecast, Brier skill with a 90% bootstrap interval,
 * n, how many are still open, and the latest 20 resolved (anonymised). Shared forecasts are the same for
 * everyone, so they are computed once a quarter-hour per instance; ?mine=1 adds the person's own (manual
 * thesis claims), scored apart.
 */
export async function GET(req: Request) {
  return guarded(async (user) => {
    await requireEdge(user.id);
    const q = new URL(req.url).searchParams;
    const kind = KIND.test(q.get("kind") ?? "") ? q.get("kind")! : undefined;
    const shared = await memo(`edge:track:${kind ?? "all"}`, 15 * 60_000, () => trackRecord(kind));
    const mine = q.get("mine") === "1" ? await trackRecord(kind, { ownerId: user.id }) : [];
    return NextResponse.json({ panels: shared, mine, generatedAt: new Date().toISOString() }, { headers: { "cache-control": "private, max-age=60" } });
  });
}
