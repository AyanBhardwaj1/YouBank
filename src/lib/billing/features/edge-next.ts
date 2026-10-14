import type { PremiumFeature } from "./types";

/**
 * Premium features of Edge's next round (docs/edge-next.md, section 6): the Precedent Engine, Calibrated
 * Claims, the Alt-Data Pulse, the Deal Radar, the Call Desk, the LBO Stress Lab and the Thesis Agent, and the
 * Voice Analyst (stretch). Every free core of these features stays free; these are
 * the layers on top.
 *
 * Costs are list prices checked on 5 October 2026 (src/lib/ai/pricing.ts and the providers' pages), worked
 * out for one use as `perUse` says. Perks that cost us nothing measurable are not metered and cost 0 (the
 * screener reads stored scores; the daily Pulse reads free APIs). Ids marked `planned` are registered so the
 * pricing work can tier them; no route checks them yet, and the work that builds one removes the flag.
 *
 * `inAiAllowance` marks the features whose spend is a model call recorded in the AI usage ledger
 * (`recordUsage`, through `structured()` and the answer paths): that spend draws down the person's AI
 * allowance and credits, so the pricing model counts it inside the allowance rather than on top. GPU and
 * Modal time (the Eva-4B ensemble, the LBO refine) is paid outside the ledger and leaves it unset. Peer
 * calls and theses record their model calls through `structured()` (and so `recordUsage`); the planned
 * private library must do the same when it is built, or drop the flag.
 */
