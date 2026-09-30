/**
 * Earth · GeoAI blocks. "Earth" looks at the sites of the wired-in companies (or the plants in a place)
 * in Sentinel-2 imagery a year apart, gathers recent findings, and asks the ML service's foundation
 * models to confirm the ones not yet checked, waiting for their answer. "Deal what-if" draws the
 * pro-forma footprint of two to four companies.
 */
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { ensureMaps } from "../../assets";
import { checkTarget } from "../../detect";
import { mlReady } from "../../infra/ml";
import { partyFor, proforma } from "../../proforma";
import { applyRefinement, refineInput, startRefine } from "../../refine";
import { PLACES } from "../../sources/eia";
import { register, type ExecContext, type ExecResult } from "../engine";
import type { Companies, Finding, Findings, Places, ProformaValue } from "../values";

const num = (v: unknown, d: number, lo: number, hi: number) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };

function targetsOf(ctx: ExecContext): { tickers: string[]; places: Places["items"] } {
  const tickers: string[] = [], places: Places["items"] = [];
  for (const v of ctx.inputs.in ?? []) {
    const items = (v as { items?: Record<string, unknown>[] }).items ?? [];
    for (const it of items) {
      if (typeof it.ticker === "string") tickers.push(it.ticker);
      else if (Array.isArray(it.bbox)) places.push(it as Places["items"][number]);
    }
  }
  return { tickers: [...new Set(tickers)].slice(0, 8), places: places.slice(0, 3) };
}

type Row = typeof schema.edgeDetections.$inferSelect;

async function findingsFor(tickers: string[], places: Places["items"], months: number, minConfidence: number): Promise<Row[]> {
  const any: SQL[] = [];
  if (tickers.length) any.push(sql`${schema.edgeDetections.tickers} ?| array[${sql.join(tickers.map((t) => sql`${t}`), sql`, `)}]::text[]`);
  for (const p of places) {
    const [x0, y0, x1, y1] = p.bbox;
    any.push(sql`(${schema.edgeDetections.bbox} is not null and (${schema.edgeDetections.bbox}->>0)::float < ${x1} and (${schema.edgeDetections.bbox}->>2)::float > ${x0} and (${schema.edgeDetections.bbox}->>1)::float < ${y1} and (${schema.edgeDetections.bbox}->>3)::float > ${y0})`);
  }
  if (!any.length) return [];
  return requireDb().select().from(schema.edgeDetections)
    .where(and(eq(schema.edgeDetections.kind, "ground_change"), sql`${schema.edgeDetections.ownerId} is null`, sql`${schema.edgeDetections.detectedAt} > now() - make_interval(months => ${months})`, sql`${schema.edgeDetections.confidence} >= ${minConfidence}`, sql`(${sql.join(any, sql` or `)})`))
    .orderBy(desc(schema.edgeDetections.confidence)).limit(40);
}

function toFinding(r: Row): Finding {
  const v = r.visual as { site?: { name?: string; company?: string; lon?: number; lat?: number }; stats?: { clearedHa?: number; darkenedHa?: number }; refine?: { verdict?: string } };
  return {
    id: r.id, title: r.title, kind: r.kind, confidence: r.confidence, tickers: r.tickers, site: v.site?.name, company: v.site?.company, lon: v.site?.lon, lat: v.site?.lat,
    observedAt: r.observedAt?.toISOString() ?? null, hectares: Math.round(((v.stats?.clearedHa ?? 0) + (v.stats?.darkenedHa ?? 0)) * 10) / 10,
    verdict: v.refine?.verdict, summary: r.summary.slice(0, 400), sources: [`detection:${r.id}`],
  };
}

function result(rows: Row[], fresh: number, targets: string, refined: number): ExecResult {
  const items = rows.map(toFinding);
  const value: Findings = { items, note: items.length ? undefined : "No ground change at these sites in the window." };
  const confirmed = items.filter((f) => f.verdict === "confirmed").length;
  const summary = items.length
    ? `${items.length} ground change${items.length === 1 ? "" : "s"} at ${targets}${fresh ? `, ${fresh} new today` : ""}${confirmed ? `; ${confirmed} confirmed by foundation models` : ""}${refined && !confirmed ? `; ${refined} checked by foundation models` : ""}`
    : `Nothing changed on the ground at ${targets}`;
  return {
    outputs: { findings: value }, summary,
    preview: { kind: "map", points: items.filter((f) => f.lon !== undefined).slice(0, 25).map((f) => ({ lon: f.lon!, lat: f.lat!, label: `${f.site}: ${f.title}`, tone: f.verdict === "confirmed" ? "pos" : f.verdict === "doubtful" ? "neg" : "accent" })) },
  };
}

