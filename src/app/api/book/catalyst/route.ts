import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { rateLimit } from "@/lib/locks";
import { CATALYST_OUTCOMES, type CatalystOutcome } from "@/lib/book/decisions";
import { reviewCatalyst } from "@/lib/book/store";

export const dynamic = "force-dynamic";

/** POST { id, catalystId, outcome: "yes" | "no" | "mixed" }: whether a passed catalyst played out, in the journal. */
export async function POST(req: Request) {
  return guarded(async (user) => {
    const { id, catalystId, outcome } = ((await req.json().catch(() => ({}))) ?? {}) as { id?: unknown; catalystId?: unknown; outcome?: unknown };
    if (typeof id !== "string" || typeof catalystId !== "string" || typeof outcome !== "string" || !Object.hasOwn(CATALYST_OUTCOMES, outcome)) return NextResponse.json({ error: "Say which catalyst and whether it played out." }, { status: 400 });
    await rateLimit(`book-catalyst:${user.id}`, 60, 86_400_000, "That is many reviews for one day. Try again tomorrow.");
    const r = await reviewCatalyst(user.id, id, catalystId, outcome as CatalystOutcome);
    if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json({ log: r.position.log ?? [] });
  });
}
