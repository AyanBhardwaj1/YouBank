import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { requireEdge } from "@/lib/edge/access";
import { changeRadar, compareDocs } from "@/lib/edge/docs/changes";
import { rateLimit } from "@/lib/locks";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** The change radar for a company's filings: ?ticker=ET&form=10-K|10-Q&section=risk|mdna|all. */
export async function GET(req: Request) {
  return guarded(async (user) => {
    await requireEdge(user.id);
    const q = new URL(req.url).searchParams;
    const ticker = (q.get("ticker") ?? "").toUpperCase();
    if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(ticker)) return NextResponse.json({ error: "Pick a company." }, { status: 400 });
    await rateLimit(`edge-radar:${user.id}`, 30, 3_600_000, "Many comparisons this hour; try again later.");
    const form = q.get("form") === "10-Q" ? "10-Q" : "10-K";
    const section = q.get("section") === "mdna" ? "mdna" : q.get("section") === "all" ? "all" : "risk";
    return NextResponse.json(await changeRadar(ticker, form, section), { headers: { "cache-control": "private, max-age=600" } });
  });
}

/** Compare two documents the person can read (the earlier first): { a, b }. */
export async function POST(req: Request) {
  return guarded(async (user) => {
    await requireEdge(user.id);
    const body = (await req.json().catch(() => null)) as { a?: number; b?: number } | null;
    const a = Number(body?.a), b = Number(body?.b);
    if (!Number.isInteger(a) || !Number.isInteger(b) || a === b) return NextResponse.json({ error: "Pick two different documents." }, { status: 400 });
    await rateLimit(`edge-radar:${user.id}`, 30, 3_600_000, "Many comparisons this hour; try again later.");
    return NextResponse.json(await compareDocs(user.id, a, b));
  });
}
