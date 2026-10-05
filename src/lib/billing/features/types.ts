import type { PlanId } from "../plans";

/** Where a premium feature lives, for grouping on the pricing page and in Settings. */
export type FeatureArea = "ai" | "edge" | "maps" | "crypto" | "studio" | "relationships" | "desktop" | "platform";

/**
 * A feature that needs a paid plan. The code behind it is complete; the plan decides who may use it.
 *
 * Rules every premium feature follows (docs/premium.md):
 * - it spends money (paid APIs, large models, heavy compute) only when a person deliberately starts it:
 *   never from a cron, a prefetch, a page load or a background refresh;
 * - the server checks the plan (`requireFeature`) before it spends; the badge in the UI is only a hint;
 * - administrators (ADMIN_EMAILS) may always use it.
 */
export type PremiumFeature = {
  /** Stable id, `area.name`, e.g. "maps.lidar". */
  id: string;
  area: FeatureArea;
  name: string;
  /** What it does, in a sentence, for the locked badge and the pricing page. */
  description: string;
  /** The least plan that includes it. */
  minPlan: PlanId;
  /** Whether using it costs money per use (a paid API or a large model), as opposed to only being a paid perk. */
  metered: boolean;
  /** Rough cost to us per use in US dollars, for the pricing model; 0 when not metered. */
  costPerUseUsd?: number;
  /** What one use is, for reading `costPerUseUsd` (e.g. "an hour-long call at $0.006 a minute"). */
  perUse?: string;
};
