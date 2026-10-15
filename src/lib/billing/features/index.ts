/**
 * Every premium feature, from one list per area. Each area's file is owned by the work on that area,
 * so changes to one never conflict with another. Pure data, safe to import on the client.
 */
import { CALENDAR_FEATURES } from "./calendar";
import { COPYTRADE_FEATURES } from "./copytrade";
import { CRYPTO_FEATURES } from "./crypto";
import { DESKTOP_FEATURES } from "./desktop";
import { EDGE_NEXT_FEATURES } from "./edge-next";
import { MAPS_FEATURES } from "./maps";
import { MEETINGS_FEATURES } from "./meetings";
import { NEWS_FEATURES } from "./news";
import { PREMIUM_FEATURES } from "./premium";
import { QUANT_FEATURES } from "./quant";
import type { FeatureArea, PremiumFeature } from "./types";

export type { FeatureArea, PremiumFeature } from "./types";

export const FEATURES: PremiumFeature[] = [...PREMIUM_FEATURES, ...MAPS_FEATURES, ...CRYPTO_FEATURES, ...DESKTOP_FEATURES, ...EDGE_NEXT_FEATURES, ...COPYTRADE_FEATURES, ...CALENDAR_FEATURES, ...NEWS_FEATURES, ...MEETINGS_FEATURES, ...QUANT_FEATURES];

const BY_ID = new Map(FEATURES.map((f) => [f.id, f]));

export function featureById(id: string): PremiumFeature | undefined {
  return BY_ID.get(id);
}

/** Each area's heading on the pricing page and in Settings, in the order they are shown. */
export const AREA_LABEL: Record<FeatureArea, string> = {
  ai: "AI", edge: "Edge", studio: "Studio", relationships: "Relationships, meetings and calendar", maps: "3D maps and geospatial AI",
  crypto: "Blockchain and crypto", desktop: "Desktop app", platform: "Platform", quant: "Quant",
};
export const AREA_ORDER = Object.keys(AREA_LABEL) as FeatureArea[];

/**
 * The features people can have today, grouped by area in AREA_ORDER (registry order within an area).
 * `planned` ones are left out: they are registered for the cost model but unlock nothing yet.
 */
export function featuresByArea(list: PremiumFeature[] = FEATURES): { area: FeatureArea; label: string; features: PremiumFeature[] }[] {
  const live = list.filter((f) => !f.planned);
  return AREA_ORDER.map((area) => ({ area, label: AREA_LABEL[area], features: live.filter((f) => f.area === area) })).filter((g) => g.features.length > 0);
}
