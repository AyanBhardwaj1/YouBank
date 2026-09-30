import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { cacheGet, cacheSet } from "@/lib/cache";
import { requireEdge } from "@/lib/edge/access";
import { eventProposals, tailRisks } from "@/lib/edge/scen/drivers";
import { rateLimit } from "@/lib/locks";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Scenarios to run: proposed from live events (?kind=event) or AI-imagined tail risks (?kind=tail), for ?tickers=A,B. */
export async function GET(req: Request) {
  return guarded(async (user) => {
    await requireEdge(user.id);
    const q = new URL(req.url).searchParams;
    const kind = q.get("kind") === "tail" ? "tail" : "event";
    const tickers = (q.get("tickers") ?? "").toUpperCase().split(",").map((t) => t.trim()).filter((t) => /^[A-Z][A-Z0-9.\-]{0,9}$/.test(t)).slice(0, 8).sort();
    const key = `edge:scen:proposals:${kind}:${tickers.join(",")}`;
    const hit = await cacheGet(key);
    if (hit) return NextResponse.json(JSON.parse(hit));
    await rateLimit(`edge-scen-proposals:${user.id}`, 20, 3_600_000, "Many proposals this hour; try again later.");
    const proposals = kind === "tail" ? await tailRisks(tickers) : await eventProposals(tickers);
    const out = { kind, proposals, at: new Date().toISOString() };
    await cacheSet(key, JSON.stringify(out), kind === "tail" ? 6 * 3_600_000 : 3_600_000);
    return NextResponse.json(out);
  });
}
