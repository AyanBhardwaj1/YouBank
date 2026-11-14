import { NextResponse } from "next/server";
import { secretsMatch } from "@/lib/crm/crypto";
import { handled } from "@/lib/errors";
import { publishPredictSignals } from "@/lib/quant/adapters/predict";
import { predictPass } from "@/lib/predict/watch";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Prediction markets' hourly pass from Vercel Cron (CRON_SECRET or AUTOPILOT_SECRET bearer token): every
 * watched market is checked and moves past each person's threshold are sent, resolved markets score their
 * forecasts (src/lib/predict/watch.ts), and this hour's event signals are published to Quant
 * (src/lib/quant/adapters/predict.ts). Free work only: public venue data, no AI. Schedule it with
 * { "path": "/api/predict/cron", "schedule": "7 * * * *" } in vercel.json; the quant nightly also runs the
 * pass once a day.
 */
async function handle(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const ok = [process.env.CRON_SECRET, process.env.AUTOPILOT_SECRET].some((s) => s && secretsMatch(auth, `Bearer ${s}`));
  if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return handled(async () => {
    const pass = await predictPass(Date.now() + 240_000);
    const signals = await publishPredictSignals().then((r) => ({ stored: r.stored, rejected: r.rejected.length, candidates: r.candidates }), () => null);
    return NextResponse.json({ ok: true, ...pass, signals });
  });
}

export const GET = handle;
export const POST = handle;
