"use client";

import { useEffect, useState } from "react";
import type { PlanId } from "@/lib/billing/plans";

export type ClientEntitlements = { plan: PlanId; admin: boolean; status: string; features: string[]; anchor?: string | null };

/** One request per page load, shared by every badge and gate on the page. */
let pending: Promise<ClientEntitlements | null> | null = null;

function load(): Promise<ClientEntitlements | null> {
  pending ??= fetch("/api/billing/plan")
    .then((r) => (r.ok ? (r.json() as Promise<ClientEntitlements>) : null))
    .catch(() => null);
  return pending;
}

/** Forget the cached plan (after an upgrade), so the next hook reads it fresh. */
export function refreshPlan() {
  pending = null;
}

/** This person's plan, or null while loading or when signed out. */
export function usePlan(): ClientEntitlements | null {
  const [e, setE] = useState<ClientEntitlements | null>(null);
  useEffect(() => {
    let live = true;
    void load().then((v) => { if (live) setE(v); });
    return () => { live = false; };
  }, []);
  return e;
}

/** Whether a premium feature is unlocked: true, false, or null while loading. */
export function useFeature(featureId: string): boolean | null {
  const e = usePlan();
  return e ? e.features.includes(featureId) : null;
}
