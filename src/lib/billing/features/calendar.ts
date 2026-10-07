import type { PremiumFeature } from "./types";

/**
 * Premium features: the calendar (the calendar work owns this file). Connecting one calendar, the
 * calendar view, linking meetings to Relationships, the assembled (non-AI) meeting brief, and
 * creating, rescheduling and cancelling meetings stay free.
 *
 * Costs: a brief is one structured call on the "draft" route (gpt-5.6-terra or claude-sonnet-5 at
 * low effort), about 8,000 tokens in and 1,200 out: roughly $0.016 + $0.014 = $0.03 at list prices
 * (src/lib/ai/pricing.ts). The morning run briefs up to eight external meetings a day; a typical day
 * has two or three, so about $0.09 a run. Extra accounts and smart scheduling call only free
 * provider APIs (sync, free/busy), so they are perks, not metered.
 */
export const CALENDAR_FEATURES: PremiumFeature[] = [
  {
    id: "calendar.ai_brief", area: "relationships", name: "AI meeting briefs",
    description: "Turn what YouBank knows about a meeting's people, companies and deals into objectives, talking points and questions.",
    minPlan: "pro", metered: true, costPerUseUsd: 0.03,
  },
  {
    id: "calendar.auto_brief", area: "relationships", name: "Morning auto-briefs",
    description: "Each morning, brief every external meeting on your calendar that day, before you ask.",
    minPlan: "pro", metered: true, costPerUseUsd: 0.09,
  },
  {
    id: "calendar.multi_account", area: "relationships", name: "More than one calendar account",
    description: "Connect several calendar accounts (work and personal, Google and iCloud) and see them merged.",
    minPlan: "pro", metered: false, costPerUseUsd: 0,
  },
  {
    id: "calendar.smart_scheduling", area: "relationships", name: "Smart scheduling in drafts",
    description: "The email agent proposes meeting times from your real availability when a thread is about finding a time.",
    minPlan: "pro", metered: false, costPerUseUsd: 0,
  },
];
