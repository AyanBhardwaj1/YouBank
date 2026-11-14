import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { requireFeature } from "@/lib/billing/entitlements";
import { rateLimit } from "@/lib/locks";
import { aiMapping } from "@/lib/predict/ai-map";
import { body, CROSS_SITE, marketKey, sameSite } from "@/lib/predict/http";
import { loadMarkets, marketByKey } from "@/lib/predict/store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST { key } — the rules' stock mapping with the AI's additions (predict.ai-map, Pro; the person's AI
 * allowance pays). Falls back to the rules alone, saying so, when the model is unavailable.
 */
export async function POST(req: Request) {
  if (!sameSite(req)) return NextResponse.json(CROSS_SITE, { status: 403 });
  return guarded(async (user) => {
    await requireFeature(user, "predict.ai-map");
    await rateLimit(`predict-ai-map:${user.id}`, 30, 86_400_000, "That is the most AI mappings in a day. The rules' mapping is still shown.");
    const key = marketKey((await body(req)).key);
    const m = (await loadMarkets()).markets.find((x) => x.key === key) ?? (await marketByKey(key));
    if (!m) return NextResponse.json({ error: "That market could not be found on its venue." }, { status: 404 });
    const r = await aiMapping(m);
    return NextResponse.json({ mapping: r.mapping, ai: r.ai, note: r.ai ? "The AI's additions are marked; the rules' links are unchanged." : "The AI could not add to the mapping just now, so the rules' mapping stands." });
  });
}
