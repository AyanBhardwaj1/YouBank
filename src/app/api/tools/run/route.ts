import { runChat } from "@/lib/ai/agent";
import { currentUser } from "@/lib/auth/user";
import { loadUserContext } from "@/lib/ai/persona";
import { MODELS, type Effort } from "@/lib/ai/models";
import { toolById } from "@/lib/workflows/registry";
import { workflowSystemPrompt, workflowUserPrompt } from "@/lib/workflows/prompt";
import { WORKFLOW_OUTPUT_JSON_SCHEMA, WorkflowOutput, type Inputs } from "@/lib/workflows/types";
import { db, schema } from "@/db";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const EFFORTS = new Set(["low", "medium", "high", "xhigh"]);
const MAX_CSV = 300_000;
/** Stop calling tools this long before the host kills the function, so a slow run still returns cited output. */
const BUDGET_MS = Number(process.env.WORKFLOW_BUDGET_MS ?? 235_000);

/** Coerce and validate inputs against the tool's fields. Returns an error message or the cleaned inputs. */
function cleanInputs(fields: { key: string; type: string; required?: boolean; label: string; default?: unknown }[], raw: Record<string, unknown>): { ok: true; inputs: Inputs } | { ok: false; error: string } {
  const out: Inputs = {};
  for (const f of fields) {
    let v = raw[f.key];
    if (v === undefined || v === null || v === "") v = f.default;
    if (f.type === "ticker" && typeof v === "string") v = v.trim().toUpperCase().slice(0, 8);
    if (f.type === "tickers") v = (Array.isArray(v) ? v : String(v ?? "").split(/[\s,;]+/)).map((s) => String(s).trim().toUpperCase()).filter(Boolean).slice(0, 25);
    if (f.type === "multiselect") v = (Array.isArray(v) ? v : String(v ?? "").split(",")).map(String).filter(Boolean);
    if (f.type === "number" && typeof v === "string") { const n = Number(v.replace(/[,$%x\s]/g, "")); v = Number.isFinite(n) ? n : undefined; }
    if (f.type === "toggle") v = v === true || v === "true";
    if (f.type === "csv" && typeof v === "string" && v.length > MAX_CSV) return { ok: false, error: `${f.label} is too large (max ${MAX_CSV / 1000} KB)` };
    if (typeof v === "string" && f.type !== "csv") v = v.slice(0, 20_000);
    const empty = v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
    if (f.required && empty) return { ok: false, error: `${f.label} is required` };
    if (!empty) out[f.key] = v;
  }
  return { ok: true, inputs: out };
}

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { id?: string; inputs?: Record<string, unknown>; model?: string; effort?: string } | null;
  const tool = body?.id ? toolById(body.id) : undefined;
  if (!tool || tool.kind !== "ai") return Response.json({ error: "Unknown workflow" }, { status: 404 });
  const cleaned = cleanInputs(tool.fields, body?.inputs ?? {});
  if (!cleaned.ok) return Response.json({ error: cleaned.error }, { status: 400 });
  const { persona, prefs } = await loadUserContext(user.id);
  const override = {
    model: body?.model && MODELS.some((m) => m.id === body.model) ? body.model : undefined,
    effort: body?.effort && EFFORTS.has(body.effort) ? (body.effort as Effort) : tool.effort,
  };
  const today = new Date().toISOString().slice(0, 10);
  const encoder = new TextEncoder();
  const started = Date.now();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (e: unknown) => { try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`)); } catch { /* closed */ } };
      let provider = "", model = "";
      const { text, sources } = await runChat({
        messages: [{ role: "user", content: workflowUserPrompt(tool, cleaned.inputs) }],
        context: { ticker: String(cleaned.inputs.ticker ?? ""), panels: [], subject: tool.title, persona },
        system: workflowSystemPrompt(tool, persona, today),
        json: { name: "workflow_output", schema: WORKFLOW_OUTPUT_JSON_SCHEMA },
        tools: tool.tools, prefs, override, maxTurns: 16, deadline: started + BUDGET_MS,
        emit: (e) => { if (e.type === "done") { provider = e.provider; model = e.model; } if (e.type !== "text") emit(e); else emit({ type: "progress", chars: e.text.length }); },
      });
      const clean = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
      let output: WorkflowOutput | null = null;
      let error = "";
      try {
        output = WorkflowOutput.parse(JSON.parse(clean));
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
        if (clean) output = { title: tool.title, summary: "The model's answer could not be fully structured; the raw text is shown below.", blocks: [{ type: "markdown", text: clean.slice(0, 20_000) }], caveats: [`Structuring error: ${error.slice(0, 200)}`] };
      }
      let runId: number | null = null;
      if (db && output) {
        try {
          const [row] = await db.insert(schema.workflowRuns).values({ userId: user.id, toolId: tool.id, title: output.title, inputs: cleaned.inputs, output, sources, provider, model, status: error ? "error" : "done", error, durationMs: Date.now() - started }).returning({ id: schema.workflowRuns.id });
          runId = row?.id ?? null;
        } catch { /* saving is best-effort */ }
      }
      emit({ type: "output", output, runId, sources, provider, model, durationMs: Date.now() - started, error: output ? "" : error || "No output produced" });
      controller.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" } });
}
