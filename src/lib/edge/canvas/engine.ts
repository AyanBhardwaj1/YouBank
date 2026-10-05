/**
 * Running a canvas. A run snapshots the graph, then executes it in waves (every node after the nodes
 * wired into it; nodes in a wave run side by side). Through Inngest each node is a retryable step and a
 * node that needs the ML service waits for its `edge/ml.done` event without holding a function open;
 * without Inngest (not set up, or the month's allowance spent) the same code runs inside the request and
 * polls the ML service instead. Every node records its status, the step it is on, a one-line summary, a
 * small preview for the canvas, and its outputs (big ones in R2), so the page can show data flowing.
 */
import { after } from "next/server";
import { and, eq, inArray, sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { runAsUser } from "@/lib/ai/context";
import type { CurrentUser } from "@/lib/auth/user";
import { failureMessage, logError } from "@/lib/errors";
import { rateLimit } from "@/lib/locks";
import { touch } from "@/lib/realtime/feed";
import { type MlDone, doneFor, mlStatus, noteMlCost } from "../infra/ml";
import { getJson, putJson, r2Ready, signedUrl } from "../infra/r2";
import { metered, sendJob, type Steps } from "../infra/jobs";
import { flushUsage } from "../infra/usage";
import { type CanvasNode, type Graph, NODE, validate, waves } from "./catalog";
import { canvasAccess, canvasFeed } from "./store";

export type Preview =
  | { kind: "map"; points: { lon: number; lat: number; label: string; tone?: "pos" | "neg" | "accent" | "info" }[]; bbox?: number[] }
  | { kind: "stats"; items: { label: string; value: string }[] }
  | { kind: "list"; items: { label: string; detail?: string; score?: number }[] }
  | { kind: "chart"; series: { label: string; values: number[] }[]; synthetic?: boolean }
  | { kind: "graph"; nodes: { id: string; label: string; group?: string }[]; links: { s: string; d: string }[] }
  | { kind: "text"; text: string };

export type ExecResult = { outputs: Record<string, unknown>; summary: string; preview?: Preview; costUsd?: number };
export type Wait = { calls: { callId: string; tag: string }[]; state: unknown; timeout?: string; summary?: string };
export type ExecContext = {
  runId: number; nodeId: string; userId: string; config: Record<string, unknown>;
  /** Per input port, the value on each wire into it. */
  inputs: Record<string, unknown[]>;
  progress: (step: string, summary?: string) => Promise<void>;
  deadline: number;
};
export type Executor = {
  start: (ctx: ExecContext) => Promise<ExecResult | Wait>;
  finish?: (ctx: ExecContext, state: unknown, done: (MlDone | null)[]) => Promise<ExecResult>;
};

const isWait = (r: ExecResult | Wait): r is Wait => "calls" in r;

/** Registered by the modules (see ./executors); a block is available when it has an executor. */
const executors = new Map<string, Executor>();
export function register(type: string, exec: Executor) { executors.set(type, exec); }
export const availableTypes = () => new Set(executors.keys());

/** Outputs above this many bytes go to R2 and the row keeps a pointer. */
const INLINE_BYTES = 150_000;
const RUNS_PER_HOUR = 30;
const RUNNING_AT_ONCE = 2;

type NodeState = { status: "done" | "skipped" | "failed" } | { status: "wait"; calls: { callId: string; tag: string }[]; state: unknown; timeout?: string };

/* ---------------- Starting ---------------- */

/** Start a run of a canvas. Returns the run id; the page follows it with runView. */
export async function startRun(user: CurrentUser | { id: string; email: string; name: string }, canvasId: number, trigger: "manual" | "monitor" | "onboarding" = "manual"): Promise<number> {
  const db = requireDb();
  const { row } = trigger === "manual" ? await canvasAccess(user as CurrentUser, canvasId, "edit") : { row: (await db.select().from(schema.edgeCanvases).where(eq(schema.edgeCanvases.id, canvasId)))[0] };
  if (!row) throw Object.assign(new Error("That canvas does not exist."), { status: 404 });
  const graph = row.graph as Graph;
  if (!graph.nodes.length) throw Object.assign(new Error("Add some blocks first."), { status: 400 });
  const errors = validate(graph, availableTypes()).filter((i) => i.level === "error");
  if (errors.length) throw Object.assign(new Error(`${errors[0].message} (${NODE[graph.nodes.find((n) => n.id === errors[0].nodeId)?.type ?? ""]?.label ?? "a block"})`), { status: 400 });
  if (trigger === "manual") {
    await rateLimit(`edge-run:${user.id}`, RUNS_PER_HOUR, 3_600_000, "Many canvas runs this hour. Try again in a few minutes.");
    const [busy] = (await db.execute(sql`select count(*)::int as n from edge_runs where owner_id = ${user.id} and status in ('queued', 'running') and created_at > now() - interval '30 minutes'`)).rows as { n: number }[];
    if ((busy?.n ?? 0) >= RUNNING_AT_ONCE) throw Object.assign(new Error("Two of your runs are still going; wait for one to finish."), { status: 429 });
  }
  const runId = await createRun(canvasId, row.ownerId, graph, trigger, { id: user.id, label: user.name || user.email });
  const sent = await sendJob("edge/canvas.run", { runId }, { id: `edge-run-${runId}` }).catch((e) => ({ sent: false as const, reason: String(e) }));
  if (!sent.sent) after(() => executeRun(runId, inlineSteps(Date.now() + 280_000), "inline").catch((e) => logError(e, { where: "edge-run-inline" })));
  return runId;
}

/** The run's rows: the run with its graph snapshot, and a queued step per block. */
export async function createRun(canvasId: number, ownerId: string, graph: Graph, trigger: string, by: { id: string; label: string }): Promise<number> {
  const db = requireDb();
  const [run] = await db.insert(schema.edgeRuns).values({ canvasId, ownerId, trigger, graph }).returning({ id: schema.edgeRuns.id });
  await db.insert(schema.edgeRunSteps).values(graph.nodes.map((n) => ({ runId: run.id, nodeId: n.id })));
  await db.insert(schema.edgeCanvasEvents).values({ canvasId, userId: by.id, kind: "run", label: by.label, payload: { runId: run.id, status: "queued" } });
  touch(canvasFeed(canvasId));
  return run.id;
}

/** Steps without Inngest: run now; ML waits poll the service until the request's time is nearly up. */
export function inlineSteps(deadline: number): Steps {
  return {
    run: (_id, fn) => fn(),
    waitForEvent: async (_id, opts) => {
      const callId = /"([^"]+)"/.exec(opts.if ?? "")?.[1];
      if (!callId) return null;
      while (Date.now() < deadline - 10_000) {
        const s = await mlStatus(callId).catch(() => null);
        if (s?.done) return { data: { callId, ok: !!s.ok, result: s.result, error: s.error, costUsd: s.costUsd, seconds: s.seconds } };
        await new Promise((r) => setTimeout(r, 5_000));
      }
      return null;
    },
    sleep: (_id, d) => new Promise((r) => setTimeout(r, typeof d === "number" ? d : 1000)),
  };
}

