import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { guarded } from "@/lib/auth/user";
import { capDaily, CROSS_SITE, jsonBody, refuse, requireQuantConsent, sameSiteJson } from "@/lib/quant/access";
import { familiesOf, logTrial, type TrialHygiene } from "@/lib/quant/trials";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** GET — the person's strategy families and how many trials each has. */
export async function GET() {
  return guarded(async (user) => NextResponse.json({ families: await familiesOf(user.id) }));
}

/**
 * POST { family?, name?, params, returns, periodsPerYear?, dates?, hygiene? } — log one backtest run as a trial.
 * For people and AI agents testing strategies outside the algo engine (which logs its own). Without a family, the
 * family is the person's named strategy ("upload:<you>:<name>"), so every version of it counts.
 */
export async function POST(req: Request) {
  if (!sameSiteJson(req)) return NextResponse.json(CROSS_SITE, { status: 403 });
  return guarded(async (user) => {
    await requireQuantConsent(user.id);
    await capDaily(user, "trialsPerDay", "That is the most trials one person can log in a day.");
    const b = await jsonBody(req);
    const slug = String(b.name ?? "my strategy").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "strategy";
    // A person logs only into their own families: "upload:<their hash>:...". Any other family name (someone
    // else's upload family, an algo or copy family) would put trials in a family they do not own.
    const own = `upload:${createHash("sha256").update(user.id).digest("hex").slice(0, 10)}:`;
    const family = typeof b.family === "string" && b.family.startsWith(own) ? b.family : `${own}${slug}`;
    if (!Array.isArray(b.returns)) throw refuse("Send `returns` as a list of numbers.");
    const h = (b.hygiene && typeof b.hygiene === "object" ? b.hygiene : {}) as TrialHygiene;
    const dates = Array.isArray(b.dates) ? (b.dates as unknown[]).map(String) : undefined;
    const r = await logTrial({ family, params: (b.params && typeof b.params === "object" ? b.params : {}) as Record<string, unknown>, returns: b.returns as number[], ownerId: user.id, source: b.source === "agent" ? "agent" : "upload", periodsPerYear: Number(b.periodsPerYear) || 252, hygiene: { ...h, dates }, startDate: dates?.[0], endDate: dates?.at(-1) });
    return NextResponse.json(r, { status: 201 });
  });
}
