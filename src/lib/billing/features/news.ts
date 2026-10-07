import type { PremiumFeature } from "./types";

/**
 * Premium features: the Newsroom (the newsroom work owns this file). The Newsroom itself stays free:
 * the feed, the four editions and the front page, the globe, story charts, timelines and relationship
 * maps, Brief mode, the 60-second recap, public story pages, rule-based "why this matters to you",
 * the browser-voiced briefing and up to five story follows. What is here is what costs us per use.
 *
 * Costs are list prices, worked out per use:
 * - An audio briefing is about 600 words (four minutes). The script is one small-model call (about
 *   4,000 tokens in, 1,200 out: under half a cent); the voice is gpt-4o-mini-tts at about $0.015 a
 *   minute of audio ($12 per million audio tokens), so about $0.06. Together, $0.065.
 * - "Why it matters to you" is one small-model call of about 900 tokens in and 120 out: a tenth of a cent.
 */
export const NEWS_FEATURES: PremiumFeature[] = [
  {
    id: "news.audio", area: "ai", name: "AI audio briefing",
    description: "Your desks and lenses as a short spoken briefing: a script written by AI from your stories and read by a natural neural voice, with a chapter per story. The free version reads the stories aloud with your browser's voice.",
    minPlan: "pro", metered: true, costPerUseUsd: 0.065,
  },
  {
    id: "news.audio-daily", area: "ai", name: "Daily audio briefing",
    description: "Your AI audio briefing written and voiced automatically each morning at your brief time, waiting in the bell. Runs only while you keep it switched on.",
    minPlan: "pro", metered: true, costPerUseUsd: 0.065,
  },
  {
    id: "news.why-ai", area: "ai", name: "AI \"why it matters to you\"",
    description: "A two-sentence note on what a story changes for your clients, deals or coverage, written for you on request. The matches with your watchlist, contacts, pipeline and Edge watches stay free.",
    minPlan: "pro", metered: true, costPerUseUsd: 0.001,
  },
  {
    id: "news.follows", area: "platform", name: "Unlimited story follows",
    description: "Follow as many developing stories as you like (five on the free plan) and get an alert in the bell, and by push, each time one moves.",
    minPlan: "pro", metered: false,
  },
];
