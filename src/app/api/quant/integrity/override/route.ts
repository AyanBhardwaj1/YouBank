import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { CROSS_SITE, jsonBody, refuse, requestMeta, requireQuantConsent, sameSiteJson } from "@/lib/quant/access";
import { integrityCheck, logOverride } from "@/lib/quant/integrity/check";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST { family, typed, accountRef? } — the live gate's typed override for a D or F grade (section 5.3 rule 6).
 * The grade is recomputed from the trial log now, so an override always names the grade in force; the typed
 * phrase must match exactly. Logged in quant_runs; the algo engine logs it in its own audit trail too.
 */
export async function POST(req: Request) {
  if (!sameSiteJson(req)) return NextResponse.json(CROSS_SITE, { status: 403 });
  return guarded(async (user) => {
    await requireQuantConsent(user.id);
    const b = await jsonBody(req);
    const family = String(b.family ?? "");
    if (!/^[A-Za-z0-9:._\-]{3,120}$/.test(family)) throw refuse("Choose a strategy family.");
    const a = await integrityCheck(family, { ownerId: user.id, pro: false, save: false });
    const meta = requestMeta(req);
    const r = await logOverride({ ownerId: user.id, actor: user.email, family, report: a.report, typed: String(b.typed ?? ""), accountRef: typeof b.accountRef === "string" ? b.accountRef : null, ...meta });
    return NextResponse.json({ ok: true, overrideId: r.id, hash: r.hash, grade: a.report.grade }, { status: 201 });
  });
}
