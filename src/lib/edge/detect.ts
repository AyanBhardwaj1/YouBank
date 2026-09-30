/**
 * Earth · GeoAI: what changed at the places people watch. For each site (a processing plant, and later
 * any site a person draws or uploads), the clearest Sentinel-2 scene now is compared with the clearest
 * from a year before, the same season, pixel by pixel (./change.ts). A real change becomes a card: the
 * two images, the change drawn over the newer one, how many hectares, how sure, why, and where every
 * part came from. Significant finds are described in words by a small vision model (within the AI
 * limits); a quiet site is remembered for a month so it is not re-read every pass.
 */
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { requireDb, schema } from "@/db";
import { structured } from "@/lib/ai/agent";
import { aiBlocked } from "@/lib/ai/limits";
import { cacheGet, cacheSet } from "@/lib/cache";
import { logError } from "@/lib/errors";
import { CHANGE_METHOD, CHANGE_VERSION, changeBetween, changeConfidence, classesFrom, decodePng, overlayPng, seasonGap } from "./change";
import { sendJob } from "./infra/jobs";
import { mlReady } from "./infra/ml";
import { record, type Provenance } from "./provenance";
import { EIA_PLANTS, type Bbox } from "./sources/eia";
import { boxAround, classes, clearestNear, crop, cropUrl, SENTINEL } from "./sources/sentinel";

export type Site = { assetId: number | null; name: string; kind: string; company: string; ticker: string; lon: number; lat: number };

const SITE_KM = 2.5;
const SIZE = 256;
const DAY = 86_400_000;
/** A site counts as quiet unless one change covers at least this much ground (hectares): a tank farm, a pond or a small pad. */
const MIN_HECTARES = 0.5;
/** Below this, a change is more likely the season or the scene than something built (a wet year against a dry one). */
const MIN_CONFIDENCE = 0.25;

const Described = z.object({
  headline: z.string().describe("6 to 12 words naming what changed, e.g. 'New well pad cleared north of the plant'"),
  description: z.string().describe("one or two sentences: what is visible now that was not a year ago, where relative to the site; say plainly if unclear"),
});

/** Sites for a company (its plants) or a place (the plants inside it): the least recently checked first, then the biggest. */
export async function sitesFor(target: { ticker?: string; bbox?: Bbox }, limit: number): Promise<Site[]> {
  const conds = [sql`kind = 'processing_plant'`, sql`owner_id is null`];
  if (target.ticker) conds.push(sql`ticker = ${target.ticker}`);
  if (target.bbox) conds.push(sql`geom && ST_MakeEnvelope(${target.bbox[0]}, ${target.bbox[1]}, ${target.bbox[2]}, ${target.bbox[3]}, 4326)`);
  const rows = await requireDb().execute(sql`
    select id, name, kind, company, ticker, ST_X(geom) as lon, ST_Y(geom) as lat from edge_assets
    where ${sql.join(conds, sql` and `)} order by checked_at asc nulls first, coalesce((attrs->>'capacityMMcfd')::float, 0) desc limit ${limit}`);
  return (rows.rows as { id: number; name: string; kind: string; company: string; ticker: string; lon: number; lat: number }[])
    .map((r) => ({ assetId: r.id, name: r.name, kind: r.kind, company: r.company, ticker: r.ticker, lon: Number(r.lon), lat: Number(r.lat) }));
}

async function describe(site: Site, before: Buffer, after: Buffer, dates: [string, string]) {
  if (await aiBlocked(null)) return null;
  try {
    const r = await structured(Described, "edge-describe-change",
      "You read satellite imagery for an investment analyst. Two true-colour Sentinel-2 crops (10 m pixels, about 2.5 km across) of the same place a year apart: the first is older. Say only what you can see changed; never guess at causes you cannot see, and never invent names.",
      `Site: ${site.name} (${site.company || "unknown operator"}), a ${site.kind.replace("_", " ")}. Older image ${dates[0]}, newer ${dates[1]}.`,
      { files: [{ name: "before.png", mime: "image/png", data: before.toString("base64") }, { name: "after.png", mime: "image/png", data: after.toString("base64") }], override: { model: "gpt-5.6-luna", effort: "low" }, maxTokens: 600, timeoutMs: 60_000 });
    return { ...r.data, model: r.model };
  } catch (e) {
    logError(e, { where: "edge-describe" });
    return null;
  }
}

