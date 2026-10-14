/**
 * The Thesis Agent (E7) on the database: `edge_agents` (one row per thesis; its state in `memo`) and
 * `edge_agent_steps` (every step with its inputs, outputs and cost), the live dependencies of the runtime
 * (tools, model calls metered against the owner's AI allowance, Calibrated Claims' verifier, the forecast
 * ledger, cards), and what the routes do: create from a thesis (the plan to approve), approve, pause, resume,
 * stop, add evidence, override a claim, read with steps paged, export the log, list.
 *
 * Free: one active thesis per person, a 14-day horizon, daily ticks, the small model. More, longer and
 * twice-daily theses are edge.thesis-plus; the weekly deep pass edge.thesis-deep; team theses
 * edge.thesis-team. Ticks of a premium thesis re-check the owner's plan by id before they run, as background
 * work the person started; a free thesis never opens a premium scope.
 */
import { and, desc, eq, inArray, isNotNull, lt, or, sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import type { ForecastRule } from "@/db/schema";
import { runAsUser } from "@/lib/ai/context";
import { meterSpend } from "@/lib/ai/usage";
import { canUseById, entitlementsById } from "@/lib/billing/use";
import { logError } from "@/lib/errors";
import { myTeamIds } from "@/lib/teams/db";
import { alertLater, alertNow } from "../alerts";
import { verifyClaims } from "../claims/verify";
import { quoteFound } from "../docs/text";
import { companyNode } from "../entities/resolve";
import { logForecast } from "../forecasts/ledger";
import { oddsFor } from "../odds/score";
import { record } from "../provenance";
import { extractEvidence, planThesis, preMortem, redTeam, synthesis } from "./brain";
import { cleanKills, validatePlan, withPriors } from "./plan";
import { runTick, type AgentRow, type AgentStore, type Deps, type Step } from "./runtime";
import { monitorData, TOOL_DEFS } from "./tools";
import { emptyState, type AgentState, type AgentTier, type ClaimState, type EvidenceItem, type KillState, type Plan } from "./types";
import { applyLadder, LADDER_VERSION, overall, recomputeTree } from "./update";

const DAY = 86_400_000;
export const LIMITS = { free: { active: 1, horizonDays: 14, budget: 0.5, maxBudget: 1 }, plus: { active: 5, horizonDays: 90, budget: 5, maxBudget: 25 } } as const;

type Row = typeof schema.edgeAgents.$inferSelect;
const rowOf = (r: Row): AgentRow => ({ id: r.id, ownerId: r.ownerId, title: r.title, thesis: r.thesis, status: r.status, horizonEnd: r.horizonEnd ? String(r.horizonEnd) : null, budgetUsd: r.budgetUsd, spentUsd: r.spentUsd, cadence: r.cadence === "twice-daily" ? "twice-daily" : "daily" });
const stateOf = (r: Row): AgentState => ({ ...emptyState("free", []), ...(r.memo as Partial<AgentState>) });

/* ---------------- The runtime's store and live dependencies ---------------- */

export const dbStore: AgentStore = {
  async load(id) {
    const [r] = await requireDb().select().from(schema.edgeAgents).where(eq(schema.edgeAgents.id, id));
    return r ? { row: rowOf(r), state: stateOf(r) } : null;
  },
  async save(id, state, patch = {}) {
    await requireDb().update(schema.edgeAgents).set({ memo: state as unknown as Record<string, unknown>, updatedAt: new Date(), ...(patch.status ? { status: patch.status } : {}), ...(patch.spent !== undefined ? { spentUsd: patch.spent } : {}) }).where(eq(schema.edgeAgents.id, id));
  },
  async findStep(id, key) {
    const [r] = await requireDb().select().from(schema.edgeAgentSteps).where(and(eq(schema.edgeAgentSteps.agentId, id), sql`${schema.edgeAgentSteps.input}->>'key' = ${key}`)).limit(1);
    return r ? { key, kind: r.kind, tool: r.tool, input: r.input, output: r.output, cost: r.cost.usd ?? 0, error: r.error } : null;
  },
  async addStep(id, day, s: Step) {
    await requireDb().insert(schema.edgeAgentSteps).values({ agentId: id, day, kind: s.kind, tool: (s.tool ?? "").slice(0, 60), input: { ...(s.input ?? {}), key: s.key }, output: trimOut(s.output), cost: { usd: s.cost ?? 0 }, error: (s.error ?? "").slice(0, 400) });
  },
};

/** Step outputs are kept small: long texts cut, so the log stays light. */
function trimOut(o: Record<string, unknown>): Record<string, unknown> {
  const s = JSON.stringify(o);
  if (s.length < 60_000) return o;
  return { truncated: true, preview: s.slice(0, 20_000) };
}

/** The ledger rule for a claim: a deal (company node), a reported figure (its CIK), or manual. */
async function ruleOf(c: ClaimState): Promise<ForecastRule> {
  if (c.rule.type === "deal") { const n = await companyNode(c.rule.ticker); if (n) return { type: "deal", role: c.rule.role, node: n.id }; }
  if (c.rule.type === "xbrl") { const n = await companyNode(c.rule.ticker); if (n) return { type: "xbrl", cik: n.cik, concept: c.rule.concept, period: c.rule.period, op: c.rule.op, value: c.rule.value, ...(c.rule.high !== undefined ? { high: c.rule.high } : {}), ...(c.rule.unit ? { unit: c.rule.unit } : {}) }; }
  return { type: "manual", note: "settled by the thesis's owner", ...(c.parent !== null ? { parent: c.parent } : {}) };
}

async function logClaim(row: AgentRow, c: ClaimState, approvedAt: string): Promise<number | null> {
  const f = await logForecast({
    kind: "thesis_claim", subject: `thesis:${row.id}:claim:${c.n}`, question: c.text, probability: c.p, baseRate: c.priorBasis === "reference" ? c.prior : null,
    opensAt: new Date(approvedAt), closesAt: new Date(`${c.closes}T23:59:59Z`), rule: await ruleOf(c), model: "thesis-agent", modelVersion: LADDER_VERSION, ownerId: row.ownerId,
  });
  return f.id;
}

/** The runtime's live dependencies for one owner: model calls attributed to them and metered. */
export async function liveDeps(ownerId: string): Promise<Deps> {
  const ent = await entitlementsById(ownerId).catch(() => null);
  const admin = !!ent?.admin;
  return {
    store: dbStore, tools: TOOL_DEFS,
    brain: {
      extract: (s, outs) => extractEvidence(s, outs),
      redteam: (s, moved, outs) => redTeam(s, moved, outs),
      premortem: (thesis, s) => preMortem(thesis, s),
      synthesis: (thesis, s, outs, deep) => synthesis(thesis, s, outs, deep),
    },
    async verify(items, companies) {
      const scope = companies.map((t) => ({ name: t, ticker: t }));
      const r = await runAsUser(ownerId, () => verifyClaims(items.map((x) => ({ text: x.statement, cites: [{ text: x.passage.text, header: x.passage.header, quote: quoteFound(x.quote, x.passage.text) ? "exact" as const : "failed" as const, rank: 1 }] })), { mode: "balanced", scope }), { admin });
      return r.supports.map((s, i) => ({ p: s.p, quoteFound: quoteFound(items[i].quote, items[i].passage.text) }));
    },
    monitor: (m) => monitorData(m),
    ledger: {
      log: async (row, c) => { const s = (await dbStore.load(row.id))?.state; return logClaim(row, c, s?.approvedAt ?? new Date().toISOString()); },
      async resolved(ids) {
        const rows = await requireDb().select({ id: schema.edgeForecasts.id, subject: schema.edgeForecasts.subject, outcome: schema.edgeForecasts.outcome, at: schema.edgeForecasts.resolvedAt, source: schema.edgeForecasts.resolutionSource })
          .from(schema.edgeForecasts).where(and(inArray(schema.edgeForecasts.id, ids), isNotNull(schema.edgeForecasts.resolvedAt), isNotNull(schema.edgeForecasts.outcome)));
        return new Map(rows.map((r) => [r.id, { outcome: r.outcome!, at: r.at!.toISOString(), source: r.source }]));
      },
    },
    meter: (fn) => runAsUser(ownerId, () => meterSpend(fn), { admin }),
    deepAllowed: (row) => canUseById(row.ownerId, "edge.thesis-deep"),
    card: (row, s, what) => thesisCard(row, s, what),
    now: () => new Date(),
  };
}

/** A thesis_update card for the owner (and only them): a claim moved 10 points, or a kill criterion fired. */
async function thesisCard(row: AgentRow, s: AgentState, what: { moved: { n: number; from: number; to: number; why: string }[]; fired: number[] }): Promise<void> {
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const top = what.moved.sort((a, b) => Math.abs(b.to - b.from) - Math.abs(a.to - a.from))[0];
  const killed = what.fired.map((n) => s.kills.find((k) => k.n === n)).filter((k): k is KillState => !!k);
  const title = killed.length ? `Kill criterion fired on "${row.title}": ${killed[0].text}` : `"${row.title}": claim ${top.n} ${pct(top.from)} → ${pct(top.to)}`;
  const summary = killed.length ? `${killed.map((k) => k.detail).join("; ")}. Overall (agent estimate) ${pct(overall(s.claims) ?? 0)}.` : `${s.claims.find((c) => c.n === top.n)?.text ?? ""}: ${top.why}. Overall (agent estimate) ${pct(overall(s.claims) ?? 0)}.`;
  const key = `thesis_update:${row.id}:${s.lastTickAt ?? new Date().toISOString()}`;
  const [d] = await requireDb().insert(schema.edgeDetections).values({
    key: key.slice(0, 200), kind: "thesis_update", module: "signals", title: title.slice(0, 200), summary: summary.slice(0, 1200),
    why: `Your Thesis Agent moves each claim by a stated likelihood-ratio ladder when Edge's claim verifier supports the evidence; a kill criterion is a monitor checked every tick. Probabilities are agent estimates, logged in the forecast ledger.`,
    confidence: 0.8, magnitude: killed.length ? 1 : Math.min(1, Math.abs(top.to - top.from) * 3), tickers: s.companies.slice(0, 6), bbox: null, ownerId: row.ownerId,
    visual: { type: "thesis_update", agentId: row.id, title: row.title, overall: overall(s.claims), moved: what.moved.slice(0, 4), fired: killed.map((k) => ({ n: k.n, text: k.text, detail: k.detail })), claims: s.claims.map((c) => ({ n: c.n, text: c.text, p: c.p, history: c.history.slice(-12).map((h) => h.p) })).slice(0, 8) },
    observedAt: new Date(),
  }).onConflictDoNothing().returning({ id: schema.edgeDetections.id });
  if (!d) return;
  await record(`detection:${d.id}`, [{ sourceName: `Thesis Agent: ${row.title}`, sourceUrl: "", license: "Your thesis", method: LADDER_VERSION, modelVersion: "thesis-agent", retrievedAt: new Date() }]);
  if (killed.length) await alertNow(row.ownerId, { subject: `detection:${d.id}`, title, body: summary.slice(0, 400), url: `/app/edge?view=theses&thesis=${row.id}`, reasons: ["Your thesis"], urgent: false });
  else await alertLater(row.ownerId, `detection:${d.id}`);
}

/* ---------------- Ticks ---------------- */

/** The ids of agents whose tick is due (or was cut short), oldest first. */
export async function dueAgents(limit = 4, now = new Date()): Promise<number[]> {
  const rows = await requireDb().select({ id: schema.edgeAgents.id }).from(schema.edgeAgents)
    .where(and(eq(schema.edgeAgents.status, "running"), or(sql`${schema.edgeAgents.memo}->>'tickKey' is not null`, lt(sql`${schema.edgeAgents.memo}->>'nextTickAt'`, now.toISOString()))))
    .orderBy(sql`${schema.edgeAgents.memo}->>'nextTickAt'`).limit(limit);
  return rows.map((r) => r.id);
}

/** Run one agent's due tick (a slice of it before the deadline); a premium thesis re-checks the owner's plan first. */
export async function tickAgent(id: number, deadline: number): Promise<{ done: boolean; reason?: string }> {
  const loaded = await dbStore.load(id);
  if (!loaded) return { done: true, reason: "gone" };
  const { row, state } = loaded;
  if (state.tier === "plus" && !(await canUseById(row.ownerId, "edge.thesis-plus"))) {
    await dbStore.save(id, { ...state, error: "Paused: your plan no longer includes More theses. Resume it as your one free thesis, or upgrade." }, { status: "paused" });
    return { done: true, reason: "plan" };
  }
  try {
    const r = await runTick(await liveDeps(row.ownerId), id, deadline);
    return { done: r.done, ...(r.reason ? { reason: r.reason } : {}) };
  } catch (e) {
    logError(e, { where: "edge-agent-tick" });
    await dbStore.save(id, { ...state, error: "The last tick failed; it will be tried again at the next one." }).catch(() => undefined);
    return { done: true, reason: "error" };
  }
}

/** Every due tick, a slice at a time, until the deadline (the daily pass's fallback when Inngest is not set up). */
export async function ticksDue(deadline: number): Promise<{ ticked: number }> {
  let ticked = 0;
  for (const id of await dueAgents(10)) {
    if (Date.now() > deadline - 30_000) break;
    for (let k = 0; k < 3 && Date.now() < deadline - 20_000; k++) { const r = await tickAgent(id, Math.min(deadline, Date.now() + 60_000)); if (r.done) break; }
    ticked++;
  }
  return { ticked };
}

/* ---------------- What the routes do ---------------- */

export type CreateIn = { thesis: string; tickers: string[]; horizonDays: number; cadence: "daily" | "twice-daily"; tier: AgentTier; teamId: number | null; deep: boolean; budgetUsd: number };

/** The person's active theses (planning, running or paused). */
export async function activeCount(userId: string): Promise<number> {
  const [r] = await requireDb().select({ n: sql<number>`count(*)::int` }).from(schema.edgeAgents).where(and(eq(schema.edgeAgents.ownerId, userId), inArray(schema.edgeAgents.status, ["planning", "running", "paused"])));
  return Number(r?.n ?? 0);
}

/** Create a thesis: the plan (a model call on the person's allowance), priors from reference classes, checked. */
export async function createThesis(userId: string, c: CreateIn): Promise<{ id: number; plan: Plan; problems: string[] }> {
  const now = new Date(), today = now.toISOString().slice(0, 10);
  const horizonEnd = new Date(now.getTime() + c.horizonDays * DAY).toISOString().slice(0, 10);
  const metered = await meterSpend(() => planThesis(c.thesis, c.tickers, horizonEnd, today));
  let plan = metered.value;
  const odds: Record<string, { p: number; base: number } | undefined> = {};
  for (const t of [...new Set(plan.claims.flatMap((k) => (k.rule.type === "deal" && k.rule.role === "target" ? [k.rule.ticker] : [])))].slice(0, 8)) {
    const n = await companyNode(t).catch(() => null);
    const o = n ? await oddsFor(n.id).catch(() => null) : null;
    if (o) odds[t] = { p: o.p, base: o.base };
  }
  plan = withPriors({ ...plan, kills: cleanKills(plan.kills) }, odds, today);
  const problems = validatePlan(plan, { horizonEnd, today });
  const state: AgentState = { ...emptyState(c.tier, plan.companies.length ? plan.companies : c.tickers, c.deep), plan };
  const [row] = await requireDb().insert(schema.edgeAgents).values({
    ownerId: userId, teamId: c.teamId, title: plan.title || c.thesis.slice(0, 80), thesis: c.thesis.slice(0, 2000), status: "planning", horizonEnd, budgetUsd: c.budgetUsd, spentUsd: metered.usd,
    model: plan.model, cadence: c.cadence, memo: state as unknown as Record<string, unknown>,
  }).returning({ id: schema.edgeAgents.id });
  await dbStore.addStep(row.id, today, { key: `plan:${row.id}`, kind: "plan", input: { thesis: c.thesis, tickers: c.tickers, horizonEnd }, output: { plan: plan as unknown as Record<string, unknown>, problems }, cost: metered.usd });
  return { id: row.id, plan, problems };
}

type Access = { row: Row; state: AgentState; owner: boolean };

/** The thesis if this person may see it (its owner, or a member of its team). */
async function access(userId: string, id: number): Promise<Access | null> {
  const [r] = await requireDb().select().from(schema.edgeAgents).where(eq(schema.edgeAgents.id, id));
  if (!r) return null;
  if (r.ownerId === userId) return { row: r, state: stateOf(r), owner: true };
  if (r.teamId && (await myTeamIds(userId)).includes(r.teamId)) return { row: r, state: stateOf(r), owner: false };
  return null;
}
const notFound = () => Object.assign(new Error("That thesis is not yours to see."), { status: 404 });
const ownerOnly = () => Object.assign(new Error("Only the thesis's owner can do that."), { status: 403 });

/** Approve the plan: claims logged at their priors, kill criteria set, the first tick due now. */
export async function approveThesis(userId: string, id: number): Promise<AgentState> {
  const a = await access(userId, id);
  if (!a) throw notFound();
  if (!a.owner) throw ownerOnly();
  if (a.row.status !== "planning" || !a.state.plan) throw Object.assign(new Error("Only a plan waiting for approval can be approved."), { status: 409 });
  const today = new Date().toISOString().slice(0, 10);
  const problems = validatePlan(a.state.plan, { horizonEnd: String(a.row.horizonEnd ?? today), today });
  if (problems.length) throw Object.assign(new Error(`The plan cannot run yet: ${problems.join(" ")}`), { status: 422 });
  const now = new Date().toISOString();
  const row = rowOf(a.row);
  let claims: ClaimState[] = a.state.plan.claims.map((c) => ({ ...c, p: c.prior, forecastId: null, history: [{ at: now, p: c.prior, why: `prior (${c.priorBasis === "reference" ? c.priorNote : "subjective"})` }], resolved: null, override: null }));
  claims = recomputeTree(claims);
  for (let i = 0; i < claims.length; i++) claims[i] = { ...claims[i], forecastId: await logClaim(row, claims[i], now).catch((e) => { logError(e, { where: "edge-agent-ledger" }); return null; }) };
  const kills: KillState[] = a.state.plan.kills.map((k) => ({ ...k, status: "watching", value: null, detail: "not checked yet", checkedAt: null, firedAt: null }));
  const state: AgentState = { ...a.state, claims, kills, approvedAt: now, nextTickAt: now, error: null };
  await dbStore.save(id, state, { status: "running" });
  await dbStore.addStep(id, today, { key: `approve:${id}:${now}`, kind: "approval", input: { by: userId }, output: { approved: true, claims: claims.length, kills: kills.length } });
  return state;
}

/** Pause, resume or stop (owner only). Resuming a free thesis counts against the one active free thesis. */
export async function setStatus(userId: string, id: number, to: "paused" | "running" | "stopped"): Promise<string> {
  const a = await access(userId, id);
  if (!a) throw notFound();
  if (!a.owner) throw ownerOnly();
  const from = a.row.status;
  if (to === "running" && from !== "paused") throw Object.assign(new Error("Only a paused thesis can be resumed."), { status: 409 });
  if (to === "paused" && from !== "running") throw Object.assign(new Error("Only a running thesis can be paused."), { status: 409 });
  if (to === "stopped" && (from === "stopped" || from === "done")) return from;
  const state: AgentState = to === "running" ? { ...a.state, nextTickAt: new Date().toISOString(), error: null, ...(a.state.tier === "plus" && !(await canUseById(userId, "edge.thesis-plus")) ? { tier: "free" as const, maxTicks: 14, stepsPerTick: 6 } : {}) } : { ...a.state, tickKey: null, ...(to === "stopped" ? { stopReason: "stopped by its owner", nextTickAt: null } : {}) };
  await dbStore.save(id, state, { status: to });
  await dbStore.addStep(id, new Date().toISOString().slice(0, 10), { key: `status:${id}:${Date.now()}`, kind: "approval", input: { by: userId }, output: { from, to } });
  return to;
}

/** A person adds evidence: logged as theirs, applied by the ladder at once (owner or team member). */
export async function addEvidence(userId: string, id: number, e: { claim: number; direction: "for" | "against"; strength: "weak" | "moderate" | "strong"; statement: string; quote: string; source: string; url?: string }): Promise<AgentState> {
  const a = await access(userId, id);
  if (!a) throw notFound();
  if (!["running", "paused"].includes(a.row.status)) throw Object.assign(new Error("Evidence can be added while a thesis runs or is paused."), { status: 409 });
  const c = a.state.claims.find((x) => x.n === e.claim);
  if (!c) throw Object.assign(new Error("That claim is not in the thesis."), { status: 400 });
  const now = new Date().toISOString();
  const item: EvidenceItem = { ...e, statement: e.statement.slice(0, 400), quote: e.quote.slice(0, 600), source: e.source.slice(0, 200), kept: true, why: "added by a person", by: "person", at: now };
  const r = c.resolved || c.override ? { p: c.p } : applyLadder(c.p, [item]);
  const claims = recomputeTree(a.state.claims.map((x) => (x.n === c.n ? { ...x, p: r.p, history: [...x.history, { at: now, p: r.p, why: `person evidence (${e.direction}, ${e.strength}): ${e.statement.slice(0, 160)}` }] } : x)));
  const state: AgentState = { ...a.state, claims, evidence: [...a.state.evidence, item].slice(-300) };
  await dbStore.save(id, state);
  await dbStore.addStep(id, now.slice(0, 10), { key: `evidence:${id}:${Date.now()}`, kind: "evidence", input: { by: userId, ...e }, output: { claim: c.n, from: c.p, to: r.p } });
  if (a.row.status === "running" && Math.abs(r.p - c.p) >= 0.005) await logClaim(rowOf(a.row), claims.find((x) => x.n === c.n)!, a.state.approvedAt ?? now).catch(() => null);
  return state;
}

/** The owner overrides a claim's probability: shown as a person override, never logged as the agent's estimate. */
export async function overrideClaim(userId: string, id: number, o: { claim: number; p: number | null; note: string }): Promise<AgentState> {
  const a = await access(userId, id);
  if (!a) throw notFound();
  if (!a.owner) throw ownerOnly();
  const now = new Date().toISOString();
  if (!a.state.claims.some((x) => x.n === o.claim)) throw Object.assign(new Error("That claim is not in the thesis."), { status: 400 });
  const claims = a.state.claims.map((x) => (x.n === o.claim ? (o.p === null ? { ...x, override: null } : { ...x, override: { p: o.p, by: userId, note: o.note.slice(0, 300), at: now } }) : x));
  const state: AgentState = { ...a.state, claims };
  await dbStore.save(id, state);
  await dbStore.addStep(id, now.slice(0, 10), { key: `override:${id}:${Date.now()}`, kind: "approval", input: { by: userId, ...o }, output: { override: o.p } });
  return state;
}

export type ThesisListRow = { id: number; title: string; status: string; overall: number | null; history: number[]; horizonEnd: string | null; spentUsd: number; budgetUsd: number; tier: AgentTier; team: boolean; mine: boolean; updatedAt: string; nextTickAt: string | null; companies: string[] };

/** The person's theses and their teams'. */
export async function listTheses(userId: string): Promise<ThesisListRow[]> {
  const teams = await myTeamIds(userId);
  const rows = await requireDb().select().from(schema.edgeAgents).where(teams.length ? or(eq(schema.edgeAgents.ownerId, userId), inArray(schema.edgeAgents.teamId, teams)) : eq(schema.edgeAgents.ownerId, userId)).orderBy(desc(schema.edgeAgents.updatedAt)).limit(50);
  return rows.map((r) => {
    const s = stateOf(r);
    const roots = s.claims.filter((c) => c.parent === null);
    const len = Math.max(0, ...roots.map((c) => c.history.length));
    const history = Array.from({ length: Math.min(30, len) }, (_, k) => { const i = len - Math.min(30, len) + k; return overall(roots.map((c) => ({ parent: null, p: c.history[Math.min(i, c.history.length - 1)]?.p ?? c.p }))) ?? 0; });
    return { id: r.id, title: r.title, status: r.status, overall: overall(s.claims), history, horizonEnd: r.horizonEnd ? String(r.horizonEnd) : null, spentUsd: r.spentUsd, budgetUsd: r.budgetUsd, tier: s.tier, team: !!r.teamId, mine: r.ownerId === userId, updatedAt: r.updatedAt.toISOString(), nextTickAt: s.nextTickAt, companies: s.companies };
  });
}

/** One thesis with its state and a page of its steps (newest first, before `before`). */
export async function thesisView(userId: string, id: number, opts: { before?: number; kind?: string } = {}) {
  const a = await access(userId, id);
  if (!a) throw notFound();
  const conds = [eq(schema.edgeAgentSteps.agentId, id), ...(opts.before ? [lt(schema.edgeAgentSteps.id, opts.before)] : []), ...(opts.kind ? [eq(schema.edgeAgentSteps.kind, opts.kind)] : [])];
  const steps = await requireDb().select().from(schema.edgeAgentSteps).where(and(...conds)).orderBy(desc(schema.edgeAgentSteps.id)).limit(50);
  return {
    id, title: a.row.title, thesis: a.row.thesis, status: a.row.status, horizonEnd: a.row.horizonEnd ? String(a.row.horizonEnd) : null, budgetUsd: a.row.budgetUsd, spentUsd: a.row.spentUsd, cadence: a.row.cadence, team: !!a.row.teamId, owner: a.owner,
    state: a.state, overall: overall(a.state.claims), ladder: LADDER_VERSION,
    steps: steps.map((s) => ({ id: s.id, day: String(s.day), kind: s.kind, tool: s.tool, input: s.input, output: s.output, cost: s.cost.usd ?? 0, error: s.error, at: s.createdAt.toISOString() })),
    more: steps.length === 50 ? steps[steps.length - 1].id : null,
  };
}

/** The full step log for compliance, as CSV or JSON. */
export async function exportSteps(userId: string, id: number, format: "csv" | "json"): Promise<{ body: string; type: string; name: string }> {
  const a = await access(userId, id);
  if (!a) throw notFound();
  const steps = await requireDb().select().from(schema.edgeAgentSteps).where(eq(schema.edgeAgentSteps.agentId, id)).orderBy(schema.edgeAgentSteps.id).limit(20_000);
  const name = `thesis-${id}-log.${format}`;
  if (format === "json") return { body: JSON.stringify({ thesis: { id, title: a.row.title, thesis: a.row.thesis, status: a.row.status, ladder: LADDER_VERSION, state: a.state }, steps }, null, 1), type: "application/json", name };
  const esc = (v: unknown) => { const s = typeof v === "string" ? v : JSON.stringify(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = [["id", "day", "at", "kind", "tool", "cost_usd", "error", "input", "output"].join(","), ...steps.map((s) => [s.id, String(s.day), s.createdAt.toISOString(), s.kind, s.tool, s.cost.usd ?? 0, s.error, s.input, s.output].map(esc).join(","))];
  return { body: lines.join("\n"), type: "text/csv; charset=utf-8", name };
}
