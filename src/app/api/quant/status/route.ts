import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { canUse } from "@/lib/billing/entitlements";
import { memo } from "@/lib/memo";
import { r2Ready } from "@/lib/edge/infra/r2";
import { jobsReady } from "@/lib/edge/infra/jobs";
import { hasQuantConsent } from "@/lib/quant/access";
import { factorStatus } from "@/lib/quant/factors/read";
import { survivorship } from "@/lib/quant/pit/universe";
import { producerSummary } from "@/lib/quant/signals";
import { NOT_OFFERED, QUANT_TERMS } from "@/lib/quant/words";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** GET — the hub's overview: consent, plan, the store's state (universe, survivorship, factors), signal producers. */
export async function GET() {
  return guarded(async (user) => {
    const [consent, universe, factors, producers, ...plan] = await Promise.all([
      // The store's state is the same for everyone and changes with the nightly pass: built once per instance
      // every five minutes (each is an aggregate over a whole table), not on every visit.
      hasQuantConsent(user.id), memo("quant:status:universe", 300_000, survivorship).catch(() => null), memo("quant:status:factors", 300_000, factorStatus).catch(() => null), memo("quant:status:producers", 300_000, producerSummary).catch(() => []),
      ...["quant.factorlab-pro", "quant.risk-pro", "quant.integrity-pro", "quant.sizing-pro", "quant.tca-pro", "quant.insiders-pro", "quant.drills-teams"].map((f) => canUse(user, f)),
    ]);
    const ids = ["factorlab", "risk", "integrity", "sizing", "tca", "insiders", "drillsTeams"];
    return NextResponse.json({
      consent, terms: QUANT_TERMS, universe, factors, producers, notOffered: NOT_OFFERED,
      plan: Object.fromEntries(ids.map((k, i) => [k, plan[i]])), infra: { store: r2Ready(), jobs: jobsReady() },
    });
  });
}
