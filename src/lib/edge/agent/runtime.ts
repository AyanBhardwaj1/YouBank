/**
 * The Thesis Agent's (E7) runtime: one tick of an approved thesis, as phases that each skip work already
 * done, so a tick cut short by a deadline (or retried by Inngest) resumes where it stopped and never repeats
 * a tool call, a model call or a probability update. Every step is logged with its inputs, outputs and cost.
 *
 *   1. monitors   kill criteria checked against their tools
 *   2. gather     the evidence plans' tool calls (at most stepsPerTick, deduplicated)
 *   3. extract    evidence items from the outputs (a model call), each checked by the claim verifier (E2):
 *                 only items whose quote is found in their source and that the verifier supports count
 *   4. update     the likelihood-ratio ladder per claim, parents recombined, new estimates logged (F3)
 *   5. redteam    when a claim moved 10 points or more: the counter-case, verified the same way, applied
 *   6. memo       the living memo; weekly, the pre-mortem and the synthesis (deep on premium)
 *   7. finish     resolutions read from the ledger; the next tick scheduled; the agent stops itself when the
 *                 budget, the horizon or the tick cap is reached, or every claim has resolved
 *
 * Budget: every model step has a stated estimate and is refused before it runs when the estimate would take
 * the spend past the budget; the actual cost (from the usage ledger's meter) is what is charged. Dependencies
 * are injected (store, tools, model calls, verifier, ledger, clock), so the replay test drives three ticks
 * deterministically without a database or a model.
 */
import { buildMemo } from "./memo";
import { evalMonitor, type MonitorData } from "./monitors";
import type { ToolDef, ToolOutput } from "./tools";
import type { AgentState, ClaimState, EvidenceItem, Monitor } from "./types";
import { applyLadder, canSpend, nextTick, recomputeTree, tickKeyOf } from "./update";

export type AgentRow = { id: number; ownerId: string; title: string; thesis: string; status: string; horizonEnd: string | null; budgetUsd: number; spentUsd: number; cadence: "daily" | "twice-daily" };
export type Step = { key: string; kind: string; tool?: string; input?: Record<string, unknown>; output: Record<string, unknown>; cost?: number; error?: string };

export type AgentStore = {
  load(id: number): Promise<{ row: AgentRow; state: AgentState } | null>;
  save(id: number, state: AgentState, patch?: { status?: string; spent?: number }): Promise<void>;
  findStep(id: number, key: string): Promise<Step | null>;
  addStep(id: number, day: string, step: Step): Promise<void>;
};

export type Brain = {
  extract(s: AgentState, outs: ToolOutput[]): Promise<{ claim: number; direction: "for" | "against"; strength: "weak" | "moderate" | "strong"; statement: string; quote: string; source: string }[]>;
  redteam(s: AgentState, moved: number[], outs: ToolOutput[]): Promise<{ claim: number; text: string; quote: string; source: string }[]>;
  premortem(thesis: string, s: AgentState): Promise<string>;
  synthesis(thesis: string, s: AgentState, outs: ToolOutput[], deep: boolean): Promise<{ text: string; model: string }>;
};

export type Deps = {
  store: AgentStore; tools: Record<string, ToolDef>; brain: Brain;
  /** Support probabilities for evidence statements against their source passages (Calibrated Claims). */
  verify(items: { statement: string; quote: string; passage: ToolOutput }[], companies: string[]): Promise<{ p: number; quoteFound: boolean }[]>;
  monitor(m: Monitor): Promise<MonitorData | null>;
  /** Log a claim's estimate to the ledger (returns the forecast id), and read which claims have resolved. */
  ledger: { log(row: AgentRow, c: ClaimState): Promise<number | null>; resolved(ids: number[]): Promise<Map<number, { outcome: number; at: string; source: string }>> };
  /** Run a model step and return its value with the cost metered from the usage ledger. */
  meter<T>(fn: () => Promise<T>): Promise<{ value: T; usd: number }>;
  /** Whether the deep weekly pass may run (the owner's plan holds edge.thesis-deep). */
  deepAllowed(row: AgentRow): Promise<boolean>;
  /** A card for the owner when a claim moved 10 points or a kill criterion fired. */
  card(row: AgentRow, s: AgentState, what: { moved: { n: number; from: number; to: number; why: string }[]; fired: number[] }): Promise<void>;
  now(): Date;
};

