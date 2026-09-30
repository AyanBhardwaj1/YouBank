/**
 * The AI builder: a goal in plain words becomes a canvas. The model sees the blocks that are available
 * (their ports and settings) and answers with blocks and wires; everything it returns is checked, and
 * wires that do not fit are dropped with a note, so a bad answer never produces a broken canvas.
 */
import { z } from "zod";
import { structured } from "@/lib/ai/agent";
import { accepts, layout, makeNode, NODE, NODES, validate, wire, type Graph, type Issue } from "./catalog";

const Built = z.object({
  title: z.string().describe("a short title for the canvas"),
  nodes: z.array(z.object({
    key: z.string().describe("a short id like 'companies' or 'earth'"),
    type: z.string().describe("one of the block types listed"),
    config: z.record(z.string(), z.unknown()).optional().describe("settings by field key; omit to use defaults"),
  })).min(1).max(12),
  wires: z.array(z.object({ from: z.string(), fromPort: z.string(), to: z.string(), toPort: z.string() })),
  explanation: z.string().describe("two sentences on how the canvas answers the goal"),
});

export type BuiltCanvas = z.infer<typeof Built>;

/** The block catalog as the model reads it. Pure. */
export function catalogPrompt(available: Set<string>): string {
  return NODES.filter((d) => available.has(d.type)).map((d) => {
    const ins = d.inputs.map((p) => `${p.name} <- ${p.kinds.join("|")}${p.required ? " (required)" : ""}${p.multi ? " (many)" : ""}`).join("; ") || "none";
    const outs = d.outputs.map((o) => `${o.name} -> ${o.kind}`).join("; ") || "none";
    const fields = d.fields.map((f) => `${f.key} (${f.type}${"options" in f ? `: ${f.options.map((o) => o.value).join("/")}` : ""})`).join(", ") || "none";
    return `- ${d.type}: ${d.blurb}. inputs: ${ins}. outputs: ${outs}. settings: ${fields}.`;
  }).join("\n");
}

/** Only settings a block knows, with values of the right shape. Pure. */
export function cleanConfig(type: string, config: Record<string, unknown> | undefined): Record<string, unknown> {
  const def = NODE[type];
  if (!def || !config) return {};
  const out: Record<string, unknown> = {};
  for (const f of def.fields) {
    const v = config[f.key];
    if (v === undefined || v === null) continue;
    if (f.type === "tickers") {
      const list = (Array.isArray(v) ? v : String(v).split(/[\s,]+/)).map((t) => String(t).trim().toUpperCase()).filter((t) => /^[A-Z][A-Z0-9.\-]{0,9}$/.test(t));
      if (list.length) out[f.key] = list.slice(0, 12);
    } else if (f.type === "number") {
      const n = Number(v);
      if (Number.isFinite(n)) out[f.key] = Math.max(f.min, Math.min(f.max, n));
    } else if (f.type === "toggle") out[f.key] = v === true || v === "true";
    else if (f.type === "select") { if (f.options.some((o) => o.value === v)) out[f.key] = v; }
    else if (f.type === "multiselect") {
      const list = (Array.isArray(v) ? v : [v]).filter((x) => f.options.some((o) => o.value === x));
      if (list.length) out[f.key] = list;
    } else out[f.key] = String(v).slice(0, 1000);
  }
  return out;
}

/** The model's answer as a canvas: unknown blocks dropped, bad wires dropped with a note, laid out. Pure. */
export function assemble(b: BuiltCanvas, available: Set<string>): { graph: Graph; dropped: string[] } {
  const dropped: string[] = [];
  const ids = new Map<string, string>();
  const used = new Set<string>();
  const nodes = b.nodes.flatMap((n, i) => {
    if (!NODE[n.type] || !available.has(n.type)) { dropped.push(`block ${n.type}`); return []; }
    let id = (n.key || `n${i}`).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 24) || `n${i}`;
    if (used.has(id)) id = `${id}${i}`;
    used.add(id);
    ids.set(n.key, id);
    return [makeNode(n.type, cleanConfig(n.type, n.config), id)];
  });
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges = b.wires.flatMap((w) => {
    const s = byId.get(ids.get(w.from) ?? ""), t = byId.get(ids.get(w.to) ?? "");
    const out = s && NODE[s.type].outputs.find((o) => o.name === w.fromPort);
    const port = t && NODE[t.type].inputs.find((p) => p.name === w.toPort);
    if (!s || !t || !out || !port || !accepts(port, out.kind)) { dropped.push(`wire ${w.from}.${w.fromPort} to ${w.to}.${w.toPort}`); return []; }
    return [wire(s.id, out.name, t.id, port.name)];
  });
  return { graph: layout({ nodes, edges }), dropped };
}

export async function buildFromPrompt(goal: string, available: Set<string>, ctx: { tickers: string[] }): Promise<{ title: string; graph: Graph; explanation: string; issues: Issue[]; dropped: string[] }> {
  const r = await structured(Built, "edge-canvas-build",
    "You design analysis canvases for investment professionals in YouBank Edge. Use only the block types listed, wire outputs only into inputs that accept their kind, give required inputs a wire, and fill settings a goal implies (tickers, questions, drivers). Prefer small canvases (3 to 7 blocks) that end in an output block. Never invent block types, ports or settings.",
    `Blocks available:\n${catalogPrompt(available)}\n\nThe person watches: ${ctx.tickers.join(", ") || "nothing yet"}.\n\nGoal: ${goal.slice(0, 1500)}`,
    { maxTokens: 2500, timeoutMs: 90_000 });
  const { graph, dropped } = assemble(r.data, available);
  return { title: r.data.title.slice(0, 120) || "New canvas", graph, explanation: r.data.explanation.slice(0, 600), issues: validate(graph, available), dropped };
}