export const EDGE_NEXT_FEATURES: PremiumFeature[] = [
  /* ---------------- Precedent Engine (E1) ---------------- */
  {
    id: "edge.deals-reread", area: "edge", name: "Re-read a deal with the stronger model",
    description: "One deal's merger documents read again by the stronger model, with every term re-quoted and re-checked.",
    minPlan: "pro", metered: true, inAiAllowance: true, costPerUseUsd: 0.24,
    perUse: "a deal: about 40,000 tokens in at $4 and 4,000 out at $20 per million on gpt-5.6-sol",
  },
  {
    id: "edge.deals-export", area: "edge", name: "Precedent exports",
    description: "Export more than 50 precedent transactions at once, with each term's quote and source.",
    minPlan: "pro", metered: false, costPerUseUsd: 0,
    perUse: "a perk: the rows are already stored",
  },
  {
    id: "edge.deals-private", area: "edge", name: "Private precedent library",
    description: "Your own CIMs and closing memos read into private precedents beside the public ones.",
    minPlan: "team", metered: true, inAiAllowance: true, costPerUseUsd: 0.05, planned: true,
    perUse: "a document: about four sections on the small model plus embeddings",
  },
  /* ---------------- Calibrated Claims (E2) ---------------- */
  {
    id: "edge.claims-crosscheck", area: "edge", name: "Second-provider claim check",
    description: "Each claim in an answer judged again by a second provider's model, as one more verification signal.",
    minPlan: "pro", metered: true, inAiAllowance: true, costPerUseUsd: 0.03,
    perUse: "an answer: about 10,000 tokens in at $2 and 1,000 out at $10 per million on Claude Sonnet 5.5",
  },
  /* ---------------- Alt-Data Pulse (E3) ---------------- */
  {
    id: "edge.pulse-daily", area: "edge", name: "Daily Pulse",
    description: "Hiring and attention signals refreshed daily instead of weekly for up to 50 companies you choose.",
    minPlan: "pro", metered: false, costPerUseUsd: 0,
    perUse: "a perk: the job boards, Wikipedia and USAspending are free to read",
  },
  {
    id: "edge.pulse-licensed", area: "edge", name: "Licensed alternative data",
    description: "Bring your own Revelio Labs, Coresignal, Similarweb or Apptopia keys into the Pulse.",
    minPlan: "enterprise", metered: false, costPerUseUsd: 0, planned: true,
    perUse: "covered by the customer's own licence",
  },
  /* ---------------- Deal Radar (E4) ---------------- */
  {
    id: "edge.odds-screener", area: "edge", name: "Deal Radar screener",
    description: "Filter and export every company Deal Radar scores by its sale odds, sector and size.",
    minPlan: "pro", metered: false, costPerUseUsd: 0,
    perUse: "a perk: one database query over stored scores, well under a tenth of a cent",
  },
  {
    id: "edge.odds-pairs", area: "edge", name: "Buyer and target odds",
    description: "The joint odds that a given buyer acquires a given target within twelve months.",
    minPlan: "pro", metered: false, costPerUseUsd: 0, planned: true,
    perUse: "a perk: stored acquirer odds combined with the deal model's pair score",
  },
  /* ---------------- Call Desk (E5) ---------------- */
  {
    id: "edge.calls-eva", area: "edge", name: "Evasion ensemble (Eva-4B)",
    description: "Earnings-call answers also scored by the Eva-4B classifier on a GPU and averaged with the free classifier (off until its licence is confirmed).",
    minPlan: "pro", metered: true, costPerUseUsd: 0.03,
    perUse: "a call: about 90 seconds of a Modal T4 at $0.59 an hour with its CPU and memory, cold start included; paid outside the AI ledger",
  },
  {
    id: "edge.calls-peers", area: "edge", name: "Peer call comparison",
    description: "Evasion and promises compared across up to six companies' latest earnings calls, with a written comparison.",
    minPlan: "pro", metered: true, inAiAllowance: true, costPerUseUsd: 0.002,
    perUse: "a comparison: the stored call summaries (read by the free classifier) and one small-model call, about 2,000 tokens in and 400 out on gpt-6-luna, recorded in the AI ledger",
  },
  /* ---------------- LBO Stress Lab (E6) ---------------- */
  {
    id: "edge.lbo-refine", area: "edge", name: "LBO refine",
    description: "An LBO stress test rerun over 20,000 synthetic paths and up to seven years.",
    minPlan: "pro", metered: true, costPerUseUsd: 0.003,
    perUse: "a refine: about a minute of two Modal CPU cores with 4 GiB, cold start included (about $0.002), or a few seconds of Vercel CPU when the ML service is not set up; paid outside the AI ledger",
  },
  /* ---------------- Thesis Agent (E7) ---------------- */
  {
    id: "edge.thesis-plus", area: "edge", name: "More theses",
    description: "Up to five active theses with 90-day horizons and checks twice a day.",
    minPlan: "pro", metered: true, inAiAllowance: true, costPerUseUsd: 0.02,
    perUse: "a tick: Edge's tool reads (free) plus evidence extraction on gpt-6-luna (about 8,000 tokens in, 1,000 out) and, when a claim moves 10 points, a red team on a second provider (Claude Sonnet, about 6,000 in and 600 out); recorded in the AI ledger",
  },
  {
    id: "edge.thesis-deep", area: "edge", name: "Weekly deep synthesis",
    description: "A weekly deep synthesis of each thesis on the flagship model at maximum reasoning.",
    minPlan: "pro", metered: true, inAiAllowance: true, costPerUseUsd: 1.2,
    perUse: "a weekly pass: about 40,000 tokens in at $10 and 15,000 out at $50 per million on the flagship model at maximum effort, recorded in the AI ledger",
  },
  {
    id: "edge.thesis-team", area: "edge", name: "Team theses",
    description: "Theses shared with your team, who can follow them and add evidence.",
    minPlan: "team", metered: false, costPerUseUsd: 0,
    perUse: "a perk: the same ticks, shared",
  },
  /* ---------------- Voice Analyst (E13), stretch ---------------- */
  {
    id: "edge.voice-realtime", area: "edge", name: "Live voice analyst",
    description: "A real-time spoken conversation with Edge, answers cited as on screen.",
    minPlan: "pro", metered: true, inAiAllowance: true, costPerUseUsd: 0.1, planned: true,
    perUse: "a minute of gpt-realtime-2.1, about $0.06 to $0.11",
  },
];
