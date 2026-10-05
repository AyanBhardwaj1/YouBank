import type { PremiumFeature } from "./types";

/** Meetings a person on a plan without `meetings.notes` gets AI notes for, per calendar month (UTC). */
export const MEETINGS_FREE_NOTES = 3;

/**
 * Premium features: the meeting copilot (the meetings work owns this file).
 *
 * Free on every plan: capturing a meeting in the desktop app, its transcript (the cheapest engine that
 * is set up: the ML service's Whisper when there is no OpenAI key; OpenAI's speaker-labelled model,
 * about $0.36 an hour, when there is), the participant brief from Relationships, asking about a meeting
 * within the normal daily AI allowance, and AI notes for the first few meetings each month. What follows
 * costs us money in proportion to use, so it needs a plan:
 * - the notetaker bot joins the call as a participant through Recall.ai, which bills per hour of
 *   recording ($0.50) plus its transcript ($0.15);
 * - live suggestions run a small model about once a minute while the person keeps them switched on
 *   during that meeting (roughly 4,000 tokens in, 600 out: $0.002 to $0.007 a minute by provider);
 * - meeting notes past the free monthly allowance: one larger-model pass over the whole transcript
 *   (about 15,000 tokens in and 5,000 out for an hour) that writes the summary, action items, signals
 *   and follow-up drafts.
 * Costs are rough per-use estimates for the pricing model, not quotes. Every route checks the plan
 * before it spends (`requireFeature`, or the monthly allowance for notes).
 */
export const MEETINGS_FEATURES: PremiumFeature[] = [
  {
    id: "meetings.bot",
    area: "relationships",
    name: "Meeting notetaker bot",
    description: "Send a notetaker to a Zoom, Teams or Meet link: it joins as a participant, records and transcribes with speaker names, and your notes follow. Billed per hour of meeting.",
    minPlan: "pro",
    metered: true,
    costPerUseUsd: 0.65,
  },
  {
    id: "meetings.live",
    area: "relationships",
    name: "Live meeting suggestions",
    description: "While a meeting runs, suggested questions and facts about the people and companies in it, from Relationships and your research. On only while you switch it on for that meeting. Billed per minute.",
    minPlan: "pro",
    metered: true,
    costPerUseUsd: 0.005,
  },
  {
    id: "meetings.notes",
    area: "relationships",
    name: "Unlimited meeting notes",
    description: `AI notes for every meeting: summary, decisions, action items with owners and dates, signals per person, follow-up drafts and proposed CRM updates. ${MEETINGS_FREE_NOTES} meetings a month are free.`,
    minPlan: "pro",
    metered: true,
    costPerUseUsd: 0.1,
  },
];
