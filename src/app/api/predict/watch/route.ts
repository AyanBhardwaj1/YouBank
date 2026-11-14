import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { canUse } from "@/lib/billing/entitlements";
import { rateLimit } from "@/lib/locks";
import { body, CROSS_SITE, marketKey, NO_STORE, sameSite } from "@/lib/predict/http";
import { loadMarkets, marketByKey } from "@/lib/predict/store";
import { addWatch, listWatches, removeWatch } from "@/lib/predict/watch";
import { THRESHOLDS, WATCHES_FREE, WATCHES_PRO } from "@/lib/predict/watch-rules";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** GET — the markets the person watches, each with its price now. */
export async function GET() {
  return guarded(async (user) => {
    const [watches, pro, { markets }] = await Promise.all([listWatches(user.id), canUse(user, "predict.watch-pro").catch(() => false), loadMarkets()]);
    const now = new Map(markets.map((m) => [m.key, m]));
    return NextResponse.json({
      watches: watches.map((w) => { const m = now.get(w.key); return { ...w, prob: m?.prob ?? w.lastProb, change24h: m?.change24h ?? null, status: m?.status ?? null }; }),
      limit: pro ? WATCHES_PRO : WATCHES_FREE, thresholds: THRESHOLDS,
    }, { headers: NO_STORE });
  });
}

/** POST { key, threshold } — watch a market for a move of `threshold` points (3, 5, 10, 15 or 20), or change the threshold. */
export async function POST(req: Request) {
  if (!sameSite(req)) return NextResponse.json(CROSS_SITE, { status: 403 });
  return guarded(async (user) => {
    await rateLimit(`predict-watch:${user.id}`, 120, 3_600_000, "That is many watch changes for one hour. Try again later.");
    const b = await body(req);
    const key = marketKey(b.key);
    const listed = (await loadMarkets()).markets.find((m) => m.key === key);
    const m = listed ?? (await marketByKey(key, { eventId: typeof b.eventId === "string" ? b.eventId.slice(0, 120) : undefined }));
    if (!m) return NextResponse.json({ error: "That market could not be found on its venue." }, { status: 404 });
    return NextResponse.json({ watch: await addWatch(user, m, b.threshold) });
  });
}

/** DELETE ?key= — stop watching. */
export async function DELETE(req: Request) {
  if (!sameSite(req)) return NextResponse.json(CROSS_SITE, { status: 403 });
  return guarded(async (user) => {
    await removeWatch(user.id, marketKey(new URL(req.url).searchParams.get("key")));
    return NextResponse.json({ ok: true });
  });
}
