/**
 * The Terrain block: the ground at the wired-in ground changes (the ground before the change, and the
 * earth new pads took to level) or at the companies' biggest plants, from USGS lidar where it has been
 * flown, else USGS 3DEP or Copernicus. One row per site, ready for a memo, an export or Studio.
 */
import { sql } from "drizzle-orm";
import { requireDb } from "@/db";
import { logError } from "@/lib/errors";
import { terrainForAsset, terrainForDetection } from "../../ground";
import type { SiteTerrain } from "../../terrain";
import { register } from "../engine";
import type { Finding, Table } from "../values";

const num = (v: unknown, d: number, lo: number, hi: number) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
const COLUMNS: Table["columns"] = [
  { name: "site", type: "text" }, { name: "company", type: "text" }, { name: "what", type: "text" }, { name: "ground_m", type: "num" }, { name: "relief_m", type: "num" },
  { name: "slope_deg", type: "num" }, { name: "new_ground_ha", type: "num" }, { name: "earth_moved_m3", type: "num" }, { name: "lower_ground_pct", type: "num" }, { name: "elevation_source", type: "text" },
];

function row(site: string, company: string, what: string, t: SiteTerrain): (string | number | null)[] {
  const pad = t.pads.find((p) => p.kind === "cleared") ?? t.pads[0];
  const position = pad ? pad.position : t.elevation.positionAtSite;
  return [
    site, company, what, pad ? pad.groundM : t.elevation.atSite ?? t.elevation.mean, t.reliefM, pad ? pad.slopeDeg : t.slope.meanDeg,
    t.earthwork?.hectares ?? null, t.earthwork ? t.earthwork.cutM3 : null, position === null || position === undefined ? null : Math.round(position * 100),
    `${t.source.name} (${t.source.resolutionM} m${t.source.vintage ? `, ${t.source.vintage}` : ""})`,
  ];
}

register("earth.terrain", {
  async start(ctx) {
    const max = num(ctx.config.sites, 6, 1, 12);
    const findings: Finding[] = [], tickers: string[] = [];
    for (const v of ctx.inputs.in ?? []) {
      for (const it of (v as { items?: Record<string, unknown>[] }).items ?? []) {
        if (typeof it.id === "number" && it.kind === "ground_change") findings.push(it as unknown as Finding);
        else if (typeof it.ticker === "string" && !("kind" in it)) tickers.push(it.ticker);
      }
    }
    const plants = tickers.length ? ((await requireDb().execute(sql`
      select id, name, company, ticker from edge_assets where kind = 'processing_plant' and owner_id is null and ticker in (${sql.join([...new Set(tickers)].slice(0, 8).map((t) => sql`${t}`), sql`, `)})
      order by coalesce(nullif(attrs->>'capacityMMcfd', '')::float, 0) desc limit ${max}`)).rows as { id: number; name: string; company: string; ticker: string }[]) : [];
    if (!findings.length && !plants.length) throw Object.assign(new Error("Wire in ground changes (from Earth) or companies with mapped plants."), { status: 400 });
    await ctx.progress("elevation", "Reading lidar where it has been flown, else USGS 3DEP or Copernicus");
    const rows: (string | number | null)[][] = [];
    let moved = 0, steepest = 0, read = 0;
    for (const f of findings.slice(0, max)) {
      if (Date.now() > ctx.deadline - 20_000) break;
      try {
        const t = await terrainForDetection(ctx.userId, f.id);
        rows.push(row(f.site ?? f.title, f.company ?? "", "ground change", t));
        moved += t.earthwork?.cutM3 ?? 0; steepest = Math.max(steepest, t.slope.p90Deg); read++;
      } catch (e) { logError(e, { where: "edge-terrain-block" }); }
    }
    for (const p of plants.slice(0, Math.max(0, max - read))) {
      if (Date.now() > ctx.deadline - 20_000) break;
      try {
        const t = await terrainForAsset(ctx.userId, p.id);
        if (t.kind !== "site") continue;
        rows.push(row(p.name, p.company || p.ticker, "processing plant", t));
        steepest = Math.max(steepest, t.slope.p90Deg);
      } catch (e) { logError(e, { where: "edge-terrain-block" }); }
    }
    if (!rows.length) throw Object.assign(new Error("No elevation data could be read for these sites."), { status: 502 });
    await ctx.progress("measure");
    const table: Table = { title: "Terrain", columns: COLUMNS, rows };
    return {
      outputs: { table },
      summary: `${rows.length} site${rows.length === 1 ? "" : "s"} read${moved ? `; new ground took about ${Math.round(moved).toLocaleString("en-US")} m³ of earth to level` : ""}`,
      preview: { kind: "stats", items: [{ label: "Sites", value: String(rows.length) }, { label: "Earth moved", value: moved ? `${Math.round(moved).toLocaleString("en-US")} m³` : "none" }, { label: "Steepest tenth", value: `${steepest.toFixed(1)}°` }] },
    };
  },
});