register("earth.watch", {
  async start(ctx) {
    const sites = num(ctx.config.sites, 3, 1, 8), months = num(ctx.config.months, 6, 1, 12), minC = num(ctx.config.minConfidence, 0.3, 0, 0.9);
    const { tickers, places } = targetsOf(ctx);
    if (!tickers.length && !places.length) throw Object.assign(new Error("Wire in companies or a place."), { status: 400 });
    const label = [...tickers, ...places.map((p) => p.name)].join(", ");
    await ctx.progress("assets", `Loading pipeline and plant maps for ${label}`);
    await ensureMaps();
    await ctx.progress("check", `Comparing Sentinel-2 images a year apart at up to ${sites} sites each`);
    let fresh = 0;
    for (const target of [...tickers.map((ticker) => ({ ticker })), ...places.map((p) => ({ bbox: p.bbox as [number, number, number, number] }))]) {
      if (Date.now() > ctx.deadline - 70_000) break;
      const r = await checkTarget(target, ctx.deadline - 70_000, sites, true);
      fresh += r.found.length;
    }
    const rows = await findingsFor(tickers, places, months, minC);
    if (ctx.config.refine !== false && mlReady()) {
      const pending = rows.filter((r) => !(r.visual as { refine?: unknown }).refine && refineInput(r.visual as Parameters<typeof refineInput>[0])).slice(0, 4);
      const calls: { callId: string; tag: string }[] = [];
      for (const r of pending) {
        const started = await startRefine(r.id).catch(() => null);
        if (started) calls.push({ callId: started.callId, tag: String(r.id) });
      }
      if (calls.length) {
        await ctx.progress("refine", `Asking Prithvi and Segment Anything about ${calls.length} finding${calls.length === 1 ? "" : "s"}`);
        return { calls, state: { tickers, places, months, minC, fresh, label }, timeout: "15m", summary: `Waiting for the foundation-model check of ${calls.length} finding${calls.length === 1 ? "" : "s"}` };
      }
    }
    await ctx.progress("summarize");
    return result(rows, fresh, label, 0);
  },
  async finish(ctx, state, done) {
    const s = state as { tickers: string[]; places: Places["items"]; months: number; minC: number; fresh: number; label: string };
    let refined = 0;
    for (const d of done) {
      const id = Number(/^detection:(\d+)$/.exec(d?.correlation ?? "")?.[1]);
      if (d && Number.isInteger(id) && (await applyRefinement(id, d))) refined++;
    }
    await ctx.progress("summarize");
    return result(await findingsFor(s.tickers, s.places, s.months, s.minC), s.fresh, s.label, refined);
  },
});

register("earth.proforma", {
  async start(ctx) {
    const tickers = [...new Set((ctx.inputs.companies ?? []).flatMap((v) => (v as Companies).items?.map((c) => c.ticker) ?? []))];
    const parties = tickers.map(partyFor).filter((p): p is NonNullable<ReturnType<typeof partyFor>> => !!p).slice(0, 4);
    if (parties.length < 2) throw Object.assign(new Error("A what-if needs two to four companies."), { status: 400 });
    const key = typeof ctx.config.place === "string" && PLACES[ctx.config.place] ? ctx.config.place : "permian";
    await ctx.progress("parties", parties.map((p) => p.label).join(" + "));
    await ensureMaps();
    await ctx.progress("overlay");
    const p = await proforma(parties, PLACES[key]);
    await ctx.progress("screen");
    const value: ProformaValue = {
      parties: p.parties.map((x) => ({ label: x.label, ticker: x.ticker, pipelineKm: x.pipelineKm, plants: x.plants, capacityMMcfd: x.capacityMMcfd })),
      combined: p.combined, overlap: { counties: p.overlap.counties, adjacentCounties: p.overlap.adjacentCounties, parallelKm: p.overlap.parallelKm },
      counties: p.counties.filter((c) => c.parties.length >= 2 || c.flag).slice(0, 20).map((c) => ({ name: c.name, hhiBefore: c.hhiBefore, hhiAfter: c.hhiAfter, delta: c.delta, flag: c.flag })),
      divestitures: p.divestitures.map((d) => ({ plant: d.plant.name, company: d.plant.company, capacityMMcfd: d.plant.capacityMMcfd, county: d.county, reason: d.reason })),
      place: p.place.name, method: p.method,
    };
    const high = p.counties.filter((c) => c.flag === "high");
    return {
      outputs: { proforma: value },
      summary: `${Math.round(p.combined.capacityShare * 100)}% of mapped processing together; ${p.overlap.counties} shared counties; ${high.length ? `${high.map((c) => c.name).join(", ")} screen high` : "no county screens high"}`,
      preview: {
        kind: "stats", items: [
          { label: "Processing", value: `${Math.round(p.combined.capacityMMcfd).toLocaleString("en-US")} MMcfd` },
          { label: "Share", value: `${Math.round(p.combined.capacityShare * 100)}%` },
          { label: "Shared counties", value: String(p.overlap.counties) },
          { label: "Divestitures", value: String(p.divestitures.length) },
        ],
      },
    };
  },
});
