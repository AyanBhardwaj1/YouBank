import type { PremiumFeature } from "./types";

/**
 * Premium features of Edge's next round (docs/edge-next.md, section 6): the Precedent Engine, Calibrated
 * Claims, the Alt-Data Pulse, the Deal Radar, the Call Desk, the LBO Stress Lab, the Thesis Agent and the
 * Voice Analyst. The core of each stays free on every plan (docs/pricing.md, "Edge's next round: what's
 * free, what's premium and why"): the deal database with similar deals and ranges, claim dots and Strict
 * mode, the weekly Pulse, the Radar board for watched companies and movers, a call read by the free
 * classifier with its promises ledger, the 1,000-path LBO preview with its reverse stress test, one thesis
 * (14 days, daily, small model, $0.50 budget) and hold-to-talk. These are the layers on top.
 *
 * Costs are list prices checked on 14 October 2026 (src/lib/ai/pricing.ts, ml/edge_ml.py's Modal rates and
 * the providers' pages), worked out for one use as `perUse` says, rounded up, with cold starts and idle
 * tails included for GPU and CPU work. Ids marked `planned` are registered so the pricing work could tier
 * them; no route checks them yet, and the work that builds one removes the flag. The cost model counts
 * planned features too, so building one never surprises the margins.
 *
 * `inAiAllowance` marks spend recorded in the AI usage ledger (`recordUsage`, through `structured()` or
 * directly) against the person: the routes run inside `guarded()`, and a thesis's ticks run as their owner
 * (`runAsUser` in agent/store.ts), so that spend draws down the person's AI allowance and credits and is
 * capped by them. GPU and Modal time (the Eva-4B ensemble, the LBO refine) is paid outside the ledger, so
 * those two carry server-side daily caps instead (their routes) and leave the flag unset. A perk whose
 * only cost is a little background compute (the daily Pulse) is metered as a flat monthly figure.
 */
export const EDGE_NEXT_FEATURES: PremiumFeature[] = [
  /* ---------------- Precedent Engine (E1) ---------------- */
  {
    id: "edge.deals-reread", area: "edge", name: "Re-read a deal with the stronger model",
    description: "One deal's merger documents read again by the stronger model, with every term re-quoted and re-checked.",
    minPlan: "pro", metered: true, inAiAllowance: true, costPerUseUsd: 0.24,
    perUse: "a deal: about 40,000 tokens in at $4 and 4,000 out at $20 per million on gpt-5.6-sol (EDGE_REREAD_MODEL), recorded in the AI ledger; ten an hour",
  },
  {
    id: "edge.deals-export", area: "edge", name: "Precedent exports",
    description: "Export more than 50 precedent transactions at once, with each term's quote and source.",
    minPlan: "pro", metered: false, costPerUseUsd: 0,
    perUse: "a perk: the rows are already stored; one query and a CSV",
  },
  {
    id: "edge.deals-private", area: "edge", name: "Private precedent library",
    description: "Your own CIMs and closing memos read into private precedents beside the public ones.",
    minPlan: "team", metered: true, inAiAllowance: true, costPerUseUsd: 0.05, planned: true,
    perUse: "a document: about four sections on the small model plus embeddings; must record through the AI ledger when built",
  },
  /* ---------------- Calibrated Claims (E2) ---------------- */
  {
    id: "edge.claims-crosscheck", area: "edge", name: "Second-provider claim check",
    description: "Each claim in an answer judged again by a second provider's model, as one more verification signal.",
    minPlan: "pro", metered: true, inAiAllowance: true, costPerUseUsd: 0.03,
    perUse: "an answer: about 10,000 tokens in at $2 and 1,000 out at $10 per million on Claude Sonnet 5.5 (output capped at 1,500), recorded in the AI ledger",
  },
  /* ---------------- Alt-Data Pulse (E3) ---------------- */
  {
    id: "edge.pulse-daily", area: "edge", name: "Daily Pulse",
    description: "Hiring and attention signals refreshed daily instead of weekly for up to 50 companies you choose.",
    minPlan: "pro", metered: true, costPerUseUsd: 0, flatMonthlyUsd: 0.2,
    perUse: "a month of a full 50-company daily list: about 1,500 refreshes of free sources at roughly 2 s of Vercel CPU each ($0.11) plus about half a Neon compute-hour ($0.05); companies shared between lists are read once, and the plan is re-checked every day",
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
    minPlan: "team", metered: true, costPerUseUsd: 0.05,
    perUse: "a call: about 3.5 minutes billed on a Modal T4 with 2 cores and 16 GiB (about $0.00023 a second): the 8 GB of weights loading on a cold container, scoring, and the 60-second idle tail; paid outside the AI ledger, so capped at ten a day",
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
    minPlan: "pro", metered: true, costPerUseUsd: 0.005,
    perUse: "a refine: about 130 s billed on two Modal CPU cores with 4 GiB ($0.000035 a second: a minute of paths, the start-up and the 60-second idle tail) plus four Inngest steps, or a few seconds of Vercel CPU without the ML service; paid outside the AI ledger, so capped at 25 a day",
  },
  /* ---------------- Thesis Agent (E7) ---------------- */
  {
    id: "edge.thesis-plus", area: "edge", name: "More theses",
    description: "Up to five active theses with 90-day horizons and checks twice a day.",
    minPlan: "pro", metered: true, inAiAllowance: true, costPerUseUsd: 0.35,
    perUse: "a month of one thesis checked twice a day: about 60 ticks of free tool reads plus evidence extraction on gpt-6-luna (about 8,000 tokens in, 1,000 out), a red team on Claude Sonnet when a claim moves 10 points (about one tick in five), and the weekly pre-mortem and synthesis on the small model; recorded in the AI ledger as the owner, and stopped by the thesis's budget ($5 by default, $25 at most), its horizon and 180 ticks",
  },
  {
    id: "edge.thesis-deep", area: "edge", name: "Weekly deep synthesis",
    description: "A weekly deep synthesis of each thesis on the flagship model at maximum reasoning.",
    minPlan: "pro", metered: true, inAiAllowance: true, costPerUseUsd: 1.0,
    perUse: "a weekly pass: about 40,000 tokens in at $10 and at most 12,000 out at $50 per million on the flagship model at maximum effort, recorded in the AI ledger as the owner and refused by the runtime once the thesis's budget would be passed",
  },
  {
    id: "edge.thesis-team", area: "edge", name: "Team theses",
    description: "Theses shared with your team, who can follow them and add evidence.",
    minPlan: "team", metered: false, costPerUseUsd: 0,
    perUse: "a perk: the same ticks, shared; the owner's allowance and budget pay for them",
  },
  /* ---------------- Voice Analyst (E13); hold-to-talk is free ---------------- */
  {
    id: "edge.voice-realtime", area: "edge", name: "Live voice analyst",
    description: "A real-time spoken conversation with Edge, answers cited as on screen.",
    minPlan: "pro", metered: true, inAiAllowance: true, costPerUseUsd: 0.33,
    perUse: "a live session of about three minutes at $0.11 a minute (two-minute minimum recorded when the key is minted, ten-minute cap, three a day), recorded in the AI ledger",
  },
];