/** Compare a site now with a year ago. Returns the new card's id, or null when nothing changed (or no clear scenes). */
export async function checkSite(site: Site, opts: { describe?: boolean } = {}): Promise<number | null> {
  if (site.assetId) await requireDb().update(schema.edgeAssets).set({ checkedAt: new Date() }).where(eq(schema.edgeAssets.id, site.assetId));
  const box = boxAround(site.lon, site.lat, SITE_KM);
  const [after, before] = await Promise.all([clearestNear(box, new Date(), 25), clearestNear(box, new Date(Date.now() - 365 * DAY), 30)]);
  if (!after || !before) return null;
  const siteKey = site.assetId ? `asset:${site.assetId}` : `point:${site.lon.toFixed(4)},${site.lat.toFixed(4)}`;
  const key = `ground:${CHANGE_VERSION}:${siteKey}:${before.id}:${after.id}`;
  if (await cacheGet(`edge:checked:${key}`)) return null;
  const [existing] = await requireDb().select({ id: schema.edgeDetections.id }).from(schema.edgeDetections).where(eq(schema.edgeDetections.key, key));
  if (existing) return existing.id;

  const [b, a, cb, ca] = await Promise.all([crop(before, box, SIZE), crop(after, box, SIZE), classes(before, box, SIZE), classes(after, box, SIZE)]);
  const B = decodePng(b), A = decodePng(a), CB = decodePng(cb), CA = decodePng(ca);
  const r = changeBetween(B.data, A.data, B.width, B.height, SITE_KM * SITE_KM, { classesBefore: classesFrom(CB.data, CB.width, CB.height), classesAfter: classesFrom(CA.data, CA.width, CA.height) });
  const hectares = r.cleared.hectares + r.darkened.hectares;
  const confidence = changeConfidence(r, seasonGap(before.date, after.date));
  if (r.largest.hectares < MIN_HECTARES || r.validFraction < 0.6 || confidence < MIN_CONFIDENCE) {
    await cacheSet(`edge:checked:${key}`, "quiet", 30 * DAY);
    return null;
  }
  const words = opts.describe && confidence >= 0.35 ? await describe(site, b, a, [before.date, after.date]) : null;
  const owner = site.company || "an unmapped operator";
  const parts = [r.cleared.hectares >= 0.1 ? `${r.cleared.hectares.toFixed(1)} ha now much brighter (new bare ground, a pad, or drained water)` : "", r.darkened.hectares >= 0.1 ? `${r.darkened.hectares.toFixed(1)} ha now much darker (new water, tanks or paving)` : ""].filter(Boolean);
  const title = words?.headline?.trim() || `Ground changed at ${site.name}`;
  const summary = `${words?.description?.trim() ? `${words.description.trim()} ` : ""}Within ${SITE_KM / 2} km of ${site.name} (${owner}) between ${before.date} and ${after.date}: ${parts.join("; ")}.`;
  const why = `Two Sentinel-2 scenes a year apart, same season (${seasonGap(before.date, after.date).toFixed(0)} days apart in the year), ${Math.round(r.validFraction * 100)}% of the area clear in both. The newer image is put on the older one's brightness scale using the pixels that did not change, then compared pixel by pixel; only compact clusters of 10 m pixels that became much brighter or darker count, and nothing Sentinel-2 classes as cloud, shadow or vegetation.${words ? " The description is a vision model reading the two images." : ""}`;
  const visual = {
    type: "before_after", site: { name: site.name, kind: site.kind, company: site.company, ticker: site.ticker, lon: site.lon, lat: site.lat }, bbox: box,
    before: { url: cropUrl(before, box, 512), date: before.date, scene: before.id }, after: { url: cropUrl(after, box, 512), date: after.date, scene: after.id },
    overlay: `data:image/png;base64,${overlayPng(r).toString("base64")}`,
    stats: { clearedHa: round(r.cleared.hectares), darkenedHa: round(r.darkened.hectares), clearPct: Math.round(r.validFraction * 100) },
    size: SIZE, blobs: r.blobs.slice(0, 8),
  };
  const [row] = await requireDb().insert(schema.edgeDetections).values({
    key, kind: "ground_change", module: "earth", title: title.slice(0, 200), summary: summary.slice(0, 1200), why, confidence, magnitude: hectares,
    tickers: site.ticker ? [site.ticker] : [], assetIds: site.assetId ? [site.assetId] : [], bbox: box, visual, observedAt: new Date(`${after.date}T12:00:00Z`),
  }).onConflictDoNothing().returning({ id: schema.edgeDetections.id });
  if (!row) return null;
  const retrieved = new Date();
  const sources: Provenance[] = [
    { sourceName: SENTINEL.name, sourceUrl: `${SENTINEL.url} (scenes ${before.id}, ${after.id})`, license: SENTINEL.license, method: CHANGE_METHOD, modelVersion: "", retrievedAt: retrieved },
    ...(site.assetId ? [{ sourceName: EIA_PLANTS.name, sourceUrl: EIA_PLANTS.url, license: EIA_PLANTS.license, method: `site location (${EIA_PLANTS.vintage})`, modelVersion: "", retrievedAt: retrieved }] : []),
    ...(words ? [{ sourceName: "Vision model description", sourceUrl: "", license: "YouBank (generated)", method: "image description of the two crops", modelVersion: words.model, retrievedAt: retrieved }] : []),
  ];
  await record(`detection:${row.id}`, sources);
  // The foundation-model check runs in the background (it waits on the ML service).
  if (mlReady()) await sendJob("edge/detection.created", { id: row.id }, { id: `edge-refine-${row.id}` }).catch(() => undefined);
  return row.id;
}

const round = (v: number) => Math.round(v * 100) / 100;

/** Check up to `maxSites` sites for a watch, stopping at the deadline. */
export async function checkTarget(target: { ticker?: string; bbox?: Bbox }, deadline: number, maxSites = 3, describeFinds = true): Promise<{ checked: number; found: number[] }> {
  const sites = await sitesFor(target, maxSites);
  const found: number[] = [];
  let checked = 0;
  for (const s of sites) {
    if (Date.now() > deadline) break;
    try {
      const id = await checkSite(s, { describe: describeFinds });
      checked++;
      if (id) found.push(id);
    } catch (e) {
      logError(e, { where: "edge-check-site" });
    }
  }
  return { checked, found };
}

/** Already-analysed cards for some companies, newest first (for tests and the audit export). */
export async function detectionsFor(tickers: string[], limit = 50) {
  return requireDb().select().from(schema.edgeDetections)
    .where(and(eq(schema.edgeDetections.module, "earth"), sql`${schema.edgeDetections.tickers} ?| array[${sql.join(tickers.map((t) => sql`${t}`), sql`, `)}]`))
    .orderBy(sql`${schema.edgeDetections.detectedAt} desc`).limit(limit);
}
