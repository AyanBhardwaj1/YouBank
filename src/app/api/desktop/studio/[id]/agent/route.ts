import { NextResponse } from "next/server";
import { requireFeature } from "@/lib/billing/entitlements";
import { guardedDesktop } from "@/lib/desktop/auth";
import { lease } from "@/lib/locks";
import { runStudioAgent, type StudioStreamEvent } from "@/lib/studio/agent";
import { lastEventId, requireDoc } from "@/lib/studio/db";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * An AI edit to a local Office file, which the person asked for in the desktop app: the app has
 * already pushed the file, so the Studio agent works on exactly what is on disk; when it finishes, the
 * app pulls the result back into the file (after keeping a backup). Premium (`desktop.office_agent`),
 * checked before the agent starts. One run per document at a time, as in Studio.
 * Answers once, at the end, with the agent's summary: the app shows progress itself.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guardedDesktop(req, async (user) => {
    const id = Number((await ctx.params).id);
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "bad id" }, { status: 400 });
    const body = (await req.json().catch(() => null)) as { instruction?: string; effort?: "fast" | "balanced" | "thorough" } | null;
    const instruction = body?.instruction?.trim();
    if (!instruction) return NextResponse.json({ error: "Say what to change." }, { status: 400 });
    await requireDoc(user, id, "edit");
    await requireFeature(user, "desktop.office_agent");
    const release = await lease(`studio-agent:${id}`, 330_000);
    if (!release) return NextResponse.json({ error: "The agent is already working on this document. Wait for it to finish." }, { status: 409 });
    let summary = "", error = "", stats: Record<string, number> = {};
    try {
      await runStudioAgent({
        user, docId: id, instruction: instruction.slice(0, 8000), effort: body?.effort, signal: req.signal,
        emit: (e: StudioStreamEvent) => {
          if (e.t === "error") error = e.message;
          else if (e.t === "done") { summary = e.summary; stats = e.stats; }
        },
      });
    } finally {
      await release();
    }
    return NextResponse.json({ summary, error: summary ? "" : error, stats, cursor: await lastEventId(id) });
  }, { device: "required" });
}
