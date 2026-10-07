import type { PremiumFeature } from "./types";

/**
 * Premium features: AI, Edge, Studio, relationships and platform features (the premium work owns this file).
 *
 * Every entry here is built and checked on the server: `requireFeature` before the paid call, or the
 * premium scope in lib/billing/use.ts for upgrades that apply on their own (reranking) to a question a
 * person asked. Costs are list prices checked on 30 September 2026, worked out for one use as `perUse`
 * describes and rounded up; the pricing model reads them, so they say what a use costs us, not what we
 * charge. Edge's upgrades that need a key (lib/edge/premium.ts) name their feature here: the plan
 * decides who may use one, the key whether it can run at all.
 */
export const PREMIUM_FEATURES: PremiumFeature[] = [
  /* ---------------- Edge: documents ---------------- */
  {
    id: "edge.rerank", area: "edge", name: "Premium reranking",
    description: "Every document question is reranked by Voyage rerank-3 (or Cohere Rerank 4) before the answer is written, so quotes come from the right paragraphs.",
    minPlan: "pro", metered: true, inAiAllowance: true, costPerUseUsd: 0.0025,
    perUse: "a question: about 100 passages of 500 tokens through Voyage at $0.05 per million tokens, or one Cohere search at $2.50 per 1,000",
  },
  {
    id: "edge.answer-model", area: "edge", name: "Stronger answer model",
    description: "Answers across long filings written by a larger model (gpt-5.6-sol by default) for hard multi-period questions.",
    minPlan: "pro", metered: true, inAiAllowance: true, costPerUseUsd: 0.09,
    perUse: "an answer: about 9,000 tokens in at $4 and 2,500 out at $20 per million",
  },
  {
    id: "edge.citations", area: "edge", name: "Exact-span citations",
    description: "Answers written through Anthropic's Citations, so every quote is an exact span of the source and cannot drift from the text.",
    minPlan: "pro", metered: true, inAiAllowance: true, costPerUseUsd: 0.04,
    perUse: "an answer on Claude Sonnet 5.5: about 10,000 tokens in at $2 and 2,000 out at $10 per million (quoted text is not billed)",
  },
  {
    id: "edge.batch-ask", area: "edge", name: "Ask across companies",
    description: "One question answered separately for up to six companies from each one's own filings, side by side, every answer cited.",
    minPlan: "pro", metered: true, inAiAllowance: true, costPerUseUsd: 1.3,
    perUse: "six cited answers on the default model (about $0.22 each) with their small-model steps",
  },
  {
    id: "edge.transcribe-diarize", area: "edge", name: "Speaker-labelled transcripts",
    description: "Calls and meetings transcribed by OpenAI's diarizing model, so every passage says who spoke.",
    minPlan: "pro", metered: true, inAiAllowance: true, costPerUseUsd: 0.36,
    perUse: "an hour-long call at $0.006 a minute",
  },
  {
    id: "edge.parse-llamaparse", area: "edge", name: "Hard PDFs read by LlamaParse",
    description: "Scanned and table-heavy PDFs (data rooms, CIMs) read by LlamaParse's agentic tier with layout and tables intact.",
    minPlan: "pro", metered: true, inAiAllowance: true, costPerUseUsd: 0.63,
    perUse: "a 50-page PDF at 10 credits a page and $1.25 per 1,000 credits (the first 10,000 credits a month are free)",
  },
  /* ---------------- Edge: earth, scenarios, networks ---------------- */
  {
    id: "edge.planet", area: "edge", name: "Sharper satellite imagery",
    description: "Planet's 3 m daily and 50 cm SkySat scenes of a plant from the last 60 days, beside Sentinel-2's 10 m.",
    minPlan: "pro", metered: false, costPerUseUsd: 0,
    perUse: "searching and thumbnails come with the Planet account; nothing is bought per view",
  },
  {
    id: "edge.nightfire", area: "edge", name: "Flare volumes (Nightfire)",
    description: "Flared gas volumes at a plant estimated from the Colorado School of Mines' VIIRS Nightfire detections, beside radiant heat.",
    minPlan: "enterprise", metered: false, costPerUseUsd: 0,
    perUse: "covered by the yearly Nightfire data licence; reading the nightly files costs nothing more",
  },
  {
    id: "edge.timesfm", area: "edge", name: "TimesFM forecasts",
    description: "Forecasts of oil, gas, rates and the market from Google's TimesFM foundation model through BigQuery, with 10-90% bands.",
    minPlan: "pro", metered: true, inAiAllowance: true, costPerUseUsd: 0.001,
    perUse: "one BigQuery AI.FORECAST query, billed at the 10 MB minimum of $6.25 per TiB",
  },
  {
    id: "edge.graph-gpu", area: "edge", name: "GPU retraining of the deal model",
    description: "Retrain the likely-buyers model on a GPU with a larger network and more passes, on request.",
    minPlan: "enterprise", metered: true, costPerUseUsd: 0.2,
    perUse: "about 15 minutes of a Modal T4 at $0.59 an hour, with its CPU and memory",
  },
  /* ---------------- AI ---------------- */
  {
    id: "ai.deep-research", area: "ai", name: "Deep research",
    description: "The assistant plans, searches and cross-checks at maximum reasoning effort with up to 30 tool steps, and says what it could not verify.",
    minPlan: "pro", metered: true, inAiAllowance: true, costPerUseUsd: 2.5,
    perUse: "a run on GPT-6 Astra at maximum effort: about 150,000 fresh input tokens at $10 and 20,000 output at $50 per million, with ten web searches",
  },
  /* ---------------- Studio ---------------- */
  {
    id: "studio.deep-build", area: "studio", name: "Deep model builds",
    description: "Studio's agent builds at maximum reasoning effort with more steps, then audits its own model and fixes what the audit finds.",
    minPlan: "pro", metered: true, inAiAllowance: true, costPerUseUsd: 3,
    perUse: "a build of up to 40 steps plus a review pass on GPT-6 Astra at maximum effort",
  },
  /* ---------------- Relationships ---------------- */
  {
    id: "relationships.extra-mailboxes", area: "relationships", name: "More mailboxes",
    description: "Connect more than one mailbox (a work and a personal address, or a shared deal inbox) to the relationships agent.",
    minPlan: "team", metered: false, costPerUseUsd: 0,
    perUse: "a perk: each mailbox is read on the same schedule as the first",
  },
  {
    id: "relationships.autopilot", area: "relationships", name: "Autopilot",
    description: "The agent sends the emails you set to Autopilot on its own, inside your sending hours and daily cap, after every safety check.",
    minPlan: "team", metered: true, inAiAllowance: true, costPerUseUsd: 0.01,
    perUse: "an email written on the drafting model and sent on its own",
  },
  {
    id: "relationships.campaigns", area: "relationships", name: "Campaigns",
    description: "Multi-step outreach campaigns, each email written for its lead and sent on schedule.",
    minPlan: "team", metered: true, inAiAllowance: true, costPerUseUsd: 0.01,
    perUse: "a campaign email written for one lead on the drafting model",
  },
];
