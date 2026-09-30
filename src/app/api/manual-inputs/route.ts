import { NextResponse } from "next/server";
import { requireDb, schema } from "@/db";
import { latestManualInputs, MAX_NOTE_CHARS } from "@/db/manual";
import { guarded } from "@/lib/auth/user";
import { errorResponse } from "@/lib/errors";

export const dynamic = "force-dynamic";
const FIELDS = new Set(["ntm_revenue", "ntm_ebitda"]);

/** The caller's own manual inputs for these tickers. */
export async function GET(req: Request) {
  return guarded(async (user) => {
  const tickers = (new URL(req.url).searchParams.get("tickers") ?? "").split(",").map((t) => t.trim().toUpperCase()).filter(Boolean).slice(0, 50);
  return NextResponse.json(await latestManualInputs(tickers, user.id));
  });
}

export async function POST(req: Request) {
  return guarded(async (user) => {
  const body = (await req.json().catch(() => null)) as { ticker?: string; field?: string; value?: number | null; note?: string } | null;
  const ticker = typeof body?.ticker === "string" ? body.ticker.toUpperCase().trim().slice(0, 12) : "";
  if (!ticker || !body?.field || !FIELDS.has(body.field)) return NextResponse.json({ error: "ticker and field (ntm_revenue | ntm_ebitda) required" }, { status: 400 });
  const value = body.value === null || body.value === undefined ? null : Number(body.value);
  if (value !== null && !Number.isFinite(value)) return NextResponse.json({ error: "value must be a number (USD millions) or null to clear" }, { status: 400 });
  try {
    const db = requireDb();
    const note = typeof body.note === "string" ? body.note.trim().slice(0, MAX_NOTE_CHARS) : "";
    const [row] = await db.insert(schema.manualInputs).values({ ticker, field: body.field, value, note, enteredBy: user.name || user.email || "analyst", userId: user.id }).returning();
    return NextResponse.json(row);
  } catch (e) { return errorResponse(e); }
  });
}
