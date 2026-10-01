import { NextResponse } from "next/server";
import { secretsMatch } from "@/lib/crm/crypto";
import { scanDeals } from "@/lib/edge/dealwatch";
import { sendDigests } from "@/lib/edge/digest";
import { scanFilings } from "@/lib/edge/docs/filingwatch";
import { scanFlares } from "@/lib/edge/flares";
import { graphDaily } from "@/lib/edge/graph/jobs";
import { jobsReady } from "@/lib/edge/infra/jobs";
import { notifyWatchers } from "@/lib/edge/notify";
import { scanPermits } from "@/lib/edge/permits";
import { scanMethane } from "@/lib/edge/premium/carbonmapper";
import { scanRadar } from "@/lib/edge/radar";
import { checkDue } from "@/lib/edge/watches";
import { describeFailure } from "@/lib/errors";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Edge's daily pass, triggered by Vercel Cron with the CRON_SECRET bearer token: refresh the asset maps
 * (weekly), look at every watched company and place not checked in the last day (each distinct target
 * once, least recently checked first), build pro-forma cards for new deals that touch the map, compare
 * new 10-Ks and 10-Qs of watched companies with the previous ones, look for flaring at every mapped
 * plant in the last week of NASA's night-time heat detections, and at the same time read watched plants
 * in Sentinel-1 radar for new structures (each every six days, a dozen a day), count the drilling
 * permits near them, and (only when licensed) match Carbon Mapper's methane plumes to them; keep the
 * relationship graph current (watched companies re-read, the Newsroom's deals folded in, the deal model
 * retrained when a deal was announced since it last trained). Big findings alert their watchers at once;
 * the rest go in the daily digest.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !secretsMatch(req.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const deadline = Date.now() + 270_000;
  try {
    const watches = await checkDue(deadline - 60_000);
    const deals = await scanDeals(deadline - 60_000);
    const filings = await scanFilings(deadline - 45_000);
    // Flaring, radar, permits and methane read different services, so they run side by side, each within its own time.
    const end = deadline - 30_000;
    const [flares, radar, permits, methane] = await Promise.all([
      scanFlares(end).catch((e) => ({ plants: 0, flaring: 0, created: [] as number[], updated: 0, error: describeFailure(e, 500, "edge-cron-flares").message })),
      scanRadar(Math.min(end, Date.now() + 75_000)).catch((e) => ({ watched: 0, due: 0, checked: 0, created: [] as number[], error: describeFailure(e, 500, "edge-cron-radar").message })),
      scanPermits(Math.min(end, Date.now() + 60_000)).catch((e) => ({ plants: 0, read: 0, jumps: 0, created: [] as number[], error: describeFailure(e, 500, "edge-cron-permits").message })),
      scanMethane(end).catch((e) => ({ plumes: 0, plants: 0, created: [] as number[], error: describeFailure(e, 500, "edge-cron-methane").message })),
    ]);
    const methaneCreated = "created" in methane ? methane.created : [];
    // Big findings alert their watchers now; the rest wait for the digest.
    const alerts = await notifyWatchers([...watches.found, ...deals, ...filings, ...flares.created, ...radar.created, ...permits.created, ...methaneCreated]).catch((e) => ({ error: describeFailure(e, 500, "edge-cron-notify").message }));
    const graph = await graphDaily().catch((e) => ({ error: describeFailure(e, 500, "edge-cron-graph").message }));
    // Digests go hourly from the job runner at each person's brief time; without it, once a day from here.
    const digests = jobsReady() ? "hourly" : await sendDigests(deadline, { anyHour: true }).catch((e) => ({ error: describeFailure(e, 500, "edge-cron-digest").message }));
    return NextResponse.json({ ok: true, watches, deals: deals.length, filings: filings.length, flares, radar, permits, methane, alerts, graph, digests });
  } catch (e) {
    return NextResponse.json({ ok: false, error: describeFailure(e, 500, "edge-cron").message }, { status: 500 });
  }
}
