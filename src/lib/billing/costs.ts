/**
 * What YouBank costs to run, per person, and the margin each plan earns on it. Pure data and arithmetic,
 * safe to import on the client; docs/pricing.md explains every number and scripts/test-billing.ts holds
 * the plans to the margin target.
 *
 * How it fits together:
 * - `UNITS` are the things that cost money each time they happen (a model answer, a document read, a
 *   minute of compute), each with its list price, where the price came from and when it was checked. Model
 *   calls are priced from `src/lib/ai/pricing.ts` with a stated token shape, so a list price change there
 *   moves the model here too.
 * - `FIXED` are the monthly bills that do not grow with each person (plans with a minimum, licences,
 *   signing certificates); they are spread over `PAYING_SEATS` paying seats.
 * - `USAGE` is what a light, typical and heavy person on each plan does in a month. Heavy means "uses the
 *   whole AI allowance": `limits.ts` stops AI spend at the plan's allowance, so that is the most a person
 *   can cost us in model calls.
 * - Premium features other work registers in `src/lib/billing/features/` carry a `costPerUseUsd`; the
 *   model counts a few uses of each one a plan unlocks, so a new metered feature shows up in the margins
 *   (and can fail the test) without anyone editing this file.
 */
import { costOf } from "@/lib/ai/pricing";
import { DEFAULT_OPENAI_MODEL } from "@/lib/ai/models";
import { FEATURES } from "./features";
import { PLANS, PLAN_ORDER, planAtLeast, type PlanId } from "./plans";

/** When the prices below were last checked against the vendors' pages. */
export const CHECKED = "2026-10-05";

/** The margin we aim for at typical use: on the monthly price, and (a little lower) on the yearly one. */
export const MARGIN_TARGET = { monthly: 0.75, yearly: 0.7 } as const;

/** Paying seats the fixed bills are spread over. At launch scale; fewer seats raise each one's share (docs/pricing.md). */
export const PAYING_SEATS = 200;

export type Level = "light" | "typical" | "heavy";
export const LEVELS: Level[] = ["light", "typical", "heavy"];

export type CostArea = "ai" | "mail" | "edge" | "maps" | "crypto" | "infra";

export type Unit = {
  label: string;
  area: CostArea;
  /** US dollars per `per`. */
  usd: number;
  per: string;
  /** Whether this spend is written to the AI usage ledger, so the plan's AI allowance stops it. */
  inAiAllowance: boolean;
  source: string;
  checked: string;
};

/** One model call: tokens in (cached ones included), of which cached, and out (reasoning included). */
type Call = { model: string; input: number; cached: number; output: number };
const call = (c: Call, times = 1) => times * (costOf(c.model, { input: c.input, cached: c.cached, cacheWrite: 0, output: c.output, reasoning: 0 }) ?? 0);
const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

const AI_SRC = "src/lib/ai/pricing.ts (vendor list prices, checked 2026-09-27), with the token shape stated in the label";
const EDGE_SRC = "src/lib/edge/premium.ts (list prices, checked 2026-09-30)";

/**
 * Token shapes, from what the app sends: a terminal answer carries the system prompt, tool definitions
 * and workspace context (most of it a prompt-cache hit) and usually two model calls (a tool call, then
 * the answer); an agent run or workflow is about six such turns; a Studio build about fourteen.
 */
const DEFAULT_TURN: Call = { model: DEFAULT_OPENAI_MODEL, input: 20_000, cached: 12_000, output: 3_000 };
const AGENT_TURN: Call = { model: DEFAULT_OPENAI_MODEL, input: 25_000, cached: 18_000, output: 2_000 };
const STUDIO_TURN: Call = { model: DEFAULT_OPENAI_MODEL, input: 30_000, cached: 24_000, output: 2_500 };