/* ---------------- Executing ---------------- */

/** Run a run to its end. `steps` are Inngest's (wrapped for metering) or the inline ones. */
export async function executeRun(runId: number, steps: Steps, mode: "inngest" | "inline"): Promise<void> {
  const s = mode === "inngest" ? metered(steps) : steps;
  const graph = await s.run("start", async () => {
    const [run] = await requireDb().update(schema.edgeRuns).set({ status: "running", startedAt: new Date() }).where(eq(schema.edgeRuns.id, runId)).returning({ graph: schema.edgeRuns.graph, canvasId: schema.edgeRuns.canvasId });
    if (run) touch(canvasFeed(run.canvasId));
    return run?.graph as Graph | undefined;
  });
  if (!graph) return;
  for (const wave of waves(graph)) {
    await Promise.all(wave.map(async (nodeId) => {
      const first = await s.run(`node-${nodeId}`, () => startNode(runId, nodeId));
      if (first.status !== "wait") return;
      const events = await Promise.all(first.calls.map((c) => s.waitForEvent(`wait-${nodeId}-${c.tag}`, { event: "edge/ml.done", timeout: first.timeout ?? "20m", if: doneFor(c.callId) })));
      await s.run(`node-${nodeId}-finish`, () => finishNode(runId, nodeId, first.state, events.map((e) => (e?.data as MlDone | undefined) ?? null)));
    }));
  }
  await s.run("finish", () => finishRun(runId));
}

