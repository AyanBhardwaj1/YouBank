import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { z } from "zod";
import { resolveAi, type AiConfig, type AiOverride } from "./config";
import type { AiPrefs } from "./models";
import { ALL_TOOLS, runTool, type Source, type ToolCtx, type ToolDef } from "./tools";
import { systemPrompt, type PromptContext } from "./prompts";

export type ChatMessage = { role: "user" | "assistant"; content: string };
export type AgentEvent =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "tool"; name: string; status: "start" | "end"; summary?: string }
  | { type: "sources"; sources: Source[] }
  | { type: "status"; text: string }
  | { type: "error"; message: string }
  | { type: "done"; provider: string; model: string; effort?: string; text: string };

export type JsonFormat = { name: string; schema: Record<string, unknown> };

export type RunOptions = {
  messages: ChatMessage[];
  context: PromptContext;
  emit: (e: AgentEvent) => void;
  prefs?: AiPrefs | null;
  override?: AiOverride;
  /** Restrict the tool set (names). Default: every tool. */
  tools?: string[];
  /** Ask for the final answer as JSON matching this schema (workflows). */
  json?: JsonFormat;
  /** Replace the default system prompt entirely (workflows pass their own). */
  system?: string;
  maxTurns?: number;
  /**
   * Absolute timestamp after which the loop stops calling tools and forces a final answer. Serverless hosts
   * kill a function at the plan duration limit, so a budget below that turns a dead request into a
   * partial but cited answer.
   */
  deadline?: number;
};

const OVERDUE_NUDGE = "Your time budget is spent. Produce the final answer now, using only what you have already gathered. Do not call any more tools. List anything you could not verify in caveats.";

const summarizeInput = (input: unknown) => { try { return JSON.stringify(input).slice(0, 140); } catch { return ""; } };

function makeCtx(): { ctx: ToolCtx; sources: Source[] } {
  const sources: Source[] = [];
  const ctx: ToolCtx = {
    addSource: (label, url) => {
      const existing = sources.find((s) => s.url === url && s.label === label) ?? sources.find((s) => s.url === url);
      if (existing) return existing.id;
      const id = `S${sources.length + 1}`;
      sources.push({ id, label, url });
      return id;
    },
  };
  return { ctx, sources };
}

/** Run one assistant turn (with tool calls) and stream events. Resolves with the final text. */
export async function runChat(opts: RunOptions): Promise<{ text: string; sources: Source[] }> {
  const cfg = resolveAi(opts.prefs, opts.override);
  if (cfg.provider === "none") { opts.emit({ type: "error", message: cfg.reason }); return { text: "", sources: [] }; }
  const system = opts.system ?? systemPrompt(opts.context);
  const { ctx, sources } = makeCtx();
  const tools = opts.tools ? ALL_TOOLS.filter((t) => opts.tools!.includes(t.name)) : ALL_TOOLS;
  let text = "";
  try {
    text = cfg.provider === "openai"
      ? await runOpenAI(cfg, system, opts.messages, tools, ctx, opts.emit, opts.json, opts.maxTurns ?? 10, opts.deadline)
      : await runAnthropic(cfg, system, opts.messages, tools, ctx, opts.emit, opts.json, opts.maxTurns ?? 10, opts.deadline);
  } catch (e) {
    opts.emit({ type: "error", message: describeError(e) });
  }
  opts.emit({ type: "sources", sources });
  opts.emit({ type: "done", provider: cfg.provider, model: cfg.model, effort: cfg.effort, text });
  return { text, sources };
}

export function describeError(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return "Anthropic: invalid API key";
  if (e instanceof Anthropic.RateLimitError) return "Anthropic: rate limited, retry shortly";
  if (e instanceof Anthropic.APIError) return `Anthropic API error ${e.status}: ${e.message}`;
  if (e instanceof OpenAI.AuthenticationError) return "OpenAI: invalid API key";
  if (e instanceof OpenAI.RateLimitError) return "OpenAI: rate limited, retry shortly";
  if (e instanceof OpenAI.APIError) return `OpenAI API error ${e.status}: ${e.message}`;
  return e instanceof Error ? e.message : String(e);
}

/* ---------------- OpenAI (Responses API: streaming, function tools, native web search, reasoning) ---------------- */

const NATIVE_WEB_SEARCH = true;

