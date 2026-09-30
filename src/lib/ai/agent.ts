import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { z } from "zod";
import { resolveAi, type AiConfig, type AiOverride, type Effort } from "./config";
import type { AiPrefs } from "./models";
import { INFERENCE_TOOLS } from "./inference-tools";
import { ALL_TOOLS, runTool, type Source, type ToolCtx, type ToolDef } from "./tools";

/** Research tools plus the terminal's models (risk, credit, quality, forecasts, cost of capital, macro, screener). */
const CHAT_TOOLS = [...ALL_TOOLS, ...INFERENCE_TOOLS];
import { contextBlock, systemPrompt, type PromptContext } from "./prompts";
import { aiBlocked, guardAi, takeRunSlot } from "./limits";
import { addUsage, costOf, emptyUsage, type Usage } from "./pricing";
import { routeFor, type AiTask } from "./route";
import { aiUser, recordUsage } from "./usage";

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
  /** Tools bound to one task (Studio's workbook tools), offered alongside the named data tools. */
  extraTools?: ToolDef[];
  /** Stop between turns when the person cancels. */
  signal?: AbortSignal;
  /** Context that changes per request (ticker, open panels, the workbook overview). Sent after the stable system prompt so the prompt cache still hits. */
  volatile?: string;
  /** Run a turn's tool calls concurrently. Only for read-only tools. */
  parallelTools?: boolean;
  /** For the usage ledger, e.g. "terminal-ai", "tool:dcf", "studio". */
  feature?: string;
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
  const userId = aiUser();
  const blocked = await aiBlocked(userId);
  if (blocked) { opts.emit({ type: "error", message: blocked }); return { text: "", sources: [] }; }
  const release = await takeRunSlot(userId);
  if (typeof release === "string") { opts.emit({ type: "error", message: release }); return { text: "", sources: [] }; }
  const system = opts.system ?? systemPrompt();
  const volatile = opts.volatile ?? (opts.system ? undefined : contextBlock(opts.context));
  const { ctx, sources } = makeCtx();
  const tools = [...(opts.tools ? CHAT_TOOLS.filter((t) => opts.tools!.includes(t.name)) : opts.extraTools ? [] : CHAT_TOOLS), ...(opts.extraTools ?? [])];
  let text = "";
  const usage = { total: emptyUsage() };
  // The run's cost is recorded once at the end, so between turns the limits count it as pending.
  const budget = () => aiBlocked(userId, costOf(cfg.model, usage.total) ?? 0);
  const run: LoopArgs = { cfg, system, volatile, history: opts.messages, toolDefs: tools, ctx, emit: opts.emit, json: opts.json, maxTurns: opts.maxTurns ?? 10, deadline: opts.deadline, signal: opts.signal, parallel: !!opts.parallelTools, usage, budget };
  try {
    text = cfg.provider === "openai" ? await runOpenAI(run) : await runAnthropic(run);
  } catch (e) {
    opts.emit({ type: "error", message: describeError(e) });
  } finally {
    await release();
  }
  recordUsage({ feature: opts.feature ?? "chat", provider: cfg.provider, model: cfg.model, effort: cfg.effort, usage: usage.total });
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

type LoopArgs = {
  cfg: AiConfig; system: string; volatile?: string; history: ChatMessage[]; toolDefs: ToolDef[]; ctx: ToolCtx; emit: (e: AgentEvent) => void;
  json: JsonFormat | undefined; maxTurns: number; deadline?: number; signal?: AbortSignal; parallel: boolean; usage: { total: Usage };
  /** Why the run must stop before its next turn (a spend limit), or null. */
  budget?: () => Promise<string | null>;
};

/** Checked before every turn after the first: a run that crosses a spend limit ends with what it has. */
async function overBudget(a: LoopArgs, turn: number): Promise<boolean> {
  const why = turn > 0 && a.budget ? await a.budget() : null;
  if (why) a.emit({ type: "error", message: why });
  return !!why;
}