async function loadRun(runId: number) {
  const [run] = await requireDb().select().from(schema.edgeRuns).where(eq(schema.edgeRuns.id, runId));
  if (!run) throw new Error(`Run ${runId} is gone`);
  return run;
}

async function stepRows(runId: number) {
  return requireDb().select().from(schema.edgeRunSteps).where(eq(schema.edgeRunSteps.runId, runId));
}

/** A node's saved outputs (fetching an R2 artifact when they were too big to keep in the row). */
async function outputsOf(row: typeof schema.edgeRunSteps.$inferSelect): Promise<Record<string, unknown>> {
  if (row.artifactKey) return (await getJson<Record<string, unknown>>(row.artifactKey)) ?? {};
  return (row.output as Record<string, unknown> | null) ?? {};
}

async function setStep(runId: number, nodeId: string, set: Partial<typeof schema.edgeRunSteps.$inferInsert>, canvasId?: number) {
  await requireDb().update(schema.edgeRunSteps).set(set).where(and(eq(schema.edgeRunSteps.runId, runId), eq(schema.edgeRunSteps.nodeId, nodeId)));
  if (canvasId) touch(canvasFeed(canvasId));
}

async function context(runId: number, node: CanvasNode, ownerId: string, graph: Graph, canvasId: number): Promise<{ ctx: ExecContext; blocked: string | null }> {
  const rows = await stepRows(runId);
  const byNode = new Map(rows.map((r) => [r.nodeId, r]));
  const def = NODE[node.type];
  const inputs: Record<string, unknown[]> = {};
  let blocked: string | null = null;
  for (const e of graph.edges.filter((x) => x.target === node.id)) {
    const src = byNode.get(e.source);
    if (!src || src.status !== "done") {
      const port = def.inputs.find((p) => p.name === e.targetHandle);
      if (port?.required && !graph.edges.some((x) => x.target === node.id && x.targetHandle === e.targetHandle && byNode.get(x.source)?.status === "done")) blocked = `Skipped: ${NODE[graph.nodes.find((n) => n.id === e.source)?.type ?? ""]?.label ?? "an input"} did not finish`;
      continue;
    }
    const out = await outputsOf(src);
    if (out[e.sourceHandle] !== undefined) (inputs[e.targetHandle] ??= []).push(out[e.sourceHandle]);
  }
  const ctx: ExecContext = {
    runId, nodeId: node.id, userId: ownerId, config: node.data.config ?? {}, inputs, deadline: Date.now() + 230_000,
    progress: (step, summary) => setStep(runId, node.id, { step, ...(summary ? { summary: summary.slice(0, 300) } : {}) }, canvasId),
  };
  return { ctx, blocked };
}

async function saveResult(runId: number, nodeId: string, res: ExecResult, canvasId: number, extraCost = 0) {
  const json = JSON.stringify(res.outputs ?? {});
  let output: unknown = res.outputs ?? {}, artifactKey = "";
  if (json.length > INLINE_BYTES && r2Ready()) {
    artifactKey = `runs/${runId}/${nodeId}.json`;
    await putJson(artifactKey, res.outputs);
    output = null;
  }
  await setStep(runId, nodeId, {
    status: "done", step: "", summary: res.summary.slice(0, 400), preview: (res.preview ?? {}) as Record<string, unknown>, output, artifactKey,
    cost: { mlUsd: Math.round(((res.costUsd ?? 0) + extraCost) * 10_000) / 10_000 }, finishedAt: new Date(),
  }, canvasId);
}

