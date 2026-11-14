import { NextResponse } from "next/server";
import { fromWorker } from "@/lib/cloudflare/worker";
import { agentSchedule, tickAgent } from "@/lib/edge/agent/store";
import { handled } from "@/lib/errors";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST { id } — from a thesis's Cloudflare agent (cloudflare/src/thesis.ts) when its alarm fires: run a slice
 * of the thesis's due tick here, where its tools, models and data live, and say what to do next: run again
 * at once (`done: false`), sleep until `nextTickAt`, or stop (the thesis is no longer running).
 */
export async function POST(req: Request) {
  if (!fromWorker(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return handled(async () => {
    const b = (await req.json().catch(() => ({}))) as { id?: unknown };
    const id = Number(b.id);
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Which thesis?" }, { status: 400 });
    const r = await tickAgent(id, Date.now() + 45_000);
    const s = await agentSchedule(id);
    return NextResponse.json({ done: r.done, reason: r.reason ?? null, status: s?.status ?? "gone", nextTickAt: s?.nextTickAt ?? null });
  });
}