/** Stated cost estimates (USD) checked against the budget before a model step runs. */
export const ESTIMATE = { extract: 0.004, redteam: 0.004, premortem: 0.002, synthesis: 0.01, deep: 1.2 } as const;
export const KEEP_SUPPORT = 0.5;

export type TickResult = { ran: boolean; done: boolean; reason?: string; moved: number; fired: number; spent: number };

const day = (d: Date) => d.toISOString().slice(0, 10);
const hash = (o: unknown) => { const s = JSON.stringify(o); let h = 0; for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };

/** Whether an agent's tick is due now. Pure. */
export function due(row: Pick<AgentRow, "status">, s: Pick<AgentState, "nextTickAt" | "tickKey">, now: Date): boolean {
  return row.status === "running" && (!!s.tickKey || (!!s.nextTickAt && s.nextTickAt <= now.toISOString()));
}

/**
 * Run (or resume) the due tick of one agent until it finishes or the deadline nears. Returns whether more is
 * left (the caller runs it again in a new step).
 */
export async function runTick(deps: Deps, agentId: number, deadline: number): Promise<TickResult> {
  const loaded = await deps.store.load(agentId);
  const empty = { ran: false, done: true, moved: 0, fired: 0, spent: 0 };
  if (!loaded) return { ...empty, reason: "no such agent" };
  const { row } = loaded;
  let s = loaded.state;
  const now = deps.now();
  if (!due(row, s, now)) return { ...empty, reason: "not due" };
  const key = s.tickKey ?? tickKeyOf(agentId, new Date(s.nextTickAt ?? now.toISOString()));
  if (!s.tickKey) { s = { ...s, tickKey: key }; await deps.store.save(agentId, s); }
  let spent = row.spentUsd, outOfBudget = false;
  const today = day(now);
  const left = () => Date.now() < deadline - 5_000;
  const step = async <T extends Record<string, unknown>>(k: string, kind: string, run: () => Promise<{ output: T; cost?: number; tool?: string; input?: Record<string, unknown>; error?: string }>): Promise<T> => {
    const found = await deps.store.findStep(agentId, `${key}:${k}`);
    if (found) return found.output as T;
    const r = await run();
    await deps.store.addStep(agentId, today, { key: `${key}:${k}`, kind, output: r.output, ...(r.tool ? { tool: r.tool } : {}), ...(r.input ? { input: r.input } : {}), ...(r.cost ? { cost: r.cost } : {}), ...(r.error ? { error: r.error } : {}) });
    if (r.cost) { spent += r.cost; await deps.store.save(agentId, s, { spent }); }
    return r.output;
  };
  const model = async <T,>(k: string, kind: string, estimate: number, fn: () => Promise<T>): Promise<T | null> => {
    const found = await deps.store.findStep(agentId, `${key}:${k}`);
    if (found) return (found.output.value ?? null) as T | null;
    if (!canSpend(row.budgetUsd, spent, estimate)) {
      outOfBudget = true;
      await deps.store.addStep(agentId, today, { key: `${key}:${k}`, kind: "approval", output: { value: null, refused: `budget: $${spent.toFixed(3)} of $${row.budgetUsd.toFixed(2)} spent; this step is estimated at $${estimate.toFixed(3)}` } });
      return null;
    }
    try {
      const r = await deps.meter(fn);
      await deps.store.addStep(agentId, today, { key: `${key}:${k}`, kind, output: { value: r.value as unknown as Record<string, unknown> }, cost: r.usd });
      spent += r.usd; await deps.store.save(agentId, s, { spent });
      return r.value;
    } catch (e) {
      await deps.store.addStep(agentId, today, { key: `${key}:${k}`, kind, output: { value: null }, error: (e as { status?: number }).status && (e as { status?: number }).status! < 500 ? String((e as Error).message).slice(0, 300) : "the model call failed" });
      return null;
    }
  };

  // 1. Kill criteria.
  const fired: number[] = [];
  for (const k of s.kills) {
    if (!left()) return { ran: true, done: false, moved: 0, fired: 0, spent };
    const out = await step(`monitor:${k.n}`, "tool", async () => {
      const d = await deps.monitor(k.monitor).catch(() => null);
      return { tool: `monitor:${k.monitor.tool}`, input: { monitor: k.monitor }, output: { ...evalMonitor(k.monitor, d, s.approvedAt ?? now.toISOString()) } };
    });
    const r = out as unknown as Pick<typeof s.kills[number], "status" | "value" | "detail">;
    const was = s.kills.find((x) => x.n === k.n)!;
    if (r.status === "fired" && was.status !== "fired") fired.push(k.n);
    s = { ...s, kills: s.kills.map((x) => (x.n === k.n ? { ...x, status: x.status === "fired" ? "fired" : r.status, value: r.value, detail: r.detail, checkedAt: now.toISOString(), firedAt: x.firedAt ?? (r.status === "fired" ? now.toISOString() : null) } : x)) };
  }
  await deps.store.save(agentId, s);

  // 2. Evidence plans' tool calls, deduplicated, capped.
  const calls = [...new Map(s.claims.filter((c) => !c.resolved).flatMap((c) => c.evidence).map((e) => [`${e.tool}:${hash(e.args)}`, e])).values()].slice(0, s.stepsPerTick);
  const outs: ToolOutput[] = [];
  for (const [i, e] of calls.entries()) {
    if (!left()) return { ran: true, done: false, moved: 0, fired: fired.length, spent };
    const o = await step(`tool:${e.tool}:${hash(e.args)}`, "tool", async () => {
      const d = deps.tools[e.tool];
      if (!d) return { tool: e.tool, input: { args: e.args }, output: { missing: true }, error: `no tool ${e.tool}` };
      try { const r = await d.run(e.args); return { tool: e.tool, input: { args: e.args }, output: r as unknown as Record<string, unknown>, cost: d.costUsd }; }
      // The step log is shown to the owner: only a plain refusal (status below 500) keeps its words.
      catch (err) { const st = (err as { status?: number }).status; return { tool: e.tool, input: { args: e.args }, output: { failed: true }, error: st && st < 500 ? String((err as Error).message ?? "failed").slice(0, 200) : "the tool failed" }; }
    });
    if ((o as { text?: string }).text) outs.push({ ...(o as unknown as Omit<ToolOutput, "id" | "at">), id: `T${i + 1}`, at: now.toISOString() });
  }

  // 3. Evidence, verified.
  if (!left()) return { ran: true, done: false, moved: 0, fired: fired.length, spent };
  const fresh = await step("extract", "evidence", async () => {
    const raw = outs.length ? await model("extract-call", "tool", ESTIMATE.extract, () => deps.brain.extract(s, outs)) : [];
    const items = (raw ?? []).filter((x) => s.claims.some((c) => c.n === x.claim));
    const checks = items.length ? await deps.verify(items.map((x) => ({ statement: x.statement, quote: x.quote, passage: outs.find((o) => o.id === x.source) ?? outs[0] })), s.companies) : [];
    const evidence: EvidenceItem[] = items.map((x, i) => {
      const src = outs.find((o) => o.id === x.source);
      const ok = !!src && checks[i]?.quoteFound && (checks[i]?.p ?? 0) >= KEEP_SUPPORT;
      return { ...x, source: src ? src.header : x.source, ...(src?.url ? { url: src.url } : {}), support: checks[i]?.p, kept: ok, why: !src ? "its source id is not one of this tick's sources" : !checks[i]?.quoteFound ? "its quote is not in the source" : ok ? "verified" : `the verifier gives it ${Math.round((checks[i]?.p ?? 0) * 100)}% support (below ${KEEP_SUPPORT * 100}%)`, by: "agent", at: now.toISOString() };
    });
    return { output: { evidence } };
  });
  const ev = (fresh.evidence as EvidenceItem[]) ?? [];
  // Appended once: a resumed tick finds these items already in the state by their time.
  if (ev.length && !s.evidence.some((e) => e.at === ev[0].at && e.by === "agent")) s = { ...s, evidence: [...s.evidence, ...ev].slice(-300) };

  // 4. Update by the ladder.
  const moves = await step("update", "update", async () => {
    const out: { n: number; from: number; to: number; why: string }[] = [];
    const claims = s.claims.map((c) => {
      if (c.resolved || c.override) return c;
      const mine = ev.filter((e) => e.claim === c.n);
      if (!mine.some((e) => e.kept)) return c;
      const r = applyLadder(c.p, mine);
      const why = mine.filter((e) => e.kept).map((e) => `${e.direction} (${e.strength}): ${e.statement}`).join("; ").slice(0, 300);
      out.push({ n: c.n, from: c.p, to: r.p, why });
      return { ...c, p: r.p, history: [...c.history, { at: now.toISOString(), p: r.p, why }] };
    });
    const tree = recomputeTree(claims).map((c) => { const before = claims.find((x) => x.n === c.n)!; return before.p !== c.p ? { ...c, history: [...c.history, { at: now.toISOString(), p: c.p, why: "recombined from its claims" }] } : c; });
    for (const c of tree) { const was = s.claims.find((x) => x.n === c.n)!; if (Math.abs(c.p - was.p) >= 0.005 && !out.some((o) => o.n === c.n)) out.push({ n: c.n, from: was.p, to: c.p, why: "recombined from its claims" }); }
    return { output: { claims: tree as unknown as Record<string, unknown>, moves: out } };
  });
  s = { ...s, claims: moves.claims as unknown as ClaimState[] };
  const moved = (moves.moves as { n: number; from: number; to: number; why: string }[]) ?? [];
  for (const m of moved) {
    const c = s.claims.find((x) => x.n === m.n)!;
    await step(`ledger:${m.n}`, "update", async () => ({ output: { forecastId: await deps.ledger.log(row, c).catch(() => null) } }));
  }
  await deps.store.save(agentId, s);

  // 5. Red team, when a claim moved 10 points or more.
  const big = moved.filter((m) => Math.abs(m.to - m.from) >= 0.1).map((m) => m.n);
  if (big.length) {
    if (!left()) return { ran: true, done: false, moved: moved.length, fired: fired.length, spent };
    const rt = await step("redteam", "redteam", async () => {
      const pts = (await model("redteam-call", "tool", ESTIMATE.redteam, () => deps.brain.redteam(s, big, outs))) ?? [];
      const checks = pts.length ? await deps.verify(pts.map((p) => ({ statement: p.text, quote: p.quote, passage: outs.find((o) => o.id === p.source) ?? outs[0] })), s.companies) : [];
      const points = pts.map((p, i) => ({ claim: p.claim, text: p.text, kept: !!outs.find((o) => o.id === p.source) && !!checks[i]?.quoteFound && (checks[i]?.p ?? 0) >= KEEP_SUPPORT, quote: p.quote, source: outs.find((o) => o.id === p.source)?.header ?? p.source }));
      const claims = s.claims.map((c) => {
        const against = points.filter((p) => p.claim === c.n && p.kept);
        if (!against.length || c.resolved || c.override) return c;
        const r = applyLadder(c.p, against.map(() => ({ direction: "against" as const, strength: "moderate" as const, kept: true })));
        return { ...c, p: r.p, history: [...c.history, { at: now.toISOString(), p: r.p, why: `red team: ${against.map((a) => a.text).join("; ").slice(0, 200)}` }] };
      });
      return { output: { points, claims: recomputeTree(claims) as unknown as Record<string, unknown>, at: now.toISOString() } };
    });
    const points = rt.points as { claim: number; text: string; kept: boolean; quote: string; source: string }[];
    const at = String(rt.at);
    if (s.redteam?.at !== at) {
      s = { ...s, claims: rt.claims as unknown as ClaimState[], redteam: { at, points: points.map((p) => ({ claim: p.claim, text: p.text, kept: p.kept })) },
        evidence: [...s.evidence, ...points.map((p) => ({ claim: p.claim, direction: "against" as const, strength: "moderate" as const, statement: p.text, quote: p.quote, source: p.source, kept: p.kept, why: p.kept ? "red team, verified" : "red team, not supported by the sources", by: "redteam" as const, at }))].slice(-300) };
    }
    for (const p of points.filter((x) => x.kept)) { const c = s.claims.find((x) => x.n === p.claim); if (c) await step(`ledger-rt:${c.n}`, "update", async () => ({ output: { forecastId: await deps.ledger.log(row, c).catch(() => null) } })); }
    await deps.store.save(agentId, s);
  }

  // 6. Memo; weekly pre-mortem and synthesis.
  if (!left()) return { ran: true, done: false, moved: moved.length, fired: fired.length, spent };
  const weekly = (s.ticks + 1) % 7 === 0;
  if (weekly) {
    const pm = await model("premortem", "memo", ESTIMATE.premortem, () => deps.brain.premortem(row.thesis, s));
    if (pm) s = { ...s, premortem: { at: now.toISOString(), text: pm } };
    const deep = s.deep && (await deps.deepAllowed(row));
    const syn = await model(deep ? "deep" : "synthesis", "memo", deep ? ESTIMATE.deep : ESTIMATE.synthesis, () => deps.brain.synthesis(row.thesis, s, outs, deep));
    if (syn) s = { ...s, memo: { ...(s.memo ?? { updatedAt: "", since: "", markdown: "", whatChanged: [] }), synthesis: { text: syn.text, model: syn.model, at: now.toISOString(), deep } } };
  }
  const since = s.lastTickAt ?? s.approvedAt ?? now.toISOString();
  const memo = buildMemo(s, row.title, row.thesis, since, now.toISOString());
  s = { ...s, memo: { ...(s.memo ?? {}), updatedAt: now.toISOString(), since, markdown: memo.markdown, whatChanged: memo.whatChanged } };
  await step("memo", "memo", async () => ({ output: { whatChanged: memo.whatChanged } }));

  // 7. Resolutions, the next tick, and stopping.
  const ids = s.claims.map((c) => c.forecastId).filter((x): x is number => typeof x === "number");
  const res = ids.length ? await deps.ledger.resolved(ids).catch(() => new Map()) : new Map();
  s = { ...s, claims: s.claims.map((c) => (c.forecastId && res.has(c.forecastId) && !c.resolved ? { ...c, resolved: res.get(c.forecastId)! } : c)) };
  const ticks = s.ticks + 1;
  const horizonPassed = !!row.horizonEnd && today > row.horizonEnd;
  const allResolved = s.claims.length > 0 && s.claims.every((c) => c.resolved);
  // Spent, or too little left for the smallest model step: the budget is reached.
  const broke = spent >= row.budgetUsd - 1e-9 || outOfBudget;
  const stop = allResolved ? "every claim has resolved" : horizonPassed ? "the horizon ended" : ticks >= s.maxTicks ? "the tick limit was reached" : broke ? "the budget was spent" : null;
  s = { ...s, ticks, lastTickAt: now.toISOString(), tickKey: null, nextTickAt: stop ? null : nextTick(now, row.cadence).toISOString(), stopReason: stop };
  await deps.store.save(agentId, s, { status: stop ? "done" : "running", spent });
  if (moved.some((m) => Math.abs(m.to - m.from) >= 0.1) || fired.length) await deps.card(row, s, { moved: moved.filter((m) => Math.abs(m.to - m.from) >= 0.1), fired }).catch(() => undefined);
  return { ran: true, done: true, moved: moved.length, fired: fired.length, spent, ...(stop ? { reason: stop } : {}) };
}