async function startNode(runId: number, nodeId: string): Promise<NodeState> {
  const run = await loadRun(runId);
  const graph = run.graph as Graph;
  const node = graph.nodes.find((n) => n.id === nodeId);
  const exec = node && executors.get(node.type);
  if (!node || !exec) { await setStep(runId, nodeId, { status: "failed", error: "This block is not available", finishedAt: new Date() }, run.canvasId); return { status: "failed" }; }
  const { ctx, blocked } = await context(runId, node, run.ownerId, graph, run.canvasId);
  if (blocked) { await setStep(runId, nodeId, { status: "skipped", summary: blocked, finishedAt: new Date() }, run.canvasId); return { status: "skipped" }; }
  await setStep(runId, nodeId, { status: "running", startedAt: new Date(), step: NODE[node.type].steps[0]?.id ?? "" }, run.canvasId);
  try {
    const res = await runAsUser(run.ownerId, () => exec.start(ctx));
    if (isWait(res)) {
      await setStep(runId, nodeId, { status: "waiting", summary: res.summary ?? "Waiting for the ML service" }, run.canvasId);
      return { status: "wait", calls: res.calls, state: res.state, timeout: res.timeout };
    }
    await saveResult(runId, nodeId, res, run.canvasId);
    return { status: "done" };
  } catch (e) {
    // The step's error carries the log reference, so "our side" failures can be found from the page.
    await setStep(runId, nodeId, { status: "failed", error: failureMessage(e, `edge-node:${node.type}`).slice(0, 300), finishedAt: new Date() }, run.canvasId);
    return { status: "failed" };
  }
}

async function finishNode(runId: number, nodeId: string, state: unknown, done: (MlDone | null)[]): Promise<{ status: "done" | "failed" }> {
  const run = await loadRun(runId);
  const graph = run.graph as Graph;
  const node = graph.nodes.find((n) => n.id === nodeId)!;
  const exec = executors.get(node.type)!;
  const { ctx } = await context(runId, node, run.ownerId, graph, run.canvasId);
  const mlCost = done.reduce((s, d) => s + (d?.costUsd ?? 0), 0);
  for (const d of done) if (d) noteMlCost(d.costUsd);
  try {
    const res = await runAsUser(run.ownerId, () => exec.finish!(ctx, state, done));
    await saveResult(runId, nodeId, res, run.canvasId, mlCost);
    return { status: "done" };
  } catch (e) {
    await setStep(runId, nodeId, { status: "failed", error: failureMessage(e, `edge-node-finish:${node.type}`).slice(0, 300), finishedAt: new Date() }, run.canvasId);
    return { status: "failed" };
  } finally {
    await flushUsage().catch(() => undefined);
  }
}

/** Close a run: status, cost (AI from the usage ledger over the run's window, ML from its nodes), and what a monitor should do. */
async function finishRun(runId: number): Promise<{ status: string }> {
  const db = requireDb();
  const run = await loadRun(runId);
  const rows = await stepRows(runId);
  const failed = rows.filter((r) => r.status === "failed").length;
  // A run with some failed blocks still finished; it is "failed" only when nothing worked.
  const status = failed === rows.length ? "failed" : "done";
  const [ai] = (await db.execute(sql`select coalesce(sum(cost_usd), 0)::float8 as usd from ai_usage where user_id = ${run.ownerId} and created_at >= ${run.startedAt ?? run.createdAt} and created_at <= now()`)).rows as { usd: number }[];
  const mlUsd = rows.reduce((s, r) => s + Number((r.cost as { mlUsd?: number }).mlUsd ?? 0), 0);
  const outputs = Object.fromEntries(rows.map((r) => [r.nodeId, { status: r.status, summary: r.summary }]));
  await db.update(schema.edgeRuns).set({
    status, finishedAt: new Date(), outputs, error: failed ? `${failed} block${failed === 1 ? "" : "s"} failed` : "",
    cost: { aiUsd: Math.round(Number(ai?.usd ?? 0) * 10_000) / 10_000, mlUsd: Math.round(mlUsd * 10_000) / 10_000 },
  }).where(eq(schema.edgeRuns.id, runId));
  await db.insert(schema.edgeCanvasEvents).values({ canvasId: run.canvasId, userId: run.ownerId, kind: "run", label: "", payload: { runId, status } });
  touch(canvasFeed(run.canvasId));
  await afterRun(runId).catch((e) => logError(e, { where: "edge-after-run" }));
  return { status };
}