export const UNITS = {
  // AI: interactive work runs on the model the person picks (default gpt-6-astra, medium reasoning).
  "ai.answer": { label: "Assistant answer on the default model (20k tokens in, 60% cached; 3k out)", area: "ai", usd: round4(call(DEFAULT_TURN)), per: "answer", inAiAllowance: true, source: AI_SRC, checked: "2026-09-27" },
  "ai.run": { label: "Agent run or AI workflow (six turns of 25k in, 72% cached; 2k out)", area: "ai", usd: round4(call(AGENT_TURN, 6)), per: "run", inAiAllowance: true, source: AI_SRC, checked: "2026-09-27" },
  "ai.studio": { label: "Studio build: a model and deck (fourteen turns of 30k in, 80% cached; 2.5k out)", area: "ai", usd: round4(call(STUDIO_TURN, 14)), per: "build", inAiAllowance: true, source: AI_SRC, checked: "2026-09-27" },
  "ai.deep": { label: "Deep answer from the largest model at Max reasoning (claude-fable-5-1: 40k in, 25% cached; 15k out)", area: "ai", usd: round4(call({ model: "claude-fable-5-1", input: 40_000, cached: 10_000, output: 15_000 })), per: "answer", inAiAllowance: true, source: AI_SRC, checked: "2026-09-27" },
  // Relationships: background work is routed to small models (src/lib/ai/route.ts).
  "mail.triage": { label: "Reading one incoming email (gpt-5.6-luna: 4k in, 0.5k out)", area: "mail", usd: round4(call({ model: "gpt-5.6-luna", input: 4_000, cached: 0, output: 500 })), per: "email", inAiAllowance: true, source: AI_SRC, checked: "2026-09-27" },
  "mail.draft": { label: "Drafting one reply (gpt-5.6-terra: 8k in, half cached; 0.8k out)", area: "mail", usd: round4(call({ model: "gpt-5.6-terra", input: 8_000, cached: 4_000, output: 800 })), per: "draft", inAiAllowance: true, source: AI_SRC, checked: "2026-09-27" },
  "mail.mailbox": { label: "Keeping one mailbox in sync (the five-minute heartbeat: about 1.2 CPU-hours on Vercel and 0.5 Neon compute-hours a month)", area: "mail", usd: round4(1.2 * 0.128 + 0.5 * 0.106), per: "mailbox-month", inAiAllowance: false, source: "Vercel Pro active CPU $0.128/hour; Neon Launch $0.106/CU-hour (vercel.com/pricing, neon.com/pricing via published 2026 summaries)", checked: CHECKED },
  // Edge.
  "edge.answer": { label: "Edge document answer on the small model (gpt-6-luna: 10k in, 1k out) with a reranked search", area: "edge", usd: round4(call({ model: "gpt-6-luna", input: 10_000, cached: 0, output: 1_000 }) + 15_000 * 0.05 / 1e6), per: "answer", inAiAllowance: true, source: `${AI_SRC}; Voyage rerank-3 $0.05/M tokens (${EDGE_SRC})`, checked: "2026-09-30" },
  "edge.answer_large": { label: "Edge document answer on the larger model (gpt-5.6-sol: 10k in, 1.5k out)", area: "edge", usd: round4(call({ model: "gpt-5.6-sol", input: 10_000, cached: 0, output: 1_500 })), per: "answer", inAiAllowance: true, source: EDGE_SRC, checked: "2026-09-30" },
  "edge.rerank_cohere": { label: "Cohere Rerank 4, when used in place of Voyage", area: "edge", usd: 0.0025, per: "search", inAiAllowance: true, source: EDGE_SRC, checked: "2026-09-30" },
  "edge.ingest": { label: "Reading a 100-page document: embeddings (60k tokens at $0.02/M), parsing on Modal (2 CPU-minutes), storage", area: "edge", usd: round4(60_000 * 0.02 / 1e6 + (2 / 60) * 0.047 + 0.01 * 0.015), per: "document", inAiAllowance: false, source: `OpenAI text-embedding-3-small $0.02/M tokens; Modal CPU $0.047/core-hour (${EDGE_SRC}); R2 $0.015/GB-month`, checked: CHECKED },
  "edge.parse_hard": { label: "LlamaParse on a hard 100-page PDF (about 3 credits a page; planned)", area: "edge", usd: round4(300 * 1.25 / 1_000), per: "document", inAiAllowance: false, source: EDGE_SRC, checked: "2026-09-30" },
  "edge.transcribe": { label: "Speaker-labelled transcript of an hour of audio (OpenAI, $0.006/minute; planned)", area: "edge", usd: 0.36, per: "hour", inAiAllowance: false, source: EDGE_SRC, checked: "2026-09-30" },
  "edge.ground_check": { label: "Satellite ground check on Modal (about 40 GPU-seconds on an L4)", area: "edge", usd: round4((40 / 3600) * 0.8), per: "check", inAiAllowance: false, source: `Modal L4 $0.80/hour (${EDGE_SRC})`, checked: "2026-09-30" },
  // 3D maps and geospatial AI (the maps work): mostly free data plus compute.
  "maps.tiles3d": { label: "A 3D map session on Google Photorealistic 3D Tiles (one root tile request; terrain, buildings and LiDAR from free sources cost nothing)", area: "maps", usd: 0.006, per: "session", inAiAllowance: false, source: "Google Maps Platform Map Tiles API, $6.00 per 1,000 root tile requests up to 100,000", checked: CHECKED },
  "maps.lidar": { label: "LiDAR or terrain analysis on Modal (about 8 CPU-minutes)", area: "maps", usd: round4((8 / 60) * 0.047), per: "job", inAiAllowance: false, source: `Modal CPU $0.047/core-hour (${EDGE_SRC})`, checked: "2026-09-30" },
  "maps.imagery_ai": { label: "Satellite-imagery AI: a GPU pass (60 s on an L4) and a written read-out on the default model", area: "maps", usd: round4((60 / 3600) * 0.8 + call(DEFAULT_TURN)), per: "analysis", inAiAllowance: false, source: `Modal L4 $0.80/hour; ${AI_SRC}`, checked: CHECKED },
  // Crypto (the crypto work): free APIs first; paid tiers are mostly fixed monthly plans (see FIXED).
  "crypto.data": { label: "A CoinGecko paid-tier call (Analyst plan: $129 for 500,000 credits)", area: "crypto", usd: 0.000258, per: "call", inAiAllowance: false, source: "CoinGecko API pricing (Analyst $129/month, 500k credits)", checked: CHECKED },
  "crypto.rpc": { label: "A blockchain RPC call on Alchemy pay-as-you-go (about 25 compute units)", area: "crypto", usd: 25 * 0.45 / 1e6, per: "call", inAiAllowance: false, source: "Alchemy pay-as-you-go, $0.45 per million compute units", checked: CHECKED },
  // Infrastructure that grows with use.
  "infra.db_compute": { label: "Neon database compute", area: "infra", usd: 0.106, per: "CU-hour", inAiAllowance: false, source: "Neon Launch plan, $0.106/CU-hour, no monthly minimum", checked: CHECKED },
  "infra.db_storage": { label: "Neon database storage", area: "infra", usd: 0.35, per: "GB-month", inAiAllowance: false, source: "Neon Launch plan, $0.35/GB-month", checked: CHECKED },
  "infra.functions": { label: "Vercel function active CPU", area: "infra", usd: 0.128, per: "CPU-hour", inAiAllowance: false, source: "Vercel Pro on-demand, $0.128/CPU-hour", checked: CHECKED },
  "infra.transfer": { label: "Vercel data transfer beyond the included 1 TB", area: "infra", usd: 0.15, per: "GB", inAiAllowance: false, source: "Vercel Pro Fast Data Transfer, $0.15/GB", checked: CHECKED },
  "infra.jobs": { label: "Inngest step executions beyond the included million", area: "infra", usd: 0.00005, per: "execution", inAiAllowance: false, source: "Inngest Pro, $50 per extra million executions", checked: CHECKED },
  "infra.files": { label: "Cloudflare R2 storage (no egress fees)", area: "infra", usd: 0.015, per: "GB-month", inAiAllowance: false, source: "Cloudflare R2 standard storage, $0.015/GB-month", checked: CHECKED },
} satisfies Record<string, Unit>;

