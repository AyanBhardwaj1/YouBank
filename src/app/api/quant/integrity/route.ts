import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { guarded } from "@/lib/auth/user";
import { canUse } from "@/lib/billing/entitlements";
import { capDaily, CROSS_SITE, jsonBody, refuse, requireQuantConsent, sameSiteJson } from "@/lib/quant/access";
import { checkClaim, cleanClaim } from "@/lib/quant/integrity/claim";
import { checkUpload, integrityCheck, liveGate } from "@/lib/quant/integrity/check";
import { INTEGRITY_VERSION, type Assessment } from "@/lib/quant/integrity/assess";
import { parseReturnsCsv } from "@/lib/quant/integrity/upload";
import { trySaveRun } from "@/lib/quant/runs";
import { familyTrials, logTrial, type TrialHygiene } from "@/lib/quant/trials";
import { DISCLOSURES } from "@/lib/quant/words";
import "@/lib/quant/factors/provider";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** What a free plan sees of a family's report: the grade, the rule and the top warnings (docs/quant-edge.md, Q3). */
const lockedView = (a: Assessment) => ({ report: a.report, rule: a.rule, warnings: a.report.warnings.slice(0, 3), whatWouldChange: a.whatWouldChange.slice(0, 2), disclosures: a.disclosures, locked: true });

const hygieneOf = (b: Record<string, unknown>): TrialHygiene => {
  const n = (v: unknown) => (v === undefined || v === null || v === "" ? undefined : Number(v));
  const h: TrialHygiene = {};
  if (n(b.turnover) !== undefined && Number.isFinite(n(b.turnover))) h.turnover = Math.max(0, n(b.turnover)!);
  if (n(b.costBps) !== undefined && Number.isFinite(n(b.costBps))) h.costBpsAssumed = Math.max(0, n(b.costBps)!);
  if (n(b.executionLagBars) !== undefined && Number.isFinite(n(b.executionLagBars))) h.executionLagBars = Math.max(0, Math.round(n(b.executionLagBars)!));
  if (typeof b.survivorshipSafe === "boolean") h.survivorshipSafe = b.survivorshipSafe;
  if (typeof b.llmInputs === "boolean") h.llmInputs = b.llmInputs;
  if (typeof b.llmCutoff === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.llmCutoff)) h.llmCutoff = b.llmCutoff;
  if (typeof b.oosFrom === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.oosFrom)) h.oosFrom = b.oosFrom;
  if (b.fundamentals === "asof" || b.fundamentals === "latest" || b.fundamentals === "none") h.fundamentals = b.fundamentals;
  return h;
};

/**
 * POST { mode: "claim" | "upload" | "family", ... }
 * - claim: typed numbers (sharpe, months, frequency, trials, skew?, kurt?). Free, no data, no consent needed.
 * - upload: a return series (csv text or returns[]), optional dates, turnover, costs and hygiene answers. Free for
 *   one series; a matrix of variants (PBO, Reality Check, placebo) needs quant.integrity-pro. Each upload counts
 *   as a trial of the named strategy.
 * - family: a strategy family logged in quant_trials (the algo engine's, a sleeve's, a clone's). Free: the grade
 *   and top warnings; quant.integrity-pro: the full report.
 */
export async function POST(req: Request) {
  if (!sameSiteJson(req)) return NextResponse.json(CROSS_SITE, { status: 403 });
  return guarded(async (user) => {
    const b = await jsonBody(req);
    if (b.mode === "claim") return NextResponse.json({ claim: checkClaim(cleanClaim(b)), disclosures: [DISCLOSURES.hypothetical] });
    await requireQuantConsent(user.id);
    const pro = await canUse(user, "quant.integrity-pro");
    if (b.mode === "family") {
      const family = String(b.family ?? "");
      if (!/^[A-Za-z0-9:._\-]{3,120}$/.test(family)) throw refuse("Choose a strategy family.");
      if (pro) await capDaily(user, "integrityPro", "That is the most full integrity reports in a day. The grade still updates.");
      const a = await integrityCheck(family, { ownerId: user.id, pro, trialId: Number(b.trialId) || undefined });
      return NextResponse.json(pro ? { ...a, gate: liveGate(a.report, family), locked: false } : { ...lockedView(a), gate: liveGate(a.report, family), family, trialsUsed: a.trialsUsed });
    }
    if (b.mode !== "upload") throw refuse("mode must be claim, upload or family.");
    const parsed = typeof b.csv === "string" ? parseReturnsCsv(b.csv, { assumePercent: b.percent === true }) : { returns: Array.isArray(b.returns) ? (b.returns as unknown[]).map(Number) : [], dates: Array.isArray(b.dates) ? (b.dates as unknown[]).map(String) : undefined, matrix: undefined };
    const returns = parsed.returns.filter(Number.isFinite);
    if (returns.length < 20) throw refuse("Paste at least 20 returns (one per line, or date,return).");
    if (parsed.matrix && !pro) throw Object.assign(refuse("Grading a matrix of variants (PBO, the Reality Check, the placebo) is part of Pro. Paste one series to grade it free.", 402), { feature: "quant.integrity-pro" });
    if (pro && parsed.matrix) await capDaily(user, "integrityPro", "That is the most full integrity reports in a day.");
    const ppy = [12, 52, 252].includes(Number(b.periodsPerYear)) ? Number(b.periodsPerYear) : 252;
    const hygiene = hygieneOf(b);
    const slug = String(b.name ?? "my strategy").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "strategy";
    const family = `upload:${createHash("sha256").update(user.id).digest("hex").slice(0, 10)}:${slug}`;
    await logTrial({ family, params: { upload: createHash("sha256").update(JSON.stringify(returns)).digest("hex").slice(0, 16) }, returns, ownerId: user.id, source: "upload", periodsPerYear: ppy, hygiene: { ...hygiene, dates: parsed.dates } }).catch(() => null);
    const logged = (await familyTrials(family, { ownerId: user.id, limit: 500 }).catch(() => [])).map((r) => r.sharpe ?? NaN);
    const a = checkUpload({ returns, dates: parsed.dates?.length === returns.length ? parsed.dates : undefined, periodsPerYear: ppy, matrix: parsed.matrix, declaredTrials: Number(b.declaredTrials) || undefined, hygiene, pro, loggedSharpes: logged });
    const runId = await trySaveRun(user.id, "integrity", { mode: "upload", family, n: returns.length, ppy, declaredTrials: Number(b.declaredTrials) || null }, { report: a.report, rule: a.rule }, [{ label: "Your uploaded returns" }], INTEGRITY_VERSION);
    return NextResponse.json({ ...a, family, runId, locked: false, gate: liveGate(a.report, family) });
  });
}