/** Hooks that want to know when a run ends (monitors compare signals, stories publish). */
const afterHooks: ((runId: number) => Promise<void>)[] = [];
export function onRunFinished(hook: (runId: number) => Promise<void>) { afterHooks.push(hook); }
async function afterRun(runId: number) { for (const h of afterHooks) await h(runId); }

/* ---------------- Reading ---------------- */

export type StepView = { nodeId: string; type: string; status: string; step: string; summary: string; error: string; preview: Preview | null; output: Record<string, unknown> | null; downloads: { name: string; url: string }[]; startedAt: string | null; finishedAt: string | null };
export type RunView = { id: number; canvasId: number; status: string; trigger: string; createdAt: string; startedAt: string | null; finishedAt: string | null; cost: Record<string, number>; error: string; graph: Graph; steps: StepView[] };

/** A run as the page shows it. Outputs are included when small; files come with signed links. */
export async function runView(user: CurrentUser, runId: number, withOutputs = true): Promise<RunView> {
  const run = await loadRun(runId);
  await canvasAccess(user, run.canvasId, "view");
  const rows = await stepRows(runId);
  const graph = run.graph as Graph;
  const type = new Map(graph.nodes.map((n) => [n.id, n.type]));
  const steps: StepView[] = await Promise.all(rows.map(async (r) => {
    const output = withOutputs && r.status === "done" ? await outputsOf(r) : null;
    const file = output?.file as { name?: string; key?: string } | undefined;
    const downloads = file?.key && r2Ready() ? [{ name: file.name ?? "file", url: await signedUrl(file.key, 3600, { filename: file.name }) }] : [];
    return {
      nodeId: r.nodeId, type: type.get(r.nodeId) ?? "", status: r.status, step: r.step, summary: r.summary, error: r.error,
      preview: Object.keys(r.preview ?? {}).length ? (r.preview as Preview) : null, output, downloads,
      startedAt: r.startedAt?.toISOString() ?? null, finishedAt: r.finishedAt?.toISOString() ?? null,
    };
  }));
  return {
    id: run.id, canvasId: run.canvasId, status: run.status, trigger: run.trigger, createdAt: run.createdAt.toISOString(),
    startedAt: run.startedAt?.toISOString() ?? null, finishedAt: run.finishedAt?.toISOString() ?? null, cost: run.cost, error: run.error, graph, steps,
  };
}

/** A canvas's runs, newest first. */
export async function runsOf(canvasId: number, limit = 20) {
  return requireDb().select({ id: schema.edgeRuns.id, status: schema.edgeRuns.status, trigger: schema.edgeRuns.trigger, createdAt: schema.edgeRuns.createdAt, finishedAt: schema.edgeRuns.finishedAt, cost: schema.edgeRuns.cost, error: schema.edgeRuns.error })
    .from(schema.edgeRuns).where(eq(schema.edgeRuns.canvasId, canvasId)).orderBy(sql`${schema.edgeRuns.createdAt} desc`).limit(limit);
}

/** The latest finished run of each canvas (for side-by-side branch comparison). */
export async function latestRuns(canvasIds: number[]) {
  if (!canvasIds.length) return [];
  return (await requireDb().execute(sql`select distinct on (canvas_id) canvas_id, id from edge_runs where canvas_id in (${sql.join(canvasIds.map((i) => sql`${i}`), sql`, `)}) and status = 'done' order by canvas_id, created_at desc`)).rows as { canvas_id: number; id: number }[];
}

/** Runs stuck in queued or running for over an hour are marked failed (a crashed function, an expired wait). */
export async function reapStuckRuns(): Promise<number> {
  const rows = await requireDb().update(schema.edgeRuns).set({ status: "failed", error: "The run stopped without finishing", finishedAt: new Date() })
    .where(and(inArray(schema.edgeRuns.status, ["queued", "running"]), sql`${schema.edgeRuns.createdAt} < now() - interval '1 hour'`)).returning({ id: schema.edgeRuns.id });
  return rows.length;
}
