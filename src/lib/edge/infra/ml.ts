/**
 * The machine-learning service on Modal (ml/edge_ml.py): foundation-model checks of satellite
 * changes (Prithvi, Segment Anything), document parsing with OCR, transcription, graph-model training,
 * synthetic data and topic maps, all on CPU inside the free credits. Short tasks answer in the request;
 * long ones start in the background and announce themselves with an `edge/ml.done` event that the
 * waiting Inngest run picks up. Every call's estimated cost is counted, and past the monthly ceiling
 * callers get a plain reason and use Edge's built-in methods instead.
 */
import { addUsage, withinFreeTier } from "./usage";

export const mlReady = () => !!(process.env.EDGE_ML_URL?.trim() && process.env.EDGE_ML_SECRET?.trim());

export type MlTask = "health" | "geo.refine" | "geo.embed_change" | "geo.footprints" | "docs.parse" | "docs.rerank" | "audio.transcribe" | "graph.train" | "synth.tabular" | "synth.series" | "topics.map";
export type MlDone = { callId: string; task: MlTask; correlation: string; ok: boolean; result?: Record<string, unknown>; error?: string; seconds?: number; costUsd?: number };

export class MlUnavailable extends Error {}

/** The status endpoint: set explicitly, or Modal's naming for the app's `status` function next to `api`. Pure. */
export function statusUrl(main: string, explicit?: string): string {
  if (explicit?.trim()) return explicit.trim();
  return main.replace(/-api(\.modal\.run)/, "-status$1");
}

async function post<T>(url: string, body: unknown, timeoutMs: number): Promise<T> {
  const res = await fetch(url, {
    method: "POST", cache: "no-store", signal: AbortSignal.timeout(timeoutMs),
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env.EDGE_ML_SECRET!.trim()}` },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`The ML service answered ${res.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text) as T;
}

async function guard(): Promise<void> {
  if (!mlReady()) throw new MlUnavailable("The ML service is not set up.");
  const free = await withinFreeTier("modal");
  if (!free.ok) throw new MlUnavailable(free.reason!);
}

/** Count a finished call's cost. */
export function noteMlCost(costUsd: number | undefined) {
  addUsage("modal", "calls", 1);
  if (costUsd && costUsd > 0) addUsage("modal", "usd", costUsd);
}

/** Run a short task and wait for its answer (cold starts can take a minute). */
export async function mlRun<T extends Record<string, unknown>>(task: MlTask, input: Record<string, unknown>, timeoutMs = 150_000): Promise<T> {
  await guard();
  const r = await post<{ ok: boolean; result?: T; error?: string; costUsd?: number }>(process.env.EDGE_ML_URL!.trim(), { task, input, async: false, correlation: "" }, timeoutMs);
  noteMlCost(r.costUsd);
  if (!r.ok || !r.result) throw new Error(r.error || `The ML task ${task} failed`);
  return r.result;
}

/** Start a long task; it announces itself with `edge/ml.done` carrying this call id and correlation. */
export async function mlStart(task: MlTask, input: Record<string, unknown>, correlation: string): Promise<string> {
  await guard();
  const r = await post<{ ok: boolean; callId?: string; error?: string }>(process.env.EDGE_ML_URL!.trim(), { task, input, async: true, correlation }, 30_000);
  if (!r.ok || !r.callId) throw new Error(r.error || `The ML task ${task} could not start`);
  addUsage("modal", "started", 1);
  return r.callId;
}

/** Ask whether a started task has finished (for the inline runner, which cannot wait on events). */
export async function mlStatus(callId: string): Promise<{ done: boolean; ok?: boolean; result?: Record<string, unknown>; error?: string; costUsd?: number; seconds?: number }> {
  if (!mlReady()) throw new MlUnavailable("The ML service is not set up.");
  return post(statusUrl(process.env.EDGE_ML_URL!.trim(), process.env.EDGE_ML_STATUS_URL), { callId }, 30_000);
}

/** The Inngest condition that matches this call's done event. */
export const doneFor = (callId: string) => `async.data.callId == "${callId.replace(/[^A-Za-z0-9_\-]/g, "")}"`;
