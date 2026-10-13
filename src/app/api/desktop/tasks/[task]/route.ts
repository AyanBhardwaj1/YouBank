import { NextResponse } from "next/server";
import { guardedDesktop } from "@/lib/desktop/auth";
import { authorizeTask, isTaskId, runTask, TASKS } from "@/lib/desktop/tasks";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Run one scheduled task for the computer calling: { trigger: "schedule" | "manual" }. A task that
 * spends AI money needs the plan, and on a schedule also needs the person to have switched it on for
 * this computer (see lib/desktop/tasks). Only the desktop app may call this: a task acts for a device.
 */
export async function POST(req: Request, ctx: { params: Promise<{ task: string }> }) {
  return guardedDesktop(req, async (user, device) => {
    const id = (await ctx.params).task;
    if (!isTaskId(id)) return NextResponse.json({ error: "Unknown task" }, { status: 404 });
    const body = (await req.json().catch(() => null)) as { trigger?: unknown } | null;
    const task = TASKS[id];
    await authorizeTask(user, device, task, body?.trigger === "manual" ? "manual" : "schedule");
    return NextResponse.json({ task: id, result: await runTask(user, task) }, { headers: { "Cache-Control": "no-store" } });
  }, { device: "required" });
}
