/**
 * The Thesis Agent's (E7) state, kept in `edge_agents.memo` (jsonb) beside the row's own columns. Types only,
 * safe on the client.
 */

/** How a claim settles: a deal announcement (the ledger resolves it), a reported XBRL figure, or its owner. */
export type ClaimRule =
  | { type: "deal"; role: "target" | "acquirer"; ticker: string }
  | { type: "xbrl"; ticker: string; concept: string; period: string; op: ">=" | "<=" | "between"; value: number; high?: number; unit?: string }
  | { type: "manual" };

export type ToolName = "crosswalk" | "precedents" | "pulse" | "deal_odds" | "series";

/** One tool call the plan wants each tick, and why. */
export type EvidencePlan = { tool: ToolName; args: Record<string, string | number>; why: string };

export type PlannedClaim = {
  n: number; text: string; parent: number | null; logic?: "all" | "any" | "weighted"; weight?: number;
  rule: ClaimRule; closes: string; prior: number; priorBasis: "reference" | "subjective"; priorNote: string;
  evidence: EvidencePlan[];
};

/** A kill criterion as a typed monitor, checked every tick against a tool's output. */
export type Monitor =
  | { tool: "deal_odds"; ticker: string; op: ">=" | "<="; value: number }
  | { tool: "series"; ticker: string; metric: string; op: "drop" | "rise"; value: number; weeks: number }
  | { tool: "pulse"; ticker: string; kind: string }
  | { tool: "deal"; ticker: string; role: "target" | "acquirer" };

export type Kill = { n: number; text: string; monitor: Monitor };

export type Plan = { title: string; companies: string[]; claims: PlannedClaim[]; kills: Kill[]; model: string; madeAt: string };

export type ClaimState = PlannedClaim & {
  p: number; forecastId: number | null; history: { at: string; p: number; why: string }[];
  resolved?: { outcome: number; at: string; source: string } | null;
  override?: { p: number; by: string; note: string; at: string } | null;
};

export type KillState = Kill & { status: "watching" | "fired" | "unavailable"; value: number | null; detail: string; checkedAt: string | null; firedAt: string | null };

export type EvidenceItem = {
  claim: number; direction: "for" | "against"; strength: "weak" | "moderate" | "strong"; statement: string; quote: string; source: string; url?: string;
  support?: number; kept: boolean; why: string; by: "agent" | "redteam" | "person"; at: string;
};

export type MemoState = { updatedAt: string; since: string; markdown: string; whatChanged: string[]; synthesis?: { text: string; model: string; at: string; deep: boolean } };

export type AgentTier = "free" | "plus";

export type AgentState = {
  version: 1;
  plan: Plan | null;
  claims: ClaimState[];
  kills: KillState[];
  evidence: EvidenceItem[];
  redteam: { at: string; points: { claim: number; text: string; kept: boolean }[] } | null;
  premortem: { at: string; text: string } | null;
  memo: MemoState | null;
  tier: AgentTier; deep: boolean; companies: string[];
  ticks: number; maxTicks: number; stepsPerTick: number;
  lastTickAt: string | null; nextTickAt: string | null; tickKey: string | null;
  approvedAt: string | null; stopReason: string | null; error: string | null;
};

export const emptyState = (tier: AgentTier, companies: string[], deep = false): AgentState => ({
  version: 1, plan: null, claims: [], kills: [], evidence: [], redteam: null, premortem: null, memo: null, tier, deep, companies,
  ticks: 0, maxTicks: tier === "plus" ? 180 : 14, stepsPerTick: tier === "plus" ? 10 : 6,
  lastTickAt: null, nextTickAt: null, tickKey: null, approvedAt: null, stopReason: null, error: null,
});