async function runOpenAI(cfg: AiConfig, system: string, history: ChatMessage[], toolDefs: ToolDef[], ctx: ToolCtx, emit: (e: AgentEvent) => void, json: JsonFormat | undefined, maxTurns: number, deadline?: number): Promise<string> {
  const client = new OpenAI({ apiKey: cfg.apiKey });
  // With native web search available, the web_research function tool is redundant on OpenAI.
  const fnDefs = NATIVE_WEB_SEARCH ? toolDefs.filter((t) => t.name !== "web_research") : toolDefs;
  const tools: OpenAI.Responses.Tool[] = [
    ...fnDefs.map((t): OpenAI.Responses.FunctionTool => ({ type: "function", name: t.name, description: t.description, parameters: t.parameters, strict: false })),
    ...(NATIVE_WEB_SEARCH && toolDefs.some((t) => t.name === "web_research") ? [{ type: "web_search" as const }] : []),
  ];
  const supportsEffort = !/^gpt-4/.test(cfg.model);
  let input: OpenAI.Responses.ResponseInput = history.map((m) => ({ role: m.role, content: m.content }));
  let previous: string | undefined;
  let finalText = "";
  let useSummary = true;

  for (let turn = 0; turn < maxTurns; turn++) {
    const overdue = deadline !== undefined && Date.now() > deadline;
    if (overdue) {
      emit({ type: "status", text: "time budget reached, writing the answer from what was gathered" });
      input = [...(Array.isArray(input) ? input : []), { role: "user", content: OVERDUE_NUDGE }];
    }
    const params: OpenAI.Responses.ResponseCreateParamsStreaming = {
      model: cfg.model, instructions: system, input, tools: overdue ? [] : tools, stream: true, store: true,
      ...(previous ? { previous_response_id: previous } : {}),
      ...(supportsEffort ? { reasoning: { effort: cfg.effort, ...(useSummary ? { summary: "auto" as const } : {}) } } : {}),
      ...(json ? { text: { format: { type: "json_schema", name: json.name, schema: json.schema, strict: false } } } : {}),
    };
    let stream: AsyncIterable<OpenAI.Responses.ResponseStreamEvent>;
    try {
      stream = await client.responses.create(params);
    } catch (e) {
      // Some models reject reasoning summaries; retry once without.
      if (useSummary && e instanceof OpenAI.APIError && /summary/i.test(e.message)) { useSummary = false; turn--; continue; }
      throw e;
    }
    let text = "";
    const calls: { call_id: string; name: string; args: string }[] = [];
    let completed: OpenAI.Responses.Response | null = null;
    for await (const ev of stream) {
      switch (ev.type) {
        case "response.output_text.delta": text += ev.delta; emit({ type: "text", text: ev.delta }); break;
        case "response.reasoning_summary_text.delta": emit({ type: "thinking", text: ev.delta }); break;
        case "response.output_text.annotation.added": {
          const a = ev.annotation as { type?: string; url?: string; title?: string };
          if (a?.type === "url_citation" && a.url) ctx.addSource(a.title || a.url, a.url);
          break;
        }
        case "response.output_item.added":
          if (ev.item.type === "web_search_call") emit({ type: "tool", name: "web_search", status: "start" });
          break;
        case "response.output_item.done":
          if (ev.item.type === "web_search_call") {
            const action = (ev.item as { action?: { query?: string } }).action;
            emit({ type: "tool", name: "web_search", status: "end", summary: action?.query ?? "" });
          } else if (ev.item.type === "function_call") calls.push({ call_id: ev.item.call_id, name: ev.item.name, args: ev.item.arguments });
          break;
        case "response.completed": completed = ev.response; break;
        case "response.incomplete": emit({ type: "error", message: `Response incomplete: ${ev.response.incomplete_details?.reason ?? "unknown"}` }); completed = ev.response; break;
        case "response.failed": throw new Error(ev.response.error?.message ?? "Response failed");
        case "error": throw new Error((ev as { message?: string }).message ?? "Stream error");
      }
    }
    finalText = text;
    if (calls.length === 0 || !completed || overdue) return finalText;
    const outputs: OpenAI.Responses.ResponseInputItem.FunctionCallOutput[] = [];
    for (const c of calls) {
      let parsed: unknown = {};
      try { parsed = c.args ? JSON.parse(c.args) : {}; } catch { parsed = { INVALID_JSON: c.args }; }
      emit({ type: "tool", name: c.name, status: "start", summary: summarizeInput(parsed) });
      const r = await runTool(c.name, parsed, ctx);
      emit({ type: "tool", name: c.name, status: "end", summary: summarizeInput(parsed) });
      outputs.push({ type: "function_call_output", call_id: c.call_id, output: r.output.slice(0, 120_000) });
    }
    previous = completed.id;
    input = outputs;
  }
  emit({ type: "error", message: "Stopped after the maximum number of tool turns." });
  return finalText;
}

/* ---------------- Anthropic (Messages API, streaming manual loop) ---------------- */

