import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { requireEdge } from "@/lib/edge/access";
import { ensureMaps } from "@/lib/edge/assets";
import { rateLimit } from "@/lib/locks";
import { memo } from "@/lib/memo";
import { partyFor, proforma } from "@/lib/edge/proforma";
import { PLACES } from "@/lib/edge/sources/eia";

export const dynamic = "force-dynamic";

/** The what-if for any companies: ?parties=ET,TRGP&place=permian (two to four companies, tickers or names). */
export async function GET(req: Request) {
  return guarded(async (user) => {
    await requireEdge(user.id);
    const q = new URL(req.url).searchParams;
    const place = PLACES[q.get("place") ?? "permian"];
    if (!place) return NextResponse.json({ error: "Unknown place" }, { status: 400 });
    const names = (q.get("parties") ?? "").split(",").map((s) => s.trim().slice(0, 80)).filter(Boolean).slice(0, 4);
    const parties = names.map(partyFor);
    if (parties.length < 2 || parties.some((p) => !p)) return NextResponse.json({ error: "Pick two to four companies by ticker or name." }, { status: 400 });
    await rateLimit(`edge-proforma:${user.id}`, 60, 3_600_000, "Many what-ifs this hour. Try again in a few minutes.");
    const key = `edge:proforma:${q.get("place") ?? "permian"}:${parties.map((p) => p!.label).join("|")}`;
    await ensureMaps();
    const result = await memo(key, 10 * 60_000, () => proforma(parties.map((p) => p!), place));
    return NextResponse.json(result, { headers: { "cache-control": "private, max-age=300" } });
  });
}
