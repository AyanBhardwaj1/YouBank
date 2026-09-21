import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { guarded } from "@/lib/auth/user";
import { toolById } from "@/lib/workflows/registry";
import { WorkflowOutput } from "@/lib/workflows/types";

export const dynamic = "force-dynamic";

/** Saved runs for the signed-in user (newest first). ?tool=<id> filters by tool. */
export async function GET(req: Request) {
  return guarded(async (user) => {
    const url = new URL(req.url);
    const tool = url.searchParams.get("tool");
    const limit = Math.min(100, Number(url.searchParams.get("limit") ?? 50));
    const where = tool ? and(eq(schema.workflowRuns.userId, user.id), eq(schema.workflowRuns.toolId, tool)) : eq(schema.workflowRuns.userId, user.id);
    const rows = await requireDb().select({ id: schema.workflowRuns.id, toolId: schema.workflowRuns.toolId, title: schema.workflowRuns.title, inputs: schema.workflowRuns.inputs, model: schema.workflowRuns.model, provider: schema.workflowRuns.provider, status: schema.workflowRuns.status, durationMs: schema.workflowRuns.durationMs, createdAt: schema.workflowRuns.createdAt })
      .from(schema.workflowRuns).where(where).orderBy(desc(schema.workflowRuns.createdAt)).limit(limit);
    return NextResponse.json(rows);
  });
}

/** Save a calculator result (AI runs are saved by the run route). */
export async function POST(req: Request) {
  return guarded(async (user) => {
    const body = (await req.json().catch(() => null)) as { toolId?: string; inputs?: Record<string, unknown>; output?: unknown } | null;
    const tool = body?.toolId ? toolById(body.toolId) : undefined;
    if (!tool) return NextResponse.json({ error: "Unknown tool" }, { status: 404 });
    const parsed = WorkflowOutput.safeParse(body?.output);
    if (!parsed.success) return NextResponse.json({ error: "Invalid output" }, { status: 400 });
    const [row] = await requireDb().insert(schema.workflowRuns).values({ userId: user.id, toolId: tool.id, title: parsed.data.title, inputs: body?.inputs ?? {}, output: parsed.data, provider: "calc", model: "deterministic", status: "done" }).returning({ id: schema.workflowRuns.id });
    return NextResponse.json({ id: row.id });
  });
}
