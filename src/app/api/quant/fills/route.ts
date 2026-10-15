import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { requireFeature } from "@/lib/billing/entitlements";
import { capDaily, CROSS_SITE, jsonBody, refuse, requireQuantConsent, sameSiteJson } from "@/lib/quant/access";
import { brokerFills } from "@/lib/quant/broker";
import { importFills, TEMPLATES } from "@/lib/quant/tca/import";
import { deleteFills, fillsOf, saveFills } from "@/lib/quant/tca/run";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** GET — the person's fills (newest first) and the CSV templates YouBank reads. */
export async function GET() {
  return guarded(async (user) => {
    await requireQuantConsent(user.id);
    const rows = await fillsOf(user.id, 1_000);
    const fills = rows.map((row) => {
      const out: Record<string, unknown> = { ...row, executedAt: row.executedAt.toISOString(), placedAt: row.placedAt?.toISOString() ?? null, createdAt: row.createdAt.toISOString() };
      delete out.raw;
      return out;
    });
    return NextResponse.json({ fills, templates: TEMPLATES });
  });
}

/**
 * POST { csv, accountRef? } imports a broker export (free); POST { sync: accountId } pulls recent executed orders
 * from a connected broker (quant.tca-pro). Re-importing the same file adds nothing.
 */
export async function POST(req: Request) {
  if (!sameSiteJson(req)) return NextResponse.json(CROSS_SITE, { status: 403 });
  return guarded(async (user) => {
    await requireQuantConsent(user.id);
    await capDaily(user, "fillsImportsPerDay", "That is the most fill imports in a day.");
    const b = await jsonBody(req);
    if (typeof b.sync === "string") {
      await requireFeature(user, "quant.tca-pro");
      const fills = await brokerFills(user, b.sync, 3);
      return NextResponse.json({ broker: "snaptrade", ...(await saveFills(user.id, fills)), read: fills.length });
    }
    if (typeof b.csv !== "string" || !b.csv.trim()) throw refuse("Paste or upload a CSV export.");
    if (b.csv.length > 5_000_000) throw refuse("That file is too large (5 MB at most).", 413);
    const accountRef = typeof b.accountRef === "string" && b.accountRef.trim() ? b.accountRef.trim().slice(0, 60) : "csv";
    const parsed = importFills(b.csv, accountRef);
    if (!parsed.broker) return NextResponse.json({ error: "The columns did not match a known export. Use one of the templates.", expected: parsed.expected }, { status: 422 });
    const saved = await saveFills(user.id, parsed.fills);
    return NextResponse.json({ broker: parsed.broker, read: parsed.fills.length, skipped: parsed.skipped, errors: parsed.errors.slice(0, 20), ...saved });
  });
}

/** DELETE { ids? } — delete some or all of the person's fills. */
export async function DELETE(req: Request) {
  if (!sameSiteJson(req)) return NextResponse.json(CROSS_SITE, { status: 403 });
  return guarded(async (user) => {
    const b = await jsonBody(req);
    const ids = Array.isArray(b.ids) ? (b.ids as unknown[]).map(Number).filter(Number.isFinite) : undefined;
    if (!ids && b.all !== true) throw refuse("Send { ids } or { all: true }.");
    return NextResponse.json({ deleted: await deleteFills(user.id, ids) });
  });
}