/** Run a turn's tool calls, concurrently when the tools are read-only, emitting start and end events. */
async function runCalls<T extends { name: string; input: unknown }>(calls: T[], a: Pick<LoopArgs, "ctx" | "toolDefs" | "emit" | "parallel">): Promise<{ output: string; isError: boolean }[]> {
  const one = async (c: T) => {
    a.emit({ type: "tool", name: c.name, status: "start", summary: summarizeInput(c.input) });
    const r = await runTool(c.name, c.input, a.ctx, a.toolDefs);
    a.emit({ type: "tool", name: c.name, status: "end", summary: summarizeInput(c.input) });
    return r;
  };
  if (a.parallel && calls.length > 1) return Promise.all(calls.map(one));
  const out: { output: string; isError: boolean }[] = [];
  for (const c of calls) out.push(await one(c));
  return out;
}

async function runOpenAI(a: LoopArgs): Promise<string> {
  const { cfg, system, history, toolDefs, ctx, emit, json, maxTurns, deadline, signal } = a;
  const client = new OpenAI({ apiKey: cfg.apiKey });
  // With native web search available, the web_research function tool is redundant on OpenAI.
  const fnDefs = NATIVE_WEB_SEARCH ? toolDefs.filter((t) => t.name !== "web_research") : toolDefs;
  const tools: OpenAI.Responses.Tool[] = [
    ...fnDefs.map((t): OpenAI.Responses.FunctionTool => ({ type: "function", name: t.name, description: t.description, parameters: t.parameters, strict: false })),
    ...(NATIVE_WEB_SEARCH && toolDefs.some((t) => t.name === "web_research") ? [{ type: "web_search" as const }] : []),
  ];
  const supportsEffort = !/^gpt-4/.test(cfg.model);
  // The stable instructions are the cached prefix; per-request context rides in the first input item.
  let input: OpenAI.Responses.ResponseInput = [...(a.volatile ? [{ role: "developer" as const, content: a.volatile }] : []), ...history.map((m) => ({ role: m.role, content: m.content }))];
  let previous: string | undefined;
  let finalText = "";
  let useSummary = true;

  for (let turn = 0; turn < maxTurns; turn++) {
    if (signal?.aborted) { emit({ type: "status", text: "stopped" }); return finalText; }
    if (await overBudget(a, turn)) return finalText;
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
        case "response.completed": {
          completed = ev.response;
          const u = ev.response.usage;
          if (u) a.usage.total = addUsage(a.usage.total, { input: u.input_tokens ?? 0, cached: u.input_tokens_details?.cached_tokens ?? 0, cacheWrite: 0, output: u.output_tokens ?? 0, reasoning: u.output_tokens_details?.reasoning_tokens ?? 0 });
          break;
        }
        case "response.incomplete": emit({ type: "error", message: `Response incomplete: ${ev.response.incomplete_details?.reason ?? "unknown"}` }); completed = ev.response; break;
        case "response.failed": throw new Error(ev.response.error?.message ?? "Response failed");
        case "error": throw new Error((ev as { message?: string }).message ?? "Stream error");
      }
    }
    finalText = text;
    if (calls.length === 0 || !completed || overdue) return finalText;
    const parsedCalls = calls.map((c) => { let input: unknown = {}; try { input = c.args ? JSON.parse(c.args) : {}; } catch { input = { INVALID_JSON: c.args }; } return { ...c, input }; });
    const results = await runCalls(parsedCalls, a);
    const outputs: OpenAI.Responses.ResponseInputItem.FunctionCallOutput[] = parsedCalls.map((c, i) => ({ type: "function_call_output", call_id: c.call_id, output: results[i].output.slice(0, 120_000) }));
    previous = completed.id;
    input = outputs;
  }
  emit({ type: "error", message: "Stopped after the maximum number of tool turns." });
  return finalText;
}

/* ---------------- Anthropic (Messages API, streaming manual loop) ---------------- */

/**
 * Thinking and effort for a Claude model. Claude 5 models think adaptively and take effort through
 * output_config (they reject budget_tokens with a 400); Claude 4.5 models only support extended
 * thinking with a token budget.
 */
