"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "@/components/ui/Icon";
import { featureById } from "@/lib/billing/features";
import { PLANS } from "@/lib/billing/plans";
import { useFeature } from "@/lib/client/plan";

/** A small "Pro" (or other plan) badge with a lock while the feature is locked for this person. */
export function PremiumBadge({ feature }: { feature: string }) {
  const unlocked = useFeature(feature);
  const f = featureById(feature);
  if (!f) return null;
  return (
    <span title={f.description} className="inline-flex items-center gap-1 rounded-full border border-accent/40 bg-accent-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent">
      {unlocked === false && <Icon name="Lock" className="h-2.5 w-2.5" />}
      {PLANS[f.minPlan].name}
    </span>
  );
}

/**
 * Show `children` when the feature is unlocked; otherwise a short locked panel pointing to the plan
 * page (or `fallback`). The server still checks the plan before any paid work; this is only the UI.
 */
export function PremiumGate({ feature, children, fallback }: { feature: string; children: ReactNode; fallback?: ReactNode }) {
  const unlocked = useFeature(feature);
  const f = featureById(feature);
  if (unlocked) return <>{children}</>;
  if (unlocked === null) return null;
  if (fallback) return <>{fallback}</>;
  return (
    <div className="rounded-lg border border-line bg-elevated p-4 text-[12.5px]">
      <div className="flex items-center gap-2 font-semibold text-fg"><Icon name="Lock" className="h-3.5 w-3.5" /> {f?.name ?? "Premium feature"} <PremiumBadge feature={feature} /></div>
      {f && <p className="mt-1.5 text-muted">{f.description}</p>}
      <Link href="/app/settings?tab=plan" className="mt-2 inline-block text-accent hover:underline">See plans</Link>
    </div>
  );
}