export type UnitId = keyof typeof UNITS;

/** Monthly bills that do not grow per person, spread over PAYING_SEATS. */
export const FIXED: { label: string; usdMonth: number; source: string }[] = [
  { label: "Vercel Pro, two developer seats (each includes $20 of usage)", usdMonth: 40, source: "Vercel Pro, $20 per seat a month" },
  { label: "Inngest Pro (1M executions, once past the free 50,000)", usdMonth: 99, source: "Inngest Pro, from $99 a month" },
  { label: "Market data (FMP Starter; a redistribution licence is still to be priced)", usdMonth: 19, source: "README, Company and filing data" },
  { label: "CoinGecko Analyst, when the crypto work turns the paid tier on", usdMonth: 129, source: "CoinGecko API pricing" },
  { label: "Helius Developer (Solana RPC), when turned on", usdMonth: 49, source: "Helius Developer plan, $49 a month for 10M credits" },
  { label: "Desktop app signing: Apple Developer Program ($99 a year) and Windows code signing (about $10 a month)", usdMonth: 99 / 12 + 10, source: "Apple Developer Program; Azure Trusted Signing basic tier" },
  { label: "Transactional email for receipts and invites (Resend Pro; mail people send goes through their own mailbox)", usdMonth: 20, source: "Resend Pro, $20 a month for 50,000 emails" },
];