function claudeThinking(model: string, effort: Effort): { thinking?: Anthropic.ThinkingConfigParam; output_config?: { effort: Effort }; maxTokens: number } {
  const legacy = /-4-5|-4-1|-4-2|claude-3/.test(model);
  if (legacy) {
    const budget = { low: 0, medium: 6000, high: 16000, xhigh: 32000 }[effort];
    return budget ? { thinking: { type: "enabled", budget_tokens: budget }, maxTokens: budget + 8000 } : { maxTokens: 8000 };
  }
  return { thinking: { type: "adaptive", display: "summarized" }, output_config: { effort }, maxTokens: effort === "low" ? 16000 : 32000 };
}

async function runAnthropic(a: LoopArgs): Promise<string> {
  const { cfg, system, history, toolDefs, emit, json, maxTurns, deadline, signal } = a;
  const client = new Anthropic({ apiKey: cfg.apiKey });
  const tools: Anthropic.Tool[] = toolDefs.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters as Anthropic.Tool.InputSchema, eager_input_streaming: true }));
  const messages: Anthropic.MessageParam[] = history.map((m) => ({ role: m.role, content: m.content }));
  const think = claudeThinking(cfg.model, cfg.effort);
  let jsonRetries = 0;
  let finalText = "";

  for (let turn = 0; turn < maxTurns; turn++) {
    if (signal?.aborted) { emit({ type: "status", text: "stopped" }); return finalText; }
    if (await overBudget(a, turn)) return finalText;
    const overdue = deadline !== undefined && Date.now() > deadline;
    if (overdue) {
      emit({ type: "status", text: "time budget reached, writing the answer from what was gathered" });
      messages.push({ role: "user", content: OVERDUE_NUDGE });
    }
    const stream = client.messages.stream({
      model: cfg.model,
      max_tokens: think.maxTokens,
      // Stable system prompt (cached), then the per-request context, then an automatic breakpoint on the growing conversation.
      system: [
        { type: "text", text: system + (json ? `\n\nFinal answer format: reply with JSON only, matching this schema:\n${JSON.stringify(json.schema)}` : ""), cache_control: { type: "ephemeral" } },
        ...(a.volatile ? [{ type: "text" as const, text: a.volatile }] : []),
      ],
      cache_control: { type: "ephemeral" },
      tools: overdue ? [] : tools,
      messages,
      ...(think.thinking ? { thinking: think.thinking } : {}),
      ...(think.output_config ? { output_config: think.output_config } : {}),
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
    const mu = message.usage;
    a.usage.total = addUsage(a.usage.total, { input: (mu.input_tokens ?? 0) + (mu.cache_read_input_tokens ?? 0) + (mu.cache_creation_input_tokens ?? 0), cached: mu.cache_read_input_tokens ?? 0, cacheWrite: mu.cache_creation_input_tokens ?? 0, output: mu.output_tokens ?? 0, reasoning: 0 });
    if (message.stop_reason === "refusal") { emit({ type: "error", message: "The model declined this request." }); return finalText; }
    if (message.stop_reason === "pause_turn") { messages.push({ role: "assistant", content: message.content }); continue; }
    const toolUses = message.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (toolUses.length === 0 || overdue) return finalText;
    if (message.stop_reason === "max_tokens") { emit({ type: "error", message: "Response truncated (max_tokens)." }); return finalText; }
    messages.push({ role: "assistant", content: message.content });
    const outs = await runCalls(toolUses.map((tu) => ({ name: tu.name, input: tu.input })), a);
    const results: Anthropic.ToolResultBlockParam[] = toolUses.map((tu, i) => ({ type: "tool_result", tool_use_id: tu.id, content: outs[i].output.slice(0, 120_000), ...(outs[i].isError ? { is_error: true } : {}) }));
    messages.push({ role: "user", content: results });
  }
  emit({ type: "error", message: "Stopped after the maximum number of tool turns." });
  return finalText;
}

/* ---------------- Structured one-shot calls (no tools) ---------------- */

/** A file sent with a structured call: a PDF, or a PNG, JPEG, WebP or GIF image. `data` is base64. */
export type Attachment = { name: string; mime: string; data: string };

export async function structured<T>(schema: z.ZodType<T>, name: string, system: string, prompt: string, opts?: { prefs?: AiPrefs | null; override?: AiOverride; files?: Attachment[]; maxTokens?: number; task?: AiTask; /** Give up after this long (background jobs); the SDK default is ten minutes. */ timeoutMs?: number }): Promise<{ data: T; provider: string; model: string }> {
  const cfg = resolveAi(opts?.prefs, routeFor(opts?.task, opts?.prefs, opts?.override));
  if (cfg.provider === "none") throw new Error(cfg.reason);
  await guardAi(aiUser());
  const jsonSchema = z.toJSONSchema(schema) as Record<string, unknown>;
  const files = opts?.files ?? [];
  if (cfg.provider === "openai") {
    const client = new OpenAI({ apiKey: cfg.apiKey, ...(opts?.timeoutMs ? { timeout: opts.timeoutMs, maxRetries: 1 } : {}) });
    const input: string | OpenAI.Responses.ResponseInput = files.length
      ? [{
          role: "user",
          content: [
            ...files.map((f): OpenAI.Responses.ResponseInputContent => (f.mime === "application/pdf"
              ? { type: "input_file", filename: f.name, file_data: `data:${f.mime};base64,${f.data}` }
              : { type: "input_image", image_url: `data:${f.mime};base64,${f.data}`, detail: "high" })),
            { type: "input_text", text: prompt },
          ],
        }]
      : prompt;
    const res = await client.responses.create({
      model: cfg.model, instructions: system, input,
      text: { format: { type: "json_schema", name, schema: jsonSchema, strict: false } },
      ...(/^gpt-4/.test(cfg.model) ? {} : { reasoning: { effort: cfg.effort } }),
    });
    const u = res.usage;
    recordUsage({ feature: name, provider: cfg.provider, model: cfg.model, effort: cfg.effort, usage: { input: u?.input_tokens ?? 0, cached: u?.input_tokens_details?.cached_tokens ?? 0, cacheWrite: 0, output: u?.output_tokens ?? 0, reasoning: u?.output_tokens_details?.reasoning_tokens ?? 0 } });
    return { data: schema.parse(JSON.parse(res.output_text)), provider: cfg.provider, model: cfg.model };
  }
  const client = new Anthropic({ apiKey: cfg.apiKey, ...(opts?.timeoutMs ? { timeout: opts.timeoutMs, maxRetries: 1 } : {}) });
  const content: Anthropic.ContentBlockParam[] = [
    ...files.map((f): Anthropic.ContentBlockParam => (f.mime === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: f.data }, title: f.name }
      : { type: "image", source: { type: "base64", media_type: f.mime as "image/png" | "image/jpeg" | "image/gif" | "image/webp", data: f.data } })),
    { type: "text", text: prompt },
  ];
  // Streamed, so long outputs (a data room's tables) are not cut off by the non-streaming time limit.
  const think = claudeThinking(cfg.model, cfg.effort);
  const res = await client.messages.stream({
    model: cfg.model, max_tokens: Math.max(opts?.maxTokens ?? 8000, think.maxTokens), system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }], messages: [{ role: "user", content }],
    output_config: { format: { type: "json_schema", schema: jsonSchema }, ...(think.output_config ?? {}) },
    ...(think.thinking ? { thinking: think.thinking } : {}),
  }).finalMessage();
  const mu = res.usage;
  recordUsage({ feature: name, provider: cfg.provider, model: cfg.model, effort: cfg.effort, usage: { input: (mu.input_tokens ?? 0) + (mu.cache_read_input_tokens ?? 0) + (mu.cache_creation_input_tokens ?? 0), cached: mu.cache_read_input_tokens ?? 0, cacheWrite: mu.cache_creation_input_tokens ?? 0, output: mu.output_tokens ?? 0, reasoning: 0 } });
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
