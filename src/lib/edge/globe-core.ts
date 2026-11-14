/**
 * The globe's markers, the pure part shared by the server and the browser: groups and their colours,
 * where a finding sits, the line on why it may move the stock, and a finding as a marker. Tested in
 * scripts/test-edge-globe.ts. The database read is in ./globe.ts.
 */
import { freshness } from "./fresh";
import type { Bbox } from "./sources/eia";

export type MarkerGroup = "flaring" | "radar" | "ground" | "analysis" | "records" | "deal" | "other";
export type GlobeMarker = {
  id: number; kind: string; group: MarkerGroup; lon: number; lat: number; title: string; tickers: string[];
  confidence: number; seen: string; fresh: "new" | "updated" | null; why: string;
};

export const GROUP_OF: Record<string, MarkerGroup> = {
  flaring: "flaring", methane_plume: "flaring", radar_change: "radar", ground_change: "ground", permits: "ground",
  crop_vigour: "analysis", water_extent: "analysis", vessel_traffic: "analysis", reactor_outage: "records",
  deal_proforma: "deal", deal_impact: "deal",
};

/** Marker colours by group (Okabe-Ito, readable on imagery by day and night). */
export const GROUP_COLOR: Record<MarkerGroup, string> = { flaring: "#E69F00", radar: "#56B4E9", ground: "#F0E442", analysis: "#009E73", records: "#CC79A7", deal: "#D55E00", other: "#FFFFFF" };
export const GROUP_LABEL: Record<MarkerGroup, string> = { flaring: "Flaring and methane", radar: "Radar changes", ground: "Ground and permits", analysis: "Crops, water and ships", records: "Nuclear units", deal: "Deals", other: "Other" };

/** Where a finding sits: its site, else the middle of its box. Pure. */
export function centreOf(visual: Record<string, unknown>, bbox: Bbox | null): { lon: number; lat: number } | null {
  const site = visual.site as { lon?: unknown; lat?: unknown } | null | undefined;
  if (site && typeof site.lon === "number" && typeof site.lat === "number" && Number.isFinite(site.lon) && Number.isFinite(site.lat) && (site.lon !== 0 || site.lat !== 0)) return { lon: site.lon, lat: site.lat };
  if (bbox && bbox.every(Number.isFinite)) return { lon: (bbox[0] + bbox[2]) / 2, lat: (bbox[1] + bbox[3]) / 2 };
  return null;
}

const cut = (s: string, n = 240) => (s.length > n ? `${s.slice(0, n - 1).replace(/\s+\S*$/, "")}…` : s);

/** One line on why a finding may move the stock: the card's own thesis where it has one. Pure. */
export function moveWhy(kind: string, visual: Record<string, unknown>): string {
  if (typeof visual.thesis === "string" && visual.thesis) return cut(visual.thesis);
  if (kind === "deal_impact") { const fx = visual.effects as string[] | undefined; return cut(fx?.[0] ?? "A signal at a party to a pending deal can move the spread or the terms."); }
  if (kind === "reactor_outage") return visual.merchant ? "Lost output at a merchant nuclear plant is lost revenue for its owner, and replacement power if it sold forward." : "Regulated owners mostly pass replacement-power costs to customers; a long outage can still draw regulators' questions.";
  const words: Record<string, string> = {
    flaring: "A plant that flares is burning gas it cannot process or send on (an upset, maintenance, a full pipeline), which can show in the owner's volumes before the quarter's numbers.",
    methane_plume: "A large methane leak at a plant is lost product and, under the methane fee and state rules, a cost and an enforcement risk for its owner.",
    radar_change: "New structures at a plant point to expansion or new equipment: capital being spent before it is announced or reported.",
    ground_change: "Cleared or built ground at a site points to construction or expansion before it is reported.",
    permits: "A jump in drilling permits near a plant means more gas coming to it: volume growth for the processor and its owner.",
    deal_proforma: "Where the two companies overlap after a deal: the counties a regulator is likely to look at and the plants likely to be sold.",
  };
  return words[kind] ?? "A change Edge found that touches this company.";
}

export type Row = { id: number; kind: string; title: string; tickers: string[]; bbox: Bbox | null; visual: Record<string, unknown>; confidence: number; observedAt: Date | null; detectedAt: Date };

/** A finding as a marker, or null when it has no place on the Earth. Pure. */
export function markerOf(r: Row, now: number): GlobeMarker | null {
  const at = centreOf(r.visual ?? {}, r.bbox);
  if (!at) return null;
  const detected = r.detectedAt.toISOString();
  return {
    id: r.id, kind: r.kind, group: GROUP_OF[r.kind] ?? "other", lon: Math.round(at.lon * 1e5) / 1e5, lat: Math.round(at.lat * 1e5) / 1e5, title: r.title, tickers: r.tickers ?? [],
    confidence: r.confidence, seen: (r.observedAt ?? r.detectedAt).toISOString(), fresh: freshness(detected, typeof r.visual?.updatedAt === "string" ? r.visual.updatedAt : null, now), why: moveWhy(r.kind, r.visual ?? {}),
  };
}