export const fixedMonthlyUsd = () => FIXED.reduce((s, f) => s + f.usdMonth, 0);

/** Stripe: card processing on every invoice, plus Stripe Billing on subscription revenue. */
export const STRIPE_FEES = { percent: 0.029, fixedUsd: 0.3, billingPercent: 0.007, source: "Stripe standard US pricing: 2.9% + $0.30 per card charge; Billing 0.7% of billing volume", checked: CHECKED };

export type Usage = Partial<Record<UnitId, number>>;

/** Infrastructure each person uses in a month, by level. */
const INFRA: Record<Level, Usage> = {
  light: { "infra.db_compute": 0.2, "infra.db_storage": 0.05, "infra.functions": 0.1, "infra.transfer": 0.5, "infra.jobs": 200, "infra.files": 0.1 },
  typical: { "infra.db_compute": 0.8, "infra.db_storage": 0.25, "infra.functions": 0.4, "infra.transfer": 2, "infra.jobs": 2_000, "infra.files": 0.5 },
  heavy: { "infra.db_compute": 3, "infra.db_storage": 1, "infra.functions": 1.5, "infra.transfer": 8, "infra.jobs": 10_000, "infra.files": 3 },
};

/** Uses a month of each metered premium feature a plan unlocks, by level. */
export const PREMIUM_USES: Record<Level, number> = { light: 0, typical: 4, heavy: 20 };

/**
 * What one person does in a month (about 21 working days), per plan and level. Heavy is set high on
 * purpose: the AI part is capped at the plan's allowance below, which is what limits.ts enforces.
 */
export const USAGE: Record<PlanId, Record<Level, Usage>> = {
  free: {
    light: { "ai.answer": 4, "edge.answer": 2 },
    typical: { "ai.answer": 12, "ai.run": 1, "edge.answer": 5 },
    heavy: { "ai.answer": 200, "ai.run": 20 },
  },
  campus: {
    light: { "ai.answer": 10, "ai.run": 1, "edge.answer": 5 },
    typical: { "ai.answer": 25, "ai.run": 3, "ai.studio": 1, "edge.answer": 15, "edge.ingest": 2 },
    heavy: { "ai.answer": 300, "ai.run": 30, "ai.studio": 6 },
  },
  pro: {
    light: { "ai.answer": 15, "ai.run": 2, "edge.answer": 5, "mail.mailbox": 1, "mail.triage": 150, "mail.draft": 20 },
    typical: { "ai.answer": 40, "ai.run": 5, "ai.studio": 1, "edge.answer": 15, "edge.ingest": 3, "mail.mailbox": 1, "mail.triage": 300, "mail.draft": 50 },
    heavy: { "ai.answer": 300, "ai.run": 40, "ai.studio": 8, "ai.deep": 10, "edge.answer": 100, "edge.ingest": 20, "mail.mailbox": 1, "mail.triage": 1_000, "mail.draft": 250 },
  },
  team: {
    light: { "ai.answer": 20, "ai.run": 3, "edge.answer": 10, "mail.mailbox": 1, "mail.triage": 300, "mail.draft": 60 },
    typical: { "ai.answer": 60, "ai.run": 10, "ai.studio": 2, "ai.deep": 1, "edge.answer": 25, "edge.ingest": 5, "edge.ground_check": 10, "mail.mailbox": 1, "mail.triage": 600, "mail.draft": 150 },
    heavy: { "ai.answer": 500, "ai.run": 80, "ai.studio": 15, "ai.deep": 25, "edge.answer": 200, "edge.ingest": 40, "edge.ground_check": 60, "mail.mailbox": 2, "mail.triage": 2_000, "mail.draft": 600 },
  },
  enterprise: {
    light: { "ai.answer": 25, "ai.run": 4, "edge.answer": 15, "mail.mailbox": 1, "mail.triage": 300, "mail.draft": 60 },
    typical: { "ai.answer": 80, "ai.run": 15, "ai.studio": 4, "ai.deep": 4, "edge.answer": 20, "edge.answer_large": 20, "edge.ingest": 20, "edge.parse_hard": 5, "edge.transcribe": 4, "edge.ground_check": 20, "mail.mailbox": 1, "mail.triage": 800, "mail.draft": 200 },
    heavy: { "ai.answer": 800, "ai.run": 150, "ai.studio": 30, "ai.deep": 60, "edge.answer_large": 300, "edge.ingest": 100, "edge.parse_hard": 30, "edge.transcribe": 20, "edge.ground_check": 150, "mail.mailbox": 2, "mail.triage": 3_000, "mail.draft": 1_000 },
  },
};

