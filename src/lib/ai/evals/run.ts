/**
 * Run one eval or audit question through the same chat agent people use (runChat), and keep what is
 * needed to score it and to audit it: the answer, its sources, every tool call's raw output and the figure
 * report. Needs the model keys and the database, so it runs from scripts on a machine with .env.local.
 */
import { runChat } from "../agent";
import type { FigureReport, ToolRecord } from "../figures";
import type { Source } from "../tools";
import type { Question } from "./score";

/**
 * The "free EDGAR connector" comparison: a frontier model with filing search and filing text but none of
 * YouBank's structured XBRL, comps or market tools. A proxy for a general assistant with a free SEC MCP
 * server, run inside our own loop.
 */
export const FILING_TEXT_ONLY = ["search_companies", "get_recent_filings", "search_filing", "read_filing", "edgar_fulltext_search", "calc"];

export type RunOptions = { model?: string; effort?: "low" | "medium" | "high" | "xhigh"; tools?: string[]; deadlineMs?: number };
export type RunResult = { id: string; text: string; sources: Source[]; records: ToolRecord[]; figures: FigureReport | null; errors: string[]; ms: number; model: string };

export async function runQuestion(q: Pick<Question, "id" | "ticker" | "question">, opts: RunOptions = {}): Promise<RunResult> {
  const t0 = Date.now();
  const errors: string[] = [];
  let model = opts.model ?? "";
  const r = await runChat({
    messages: [{ role: "user", content: q.question }],
    context: { ticker: q.ticker, panels: [] },
    override: { ...(opts.model ? { model: opts.model } : {}), ...(opts.effort ? { effort: opts.effort } : {}) },
    ...(opts.tools ? { tools: opts.tools } : {}),
    parallelTools: true, feature: "eval-agent", maxTurns: 12,
    deadline: Date.now() + (opts.deadlineMs ?? 240_000),
    // Agent error events are already written for people (describeError), so they are kept as sent.
    emit: (ev) => { if (ev.type === "error") errors.push(ev.message); if (ev.type === "done") model = ev.model; },
  });
  return { id: q.id, text: r.text, sources: r.sources, records: r.records ?? [], figures: r.figures ?? null, errors, ms: Date.now() - t0, model };
}
