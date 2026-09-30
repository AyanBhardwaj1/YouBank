/**
 * Automatic deal what-ifs: when the Newsroom's deal tracker records an acquisition or merger and both
 * sides own mapped assets in a region Edge covers, Edge builds the pro-forma picture (combined footprint,
 * overlaps, the county antitrust screen and likely divestitures) and posts it as a card. Each deal is
 * looked at once per region; a deal with nothing on the map is remembered as quiet.
 */
import { requireDb, schema } from "@/db";
import { cacheGet, cacheSet } from "@/lib/cache";
import { logError } from "@/lib/errors";
import { recentDeals, type DealRow } from "@/lib/news/deals";
import { partyFor, proforma, PROFORMA_METHOD, type PartyInput, type Proforma } from "./proforma";
import { record } from "./provenance";
import { COVERED } from "./watches";

const MERGERS = ["acquisition", "merger", "take_private", "tender"];
const DAY = 86_400_000;

/** How much a pro-forma matters, 0 to 1: flagged counties and the combined share of processing. Pure, for tests. */
export function proformaWeight(p: Pick<Proforma, "counties" | "combined" | "overlap">): number {
  const high = p.counties.filter((c) => c.flag === "high").length, watch = p.counties.filter((c) => c.flag === "watch").length;
  return Math.min(1, 0.3 * high + 0.1 * watch + p.combined.capacityShare + Math.min(0.2, p.overlap.parallelKm / 2000));
}

/** Plain words for a pro-forma card. Pure, for tests. */
export function describeProforma(p: Proforma, deal?: { kind: string }): { title: string; summary: string } {
  const [a, b] = p.parties;
  const verb = deal?.kind === "merger" ? "merged with" : "plus";
  const high = p.counties.filter((c) => c.flag === "high");
  const bits = [
    `Together ${fmt(p.combined.capacityMMcfd)} MMcfd of processing (${Math.round(p.combined.capacityShare * 100)}% of mapped capacity) and ${fmt(p.combined.pipelineKm)} km of mapped pipeline in the ${p.place.name}`,
    p.overlap.counties ? `both operate in ${p.overlap.counties} ${p.overlap.counties === 1 ? "county" : "counties"}` : "no shared counties",
    p.overlap.parallelKm >= 1 ? `${fmt(p.overlap.parallelKm)} km of their pipelines run within a kilometre of each other` : "",
    high.length ? `${high.map((c) => c.name).join(" and ")} screen${high.length === 1 ? "s" : ""} high for concentration` : "no county screens high for concentration",
    p.divestitures.length ? `likely divestitures: ${p.divestitures.slice(0, 3).map((d) => d.plant.name).join(", ")}` : "",
  ].filter(Boolean);
  return { title: `Pro-forma map: ${a.label} ${verb} ${b.label}`, summary: `${bits.join("; ")}.` };
}

const fmt = (v: number) => Math.round(v).toLocaleString("en-US");

function sides(d: DealRow): [PartyInput, PartyInput] | null {
  const a = partyFor(d.acquirerTicker || d.acquirer) ?? (d.acquirer ? partyFor(d.acquirer) : null);
  const b = partyFor(d.targetTicker || d.target) ?? (d.target ? partyFor(d.target) : null);
  if (!a || !b || a.label === b.label) return null;
  return [a, b];
}

/** Build cards for recent deals that touch the map. Returns the new cards' ids. */
export async function scanDeals(deadline: number, days = 21): Promise<number[]> {
  const deals = await recentDeals({ days, kinds: MERGERS, limit: 80 });
  const found: number[] = [];
  for (const d of deals) {
    if (Date.now() > deadline) break;
    const pair = sides(d);
    if (!pair) continue;
    for (const region of COVERED) {
      const key = `deal:${d.id}:${region.key}`;
      if (await cacheGet(`edge:quiet:${key}`)) continue;
      try {
        const p = await proforma(pair, region);
        const present = p.parties.filter((x) => x.plants > 0 || x.pipelineKm >= 5);
        if (present.length < 2) { await cacheSet(`edge:quiet:${key}`, "1", 30 * DAY); continue; }
        const words = describeProforma(p, d);
        const mapped = pair.every((x) => x.tickers.length > 0);
        const [row] = await requireDb().insert(schema.edgeDetections).values({
          key, kind: "deal_proforma", module: "earth", title: words.title.slice(0, 200), summary: words.summary.slice(0, 1200),
          why: `The Newsroom recorded this ${d.kind.replace("_", " ")} on ${d.announcedAt.toISOString().slice(0, 10)}. ${mapped ? "Both sides are matched to mapped assets by ticker" : "One side is matched to mapped assets by name, which is less certain"}. Concentration is each county's processing HHI on EIA capacity before and after, screened at 1,800 with a +100 change (2023 Merger Guidelines); a county is a rough market and the capacity data is from 2017, so treat flags as where to look.`,
          confidence: mapped ? 0.8 : 0.5, magnitude: proformaWeight(p),
          tickers: pair.flatMap((x) => x.tickers), bbox: region.bbox,
          visual: { type: "proforma", deal: { id: d.id, kind: d.kind, headline: d.headline, valueUsd: d.valueUsd, announcedAt: d.announcedAt.toISOString(), sourceUrl: d.sourceUrl, status: d.status }, parties: pair.map((x) => ({ label: x.label, tickers: x.tickers, companies: x.companies })), place: region.key, proforma: compact(p) },
          observedAt: d.announcedAt,
        }).onConflictDoNothing().returning({ id: schema.edgeDetections.id });
        if (!row) continue;
        const now = new Date();
        await record(`detection:${row.id}`, [
          ...p.sources.map((s) => ({ sourceName: s.name, sourceUrl: s.url, license: s.license, method: `${PROFORMA_METHOD} (${s.vintage})`, modelVersion: "", retrievedAt: now })),
          { sourceName: "YouBank Newsroom deal tracker", sourceUrl: d.sourceUrl, license: "YouBank (parsed from public reporting)", method: "deal parties and terms extracted from the story", modelVersion: "", retrievedAt: now },
        ]);
        found.push(row.id);
      } catch (e) {
        logError(e, { where: "edge-scan-deal" });
      }
    }
  }
  return found;
}

/** What a card needs to draw the picture without the full county list. */
export function compact(p: Proforma) {
  return {
    place: p.place, parties: p.parties, combined: p.combined,
    overlap: { ...p.overlap, nearbyPlants: p.overlap.nearbyPlants.slice(0, 5) },
    counties: p.counties.filter((c) => c.parties.length >= 2 || c.flag).slice(0, 12),
    divestitures: p.divestitures.slice(0, 8),
  };
}
