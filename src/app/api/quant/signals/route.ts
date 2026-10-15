import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { producerSummary, signalsAsOf } from "@/lib/quant/signals";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * GET ?producer=a,b&symbols=X,Y&at=ISO — QuantSignals valid at `at` (default now): as_of <= at < valid_until,
 * the newest per producer and symbol. The same rule a backtest uses, so a replay never sees the future.
 * ?summary=1 lists the producers and how many signals each has live. Signals are impersonal: any signed-in person.
 * At most 5,000 signals a request (signalsAsOf allows 20,000 for server-side callers): full bodies, so a bigger page
 * would be tens of megabytes for anyone signed in to ask for.
 */
export async function GET(req: Request) {
  return guarded(async () => {
    const q = new URL(req.url).searchParams;
    if (q.get("summary") === "1") return NextResponse.json({ producers: await producerSummary() });
    const list = (k: string) => (q.get(k) ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const at = q.get("at") || undefined;
    if (at && !Number.isFinite(Date.parse(at))) return NextResponse.json({ error: "`at` must be an ISO time." }, { status: 400 });
    const signals = await signalsAsOf({ producers: list("producer"), symbols: list("symbols").map((s) => s.toUpperCase()), at, limit: Math.min(Number(q.get("limit")) || 2_000, 5_000) });
    return NextResponse.json({ at: at ?? new Date().toISOString(), count: signals.length, signals });
  });
}