export type CostBreakdown = {
  /** Spend counted against the AI allowance, before and after the plan's monthly cap. */
  aiUncapped: number;
  ai: number;
  /** Paid APIs and compute outside the AI ledger, including metered premium features. */
  other: number;
  premium: number;
  infra: number;
  /** This seat's share of the fixed bills (paid plans only; free use is a marketing cost). */
  fixed: number;
  total: number;
};

const unitCost = (usage: Usage, pick: (u: Unit) => boolean) =>
  (Object.entries(usage) as [UnitId, number][]).reduce((s, [id, n]) => (pick(UNITS[id]) ? s + UNITS[id].usd * n : s), 0);

/** The metered premium features a plan unlocks, from the shared registry. */
export const meteredFeatures = (plan: PlanId) => FEATURES.filter((f) => f.metered && planAtLeast(plan, f.minPlan));

/** What one person on `plan` costs us in a month at `level`. */
export function costToServe(plan: PlanId, level: Level, usage: Usage = USAGE[plan][level]): CostBreakdown {
  const aiUncapped = unitCost(usage, (u) => u.inAiAllowance);
  const ai = Math.min(aiUncapped, PLANS[plan].ai.monthlyUsd);
  const other = unitCost(usage, (u) => !u.inAiAllowance && u.area !== "infra");
  const premium = meteredFeatures(plan).reduce((s, f) => s + (f.costPerUseUsd ?? 0) * PREMIUM_USES[level], 0);
  const infra = unitCost(INFRA[level], () => true);
  const fixed = PLANS[plan].monthlyUsd || PLANS[plan].yearlyMonthlyUsd ? fixedMonthlyUsd() / PAYING_SEATS : 0;
  return { aiUncapped, ai, other, premium, infra, fixed, total: ai + other + premium + infra + fixed };
}

export type Interval = "monthly" | "yearly";

/** Price per seat per month for an interval, or null when the plan is not sold that way. */
export function seatPrice(plan: PlanId, interval: Interval): number | null {
  const p = PLANS[plan];
  return interval === "monthly" ? p.monthlyUsd : p.yearlyMonthlyUsd;
}

/** Stripe's share of one seat-month, with the per-charge fee split over the seats and months one invoice covers. */
export function feesPerSeatMonth(price: number, interval: Interval, seats: number): number {
  if (price <= 0) return 0;
  const charges = interval === "yearly" ? 1 / 12 : 1;
  return price * (STRIPE_FEES.percent + STRIPE_FEES.billingPercent) + (STRIPE_FEES.fixedUsd * charges) / Math.max(1, seats);
}

export type MarginRow = { plan: PlanId; level: Level; interval: Interval; price: number; fees: number; cost: CostBreakdown; margin: number };

/** Gross margin per seat: (price - Stripe fees - cost to serve) / price; null for plans with no price that way. */
export function margin(plan: PlanId, level: Level, interval: Interval): MarginRow | null {
  const price = seatPrice(plan, interval);
  if (!price) return null;
  const fees = feesPerSeatMonth(price, interval, PLANS[plan].minSeats);
  const cost = costToServe(plan, level);
  return { plan, level, interval, price, fees, cost, margin: (price - fees - cost.total) / price };
}

/** Every plan, level and interval that has a price. */
export function marginTable(): MarginRow[] {
  return PLAN_ORDER.flatMap((plan) => LEVELS.flatMap((level) => (["monthly", "yearly"] as Interval[]).map((i) => margin(plan, level, i)).filter((r): r is MarginRow => !!r)));
}

/** About how many default-model assistant answers a dollar amount buys, for plain-English allowances. */
export const answersFor = (usd: number) => Math.floor(usd / UNITS["ai.answer"].usd);
