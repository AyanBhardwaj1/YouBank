import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { canUse, requireFeature } from "@/lib/billing/entitlements";
import { requireEdge, edgeProfile } from "@/lib/edge/access";
import { eq } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { companyNode, privateNode } from "@/lib/edge/entities/resolve";
import { notifyWatchers } from "@/lib/edge/notify";
import { loadWarn, pulseOf, refreshCompany } from "@/lib/edge/pulse/ingest";
import { coverageText, flaggedPeriods } from "@/lib/edge/pulse/findings";
import { dailyListOf, setDailyList, DAILY_LIMIT } from "@/lib/edge/pulse/jobs";
import { changeVerdict, falseAlarmSentence } from "@/lib/edge/series/change";
import { metricDef, SOURCES } from "@/lib/edge/series/metrics";
import { falseAlarms } from "@/lib/edge/pulse/ingest";
import { rateLimit } from "@/lib/locks";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const TICKER = /^[A-Z][A-Z0-9.\-]{0,9}$/;

/** A startup from /app/vc as a private company node (its website's domain linked), for its Pulse strip. */
async function startupNode(id: number): Promise<number> {
  const [s] = await requireDb().select({ name: schema.startups.name, website: schema.startups.website }).from(schema.startups).where(eq(schema.startups.id, id));
  if (!s?.website) return 0;
  return (await privateNode(s.name, s.website))?.id ?? 0;
}

/**
 * A company's Alt-Data Pulse (E3, free): GET ?ticker= or ?node=: each stored series with its change
 * probability, the weeks flagged and the false-alarm sentence for its family; the tells list; where the
 * company hires; dated events (awards, WARN notices); recent findings; and which sources answered.
 */
export async function GET(req: Request) {
  return guarded(async (user) => {
    await requireEdge(user.id);
    const q = new URL(req.url).searchParams;
    const ticker = (q.get("ticker") ?? "").toUpperCase();
    const node = Number(q.get("node")) || (Number(q.get("startup")) ? await startupNode(Number(q.get("startup"))) : 0) || (TICKER.test(ticker) ? (await companyNode(ticker))?.id ?? 0 : 0);
    if (!node) return NextResponse.json({ error: "Give a company: ?ticker=, ?node= or ?startup= (a startup with a website)." }, { status: 400 });
    const p = await pulseOf(node);
    if (!p) return NextResponse.json({ error: "That company is not in Edge's graph." }, { status: 404 });
    const fa = await falseAlarms().catch(() => ({} as Record<string, number>));
    const family = (m: string) => (m.startsWith("jobs.dept") ? "jobs.dept" : m.startsWith("jobs") ? "jobs" : m.startsWith("wiki") ? "attention" : m.startsWith("patents") ? "patents" : "");
    const series = Object.entries(p.series).map(([metric, points]) => {
      const def = metricDef(metric);
      const weekly = def?.cadence !== "monthly";
      const v = points.length >= 12 ? changeVerdict(points.map((x) => x.value)) : null;
      // Weeks the detector would have flagged, run online over the history (the shaded weeks).
      const flagged = flaggedPeriods(points);
      return { metric, label: def?.label ?? metric, unit: def?.unit ?? "", cadence: weekly ? "weekly" : "monthly", source: SOURCES[def?.source === "ats" ? "greenhouse" : def?.source ?? ""]?.name ?? def?.source ?? "", points, verdict: v, flagged: flagged.slice(-12), falseAlarms: family(metric) ? falseAlarmSentence(fa[family(metric)] ?? NaN, family(metric) === "attention" ? "weekly page views" : family(metric) === "patents" ? "monthly patent counts" : "job-posting counts") : "" };
    }).sort((a, b) => a.metric.localeCompare(b.metric));
    const prof = await edgeProfile(user.id);
    return NextResponse.json({
      ...p, series, coverageText: p.coverage ? coverageText(p.coverage) : "Not read yet.",
      daily: { list: dailyListOf(prof?.extra), allowed: await canUse(user, "edge.pulse-daily"), limit: DAILY_LIMIT },
    }, { headers: { "cache-control": "private, max-age=30" } });
  });
}

/**
 * POST { action: "refresh", ticker }: read the company's sources now (free, about 20 a person an hour).
 * POST { action: "daily", tickers }: the person's daily list (premium perk: edge.pulse-daily, up to 50).
 */
export async function POST(req: Request) {
  return guarded(async (user) => {
    await requireEdge(user.id);
    const body = (await req.json().catch(() => ({}))) as { action?: string; ticker?: string; tickers?: string[]; startup?: number };
    if (body.action === "daily") {
      await requireFeature(user, "edge.pulse-daily");
      return NextResponse.json({ list: await setDailyList(user.id, Array.isArray(body.tickers) ? body.tickers.map(String) : []) });
    }
    if (body.action !== "refresh") return NextResponse.json({ error: "Unknown action." }, { status: 400 });
    await rateLimit(`edge-pulse-refresh:${user.id}`, 20, 3_600_000, "Twenty refreshes this hour. Try again later.");
    const ticker = String(body.ticker ?? "").toUpperCase();
    const nodeId = Number(body.startup) ? await startupNode(Number(body.startup)) : TICKER.test(ticker) ? (await companyNode(ticker))?.id ?? 0 : 0;
    if (!nodeId) return NextResponse.json({ error: "That company is not in SEC's list (or the startup has no website)." }, { status: 404 });
    const notices = await loadWarn().catch(() => []);
    const r = await refreshCompany(nodeId, Date.now() + 100_000, { notices });
    if (r.created.length) await notifyWatchers(r.created).catch(() => undefined);
    return NextResponse.json({ ok: true, coverage: coverageText(r.coverage), points: r.points, findings: r.created.length, sources: r.sources, failed: r.errors });
  });
}
