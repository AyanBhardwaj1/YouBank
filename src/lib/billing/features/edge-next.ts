import type { PremiumFeature } from "./types";

/**
 * Premium features of Edge's next round (docs/edge-next.md, section 6): the Precedent Engine, Calibrated
 * Claims, the Alt-Data Pulse and the Deal Radar, built now, and the Call Desk, LBO Stress Lab, Thesis Agent
 * and Voice Analyst, built next on this branch. Every free core of these features stays free; these are
 * the layers on top.
 *
 * Costs are list prices checked on 5 October 2026 (src/lib/ai/pricing.ts and the providers' pages), worked
 * out for one use as `perUse` says. Perks that cost us nothing measurable are not metered and cost 0 (the
 * screener reads stored scores; the daily Pulse reads free APIs). Ids marked `planned` are registered so the
 * pricing work can tier them; no route checks them yet, and the work that builds one removes the flag.
 */
export const EDGE_NEXT_FEATURES: PremiumFeature[] = [
  /* ---------------- Precedent Engine (E1) ---------------- */
  {
    id: "edge.deals-reread", area: "edge", name: "Re-read a deal with the stronger model",
    description: "One deal's merger documents read again by the stronger model, with every term re-quoted and re-checked.",
    minPlan: "pro", metered: true, costPerUseUsd: 0.24,
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
    minPlan: "team", metered: true, costPerUseUsd: 0.05, planned: true,
    perUse: "a document: about four sections on the small model plus embeddings",
  },
  /* ---------------- Calibrated Claims (E2) ---------------- */
  {
    id: "edge.claims-crosscheck", area: "edge", name: "Second-provider claim check",
    description: "Each claim in an answer judged again by a second provider's model, as one more verification signal.",
    minPlan: "pro", metered: true, costPerUseUsd: 0.03,
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
  /* ---------------- Call Desk (E5), next ---------------- */
  {
    id: "edge.calls-eva", area: "edge", name: "Evasion ensemble (Eva-4B)",
    description: "Earnings-call answers scored by the Eva-4B classifier on a GPU, combined with the free rubric.",
    minPlan: "pro", metered: true, costPerUseUsd: 0.03, planned: true,
    perUse: "a call: about 90 seconds of a Modal T4 at $0.59 an hour, with its CPU and memory",
  },
  {
    id: "edge.calls-peers", area: "edge", name: "Peer call comparison",
    description: "Evasion and promises compared across up to six peers' latest earnings calls.",
    minPlan: "pro", metered: true, costPerUseUsd: 0.05, planned: true,
    perUse: "six calls' summaries on the small model plus the comparison",
  },
  /* ---------------- LBO Stress Lab (E6), next ---------------- */
  {
    id: "edge.lbo-refine", area: "edge", name: "LBO refine",
    description: "An LBO stress run over 20,000 paths and seven years on the ML service.",
    minPlan: "pro", metered: true, costPerUseUsd: 0.01, planned: true,
    perUse: "one refine: a few CPU minutes on Modal",
  },
  /* ---------------- Thesis Agent (E7), next ---------------- */
  {
    id: "edge.thesis-plus", area: "edge", name: "More theses",
    description: "Up to five active theses with 90-day horizons and twice-daily checks on filing days.",
    minPlan: "pro", metered: true, costPerUseUsd: 0.25, planned: true,
    perUse: "a tick: routing and extraction on the small model plus about one document question",
  },
  {
    id: "edge.thesis-deep", area: "edge", name: "Weekly deep synthesis",
    description: "A weekly deep-research pass on the flagship model for each thesis.",
    minPlan: "pro", metered: true, costPerUseUsd: 2.5, planned: true,
    perUse: "a pass, priced as ai.deep-research",
  },
  {
    id: "edge.thesis-team", area: "edge", name: "Team theses",
    description: "Theses shared with and edited by your team.",
    minPlan: "team", metered: false, costPerUseUsd: 0, planned: true,
    perUse: "a perk",
  },
  /* ---------------- Voice Analyst (E13), stretch ---------------- */
  {
    id: "edge.voice-realtime", area: "edge", name: "Live voice analyst",
    description: "A real-time spoken conversation with Edge, answers cited as on screen.",
    minPlan: "pro", metered: true, costPerUseUsd: 0.1, planned: true,
    perUse: "a minute of gpt-realtime-2.1, about $0.06 to $0.11",
  },
];