async function runAnthropic(cfg: AiConfig, system: string, history: ChatMessage[], toolDefs: ToolDef[], ctx: ToolCtx, emit: (e: AgentEvent) => void, json: JsonFormat | undefined, maxTurns: number, deadline?: number): Promise<string> {
  const client = new Anthropic({ apiKey: cfg.apiKey });
  const tools: Anthropic.Tool[] = toolDefs.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters as Anthropic.Tool.InputSchema, eager_input_streaming: true }));
  const messages: Anthropic.MessageParam[] = history.map((m) => ({ role: m.role, content: m.content }));
  const budget = { low: 2000, medium: 6000, high: 16000, xhigh: 32000 }[cfg.effort];
  let jsonRetries = 0;
  let finalText = "";

  for (let turn = 0; turn < maxTurns; turn++) {
    const overdue = deadline !== undefined && Date.now() > deadline;
    if (overdue) {
      emit({ type: "status", text: "time budget reached, writing the answer from what was gathered" });
      messages.push({ role: "user", content: OVERDUE_NUDGE });
    }
    const stream = client.messages.stream({
      model: cfg.model,
      max_tokens: Math.max(16000, budget + 8000),
      system: [{ type: "text", text: system + (json ? `\n\nFinal answer format: reply with JSON only, matching this schema:\n${JSON.stringify(json.schema)}` : ""), cache_control: { type: "ephemeral" } }],
      tools: overdue ? [] : tools,
      messages,
      ...(cfg.effort !== "low" ? { thinking: { type: "enabled", budget_tokens: budget } } : {}),
    });
    let text = "";
    stream.on("text", (delta) => { text += delta; emit({ type: "text", text: delta }); });
    stream.on("thinking", (delta) => emit({ type: "thinking", text: delta }));
    let message: Anthropic.Message;
    try {
      message = await stream.finalMessage();
      jsonRetries = 0;
    } catch (err) {
      if (err instanceof Anthropic.APIError || jsonRetries++ >= 2) throw err;
      continue;
    }
    finalText = text;
    if (message.stop_reason === "refusal") { emit({ type: "error", message: "The model declined this request." }); return finalText; }
    if (message.stop_reason === "pause_turn") { messages.push({ role: "assistant", content: message.content }); continue; }
    const toolUses = message.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (toolUses.length === 0 || overdue) return finalText;
    if (message.stop_reason === "max_tokens") { emit({ type: "error", message: "Response truncated (max_tokens)." }); return finalText; }
    messages.push({ role: "assistant", content: message.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      emit({ type: "tool", name: tu.name, status: "start", summary: summarizeInput(tu.input) });
      const r = await runTool(tu.name, tu.input, ctx);
      emit({ type: "tool", name: tu.name, status: "end", summary: summarizeInput(tu.input) });
      results.push({ type: "tool_result", tool_use_id: tu.id, content: r.output.slice(0, 120_000), ...(r.isError ? { is_error: true } : {}) });
    }
    messages.push({ role: "user", content: results });
  }
  emit({ type: "error", message: "Stopped after the maximum number of tool turns." });
  return finalText;
}

/* ---------------- Structured one-shot calls (no tools) ---------------- */

export async function structured<T>(schema: z.ZodType<T>, name: string, system: string, prompt: string, opts?: { prefs?: AiPrefs | null; override?: AiOverride }): Promise<{ data: T; provider: string; model: string }> {
  const cfg = resolveAi(opts?.prefs, opts?.override);
  if (cfg.provider === "none") throw new Error(cfg.reason);
  const jsonSchema = z.toJSONSchema(schema) as Record<string, unknown>;
  if (cfg.provider === "openai") {
    const client = new OpenAI({ apiKey: cfg.apiKey });
    const res = await client.responses.create({
      model: cfg.model, instructions: system, input: prompt,
      text: { format: { type: "json_schema", name, schema: jsonSchema, strict: false } },
      ...(/^gpt-4/.test(cfg.model) ? {} : { reasoning: { effort: cfg.effort } }),
    });
    return { data: schema.parse(JSON.parse(res.output_text)), provider: cfg.provider, model: cfg.model };
  }
  const client = new Anthropic({ apiKey: cfg.apiKey });
  const res = await client.messages.create({
    model: cfg.model, max_tokens: 8000, system, messages: [{ role: "user", content: prompt }],
    output_config: { format: { type: "json_schema", schema: jsonSchema } },
  });
  const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
  return { data: schema.parse(JSON.parse(text)), provider: cfg.provider, model: cfg.model };
}

/* ---------------- Peer proposal (kept for the comps screen) ---------------- */

export const PeerSet = z.object({
  summary: z.string(),
  core: z.array(z.object({ ticker: z.string(), name: z.string(), rationale: z.string() })),
  adjacent: z.array(z.object({ ticker: z.string(), name: z.string(), rationale: z.string() })),
});
export type PeerSetT = z.infer<typeof PeerSet>;

export function structuredJson(prompt: string, opts?: { prefs?: AiPrefs | null; override?: AiOverride }) {
  return structured(PeerSet, "peer_set", "You are an investment banking associate building trading comps. Reply with JSON only.", prompt, opts);
}
