import { NextResponse } from "next/server";
import { requireDb, schema } from "@/db";
import { latestManualInputs } from "@/db/manual";
import { guarded } from "@/lib/auth/user";

export const dynamic = "force-dynamic";
const FIELDS = new Set(["ntm_revenue", "ntm_ebitda"]);

export async function GET(req: Request) {
  return guarded(async () => {
  const tickers = (new URL(req.url).searchParams.get("tickers") ?? "").split(",").map((t) => t.trim().toUpperCase()).filter(Boolean);
  return NextResponse.json(await latestManualInputs(tickers));
  });
}

export async function POST(req: Request) {
  return guarded(async (user) => {
  const body = (await req.json().catch(() => null)) as { ticker?: string; field?: string; value?: number | null; note?: string } | null;
  const ticker = body?.ticker?.toUpperCase().trim();
  if (!ticker || !body?.field || !FIELDS.has(body.field)) return NextResponse.json({ error: "ticker and field (ntm_revenue | ntm_ebitda) required" }, { status: 400 });
  const value = body.value === null || body.value === undefined ? null : Number(body.value);
  if (value !== null && !Number.isFinite(value)) return NextResponse.json({ error: "value must be a number (USD millions) or null to clear" }, { status: 400 });
  try {
    const db = requireDb();
    const [row] = await db.insert(schema.manualInputs).values({ ticker, field: body.field, value, note: body.note ?? "", enteredBy: user.name || user.email || "analyst", userId: user.id }).returning();
    return NextResponse.json(row);
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 }); }
  });
}
