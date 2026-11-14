import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { rateLimit, withinRate } from "@/lib/locks";
import { body, CROSS_SITE, marketKey, NO_STORE, sameSite } from "@/lib/predict/http";
import { loadMarkets, marketByKey } from "@/lib/predict/store";
import { addForecast, deleteForecast, listForecasts, resolveForecasts } from "@/lib/predict/watch";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET — the person's paper forecasts with their Brier scores beside the market's, and the calibration table
 * (src/lib/book/forecast.ts). Open forecasts whose market has resolved are scored first (a few times an hour).
 */
export async function GET() {
  return guarded(async (user) => {
    if (await withinRate(`predict-resolve:${user.id}`, 4, 3_600_000).catch(() => false)) {
      const { markets } = await loadMarkets();
      await resolveForecasts(Date.now() + 20_000, user.id, markets).catch(() => null);
    }
    return NextResponse.json(await listForecasts(user.id), { headers: NO_STORE });
  });
}

/** POST { key, p } — record your probability (1-99, or 0.01-0.99) on an open market. Paper only. */
export async function POST(req: Request) {
  if (!sameSite(req)) return NextResponse.json(CROSS_SITE, { status: 403 });
  return guarded(async (user) => {
    await rateLimit(`predict-forecast:${user.id}`, 100, 86_400_000, "That is many forecasts for one day. Try again tomorrow.");
    const b = await body(req);
    const key = marketKey(b.key);
    // The price now, from the venue, so the market's own forecast beside yours is the one at this moment.
    const m = (await marketByKey(key, { fresh: true, eventId: typeof b.eventId === "string" ? b.eventId.slice(0, 120) : undefined })) ?? (await loadMarkets()).markets.find((x) => x.key === key);
    if (!m) return NextResponse.json({ error: "That market could not be found on its venue." }, { status: 404 });
    return NextResponse.json({ forecast: await addForecast(user.id, m, b.p) });
  });
}

/** DELETE ?id= — remove a forecast made today. */
export async function DELETE(req: Request) {
  if (!sameSite(req)) return NextResponse.json(CROSS_SITE, { status: 403 });
  return guarded(async (user) => {
    const id = Number(new URL(req.url).searchParams.get("id"));
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "That forecast was not found." }, { status: 400 });
    await deleteForecast(user.id, id);
    return NextResponse.json({ ok: true });
  });
}
