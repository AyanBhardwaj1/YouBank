import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { feedView } from "@/lib/news/views";

export const dynamic = "force-dynamic";

/** Stories ranked for the signed-in person: ?desk= &category= &kind= &q= &saved=1 */
export async function GET(req: Request) {
  return guarded(async (user) => {
    const p = new URL(req.url).searchParams;
    const v = await feedView(user.id, {
      desk: p.get("desk") ?? undefined, category: p.get("category") ?? undefined, kind: p.get("kind") ?? undefined,
      q: p.get("q")?.slice(0, 80) ?? undefined, saved: p.get("saved") === "1", limit: Math.min(200, Number(p.get("limit")) || 120),
    });
    if (!v) return NextResponse.json({ error: "Finish onboarding first" }, { status: 409 });
    return NextResponse.json(v, { headers: { "Cache-Control": "private, no-store" } });
  });
}
