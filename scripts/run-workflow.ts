/** Run one AI workflow end to end with its example inputs: pnpm exec tsx --env-file=.env.local scripts/run-workflow.ts <tool-id> [model] */
import { runChat } from "../src/lib/ai/agent";
import { toolById } from "../src/lib/workflows/registry";
import { workflowSystemPrompt, workflowUserPrompt } from "../src/lib/workflows/prompt";
import { WORKFLOW_OUTPUT_JSON_SCHEMA, WorkflowOutput } from "../src/lib/workflows/types";

async function main() {
  const id = process.argv[2];
  const model = process.argv[3];
  const tool = id ? toolById(id) : undefined;
  if (!tool || tool.kind !== "ai") { console.error("usage: run-workflow.ts <ai-tool-id> [model]"); process.exit(1); }
  const inputs = tool.example ?? {};
  const t0 = Date.now();
  process.stdout.write(`Running ${tool.id} with ${JSON.stringify(inputs)}\n`);
  const { text, sources } = await runChat({
    messages: [{ role: "user", content: workflowUserPrompt(tool, inputs) }],
    context: { ticker: String(inputs.ticker ?? ""), panels: [], subject: tool.title },
    system: workflowSystemPrompt(tool, "", new Date().toISOString().slice(0, 10)),
    json: { name: "workflow_output", schema: WORKFLOW_OUTPUT_JSON_SCHEMA },
    tools: tool.tools, override: { model, effort: tool.effort }, maxTurns: 16,
    emit: (e) => { if (e.type === "tool" && e.status === "start") process.stdout.write(`  ⟳ ${e.name} ${e.summary ?? ""}\n`); if (e.type === "error") process.stdout.write(`  ! ${e.message}\n`); },
  });
  const clean = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try {
    const out = WorkflowOutput.parse(JSON.parse(clean));
    console.log(`\nOK in ${((Date.now() - t0) / 1000).toFixed(0)}s: "${out.title}" with ${out.blocks.length} blocks [${out.blocks.map((b) => b.type).join(", ")}], ${sources.length} sources`);
    console.log(`Summary: ${out.summary}`);
    for (const b of out.blocks) console.log(`- ${b.type}${"title" in b && b.title ? `: ${b.title}` : ""}${b.type === "table" ? ` (${b.rows.length} rows)` : b.type === "kpis" ? ` (${b.items.map((k) => `${k.label}=${k.value}`).join("; ")})` : ""}`);
    if (out.caveats?.length) console.log(`Caveats: ${out.caveats.join(" | ")}`);
  } catch (e) {
    console.log(`\nFAILED to parse output after ${((Date.now() - t0) / 1000).toFixed(0)}s: ${(e as Error).message}\n${clean.slice(0, 1500)}`);
    process.exit(1);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
