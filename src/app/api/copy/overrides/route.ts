import { desc } from "drizzle-orm";
import { NextResponse } from "next/server";
import { requireDb, schema } from "@/db";
import { isAdmin } from "@/lib/auth/admin";
import { guarded } from "@/lib/auth/user";
import { CROSS_SITE, sameSiteJson } from "@/lib/copytrade/access";
import { validCusip } from "@/lib/copytrade/cusip";

export const dynamic = "force-dynamic";

const adminOnly = () => NextResponse.json({ error: "Only administrators can change the CUSIP map." }, { status: 403 });

/** GET — the owner's CUSIP overrides. Administrators only. */
export async function GET() {
  return guarded(async (user) => {
    if (!isAdmin(user)) return adminOnly();
    return NextResponse.json({ overrides: await requireDb().select().from(schema.copyCusipOverrides).orderBy(desc(schema.copyCusipOverrides.createdAt)) });
  });
}

/** POST { cusip, ticker, note } — map a CUSIP to a ticker; it wins over every automatic source. Administrators only. */
export async function POST(req: Request) {
  if (!sameSiteJson(req)) return NextResponse.json(CROSS_SITE, { status: 403 });
  return guarded(async (user) => {
    if (!isAdmin(user)) return adminOnly();
    const b = (await req.json().catch(() => ({}))) as { cusip?: unknown; ticker?: unknown; note?: unknown };
    const cusip = String(b.cusip ?? "").trim().toUpperCase(), ticker = String(b.ticker ?? "").trim().toUpperCase().replace(/[./]/g, "-");
    if (!validCusip(cusip)) return NextResponse.json({ error: "That CUSIP's check digit does not match." }, { status: 400 });
    if (!/^[A-Z][A-Z0-9-]{0,9}$/.test(ticker)) return NextResponse.json({ error: "Enter a ticker like BRK-B." }, { status: 400 });
    const note = String(b.note ?? "").slice(0, 300);
    await requireDb().insert(schema.copyCusipOverrides).values({ cusip, ticker, note, createdBy: user.email }).onConflictDoUpdate({ target: schema.copyCusipOverrides.cusip, set: { ticker, note, createdBy: user.email, createdAt: new Date() } });
    return NextResponse.json({ ok: true });
  });
}
