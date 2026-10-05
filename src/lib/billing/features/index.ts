/**
 * Every premium feature, from one list per area. Each area's file is owned by the work on that area,
 * so changes to one never conflict with another. Pure data, safe to import on the client.
 */
import { CRYPTO_FEATURES } from "./crypto";
import { DESKTOP_FEATURES } from "./desktop";
import { MAPS_FEATURES } from "./maps";
import { PREMIUM_FEATURES } from "./premium";
import type { PremiumFeature } from "./types";

export type { FeatureArea, PremiumFeature } from "./types";

export const FEATURES: PremiumFeature[] = [...PREMIUM_FEATURES, ...MAPS_FEATURES, ...CRYPTO_FEATURES, ...DESKTOP_FEATURES];

const BY_ID = new Map(FEATURES.map((f) => [f.id, f]));

export function featureById(id: string): PremiumFeature | undefined {
  return BY_ID.get(id);
}
