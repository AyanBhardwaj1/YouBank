"use client";

/**
 * Edge's client plumbing: the person's Edge state (beta, watches, limits, what can be watched), the
 * ranked feed, and small formatters. Fetching and polling reuse the Newsroom's helpers, which pause in
 * hidden tabs and back off on errors.
 */
import { useSyncExternalStore } from "react";
import { useApi } from "@/components/news/client";
import type { Blend } from "@/lib/edge/access";
import type { EdgeCard, Scope } from "@/lib/edge/feed";
import type { Proforma } from "@/lib/edge/proforma";
import type { Bbox } from "@/lib/edge/sources/eia";
import type { Watch } from "@/lib/edge/watches";

export { api, ago, post, useApi, useNow } from "@/components/news/client";
export type { Blend, EdgeCard, Proforma, Scope, Watch, Bbox };

export type EdgeState = {
  beta: boolean; since: string | null; blend: Blend;
  limits: { watches: number; monitors: number };
  watches: Watch[];
  companies: { ticker: string; company: string; assets: number }[];
  places: { key: string; name: string; bbox: Bbox }[];
  covered: { key: string; name: string; bbox: Bbox }[];
};

export type FeedData = { cards: EdgeCard[]; counts: Record<Scope, number>; total: number; kinds?: Record<string, number>; generatedAt: string };

export type GroundVisual = {
  type: "before_after";
  site: { name: string; kind: string; company: string; ticker: string; lon: number; lat: number };
  bbox: Bbox;
  before: { url: string; date: string; scene: string };
  after: { url: string; date: string; scene: string };
  overlay: string;
  stats: { clearedHa: number; darkenedHa: number; clearPct: number };
};

export type ProformaVisual = {
  type: "proforma";
  deal: { id: number; kind: string; headline: string; valueUsd: number | null; announcedAt: string; sourceUrl: string; status: string };
  parties: { label: string; tickers: string[]; companies: string[] }[];
  place: string;
  proforma: Pick<Proforma, "place" | "parties" | "combined" | "overlap" | "counties" | "divestitures">;
};

export type FilingVisual = {
  type: "filing_change"; ticker: string; name: string; form: string; section: string;
  current: { filed: string; url: string } | null; prior: { filed: string; url: string } | null;
  counts: { added: number; removed: number; changed: number; unchanged: number };
  summary: string[]; samples: { status: "added" | "removed" | "changed"; text: string; before?: string }[];
};

export type FlaringVisual = {
  type: "flaring";
  site: { name: string; kind: string; company: string; ticker: string; lon: number; lat: number; capacityMMcfd: number };
  bbox: Bbox; radiusKm: number;
  days: { date: string; n: number; frp: number; sats: string[] }[];
  stats: { detections: number; days: number; frpTotal: number; frpMax: number; nearestM: number; satellites: number; high: number };
  hits: { lon: number; lat: number; frp: number; date: string; time: string; sat: string; conf: string; night: boolean; m: number }[];
  heat: { url: string; photo: string; date: string; scene: string; hot: number } | null;
  reported: { period: string; flaredMcf: number; ventedMcf: number; radiusKm: number; facilities: { id: string; name: string; operator: string; type: string; km: number; flaredMcf: number; ventedMcf: number; url: string }[] } | null;
  history: { week: string; days: number; frp: number }[];
};

export type RadarVisual = {
  type: "radar_change";
  site: { name: string; kind: string; company: string; ticker: string; lon: number; lat: number; capacityMMcfd: number };
  bbox: Bbox;
  before: { url: string; date: string; scene: string; dates: string[] };
  after: { url: string; date: string; scene: string; dates: string[] };
  overlay: string;
  orbit: { direction: "ascending" | "descending"; relative: number };
  stats: { newObjects: number; newAreaM2: number; largestM2: number; strong: number; known: number; goneObjects: number; goneAreaM2: number; groundRatio: number; clearPct: number; passes: { before: number; after: number } };
  objects: { lon: number; lat: number; areaM2: number; peakDb: number; where: string; fresh: boolean }[];
};

export type PermitItem = { api: string; name: string; operator: string; lon: number; lat: number; km: number; date: string; url: string; state: "NM" | "TX" };
export type PermitsVisual = {
  type: "permits";
  site: { name: string; kind: string; company: string; ticker: string; lon: number; lat: number; capacityMMcfd: number };
  radiusKm: number; asOf: string; from: string; dated: boolean; last30: number; prior90: number;
  /** Permits in each 30-day window, oldest first; the last is the 30 days of the card. */
  windows: number[];
  operators: { name: string; n: number }[];
  permits: PermitItem[];
  tx: { permitted: number; since: string } | null;
};

export type MethaneVisual = {
  type: "methane_plume";
  site: { name: string; kind: string; company: string; ticker: string; lon: number; lat: number; capacityMMcfd: number };
  radiusKm: number; bbox: Bbox; date: string; platform: string;
  rateKgH: number | null; uncertaintyKgH: number | null; nearestM: number;
  /** The plume picture as a data URI ("" when it could not be kept). */
  image: string;
  plumes: { id: string; lon: number; lat: number; m: number; rateKgH: number | null; uncertaintyKgH: number | null }[];
  earlier: { id: string; date: string; m: number; rateKgH: number | null; platform: string }[];
  credit: string;
};

export type FlagVisual = { type: "flag"; company: { id: number; name: string; ticker: string }; flag: { kind: string; severity: "high" | "medium"; title: string; detail: string; date: string; people?: string[]; urls?: string[] } };
export type PredictionVisual = { type: "prediction"; subject: { id: number; name: string; ticker: string }; direction: "acquirers" | "targets"; items: { id: number; name: string; ticker: string; score: number; rank: number; fresh: boolean }[]; scorecard: string; version: string };

export type AssetFeature = {
  type: "Feature"; id: number;
  geometry: { type: string; coordinates: unknown };
  properties: { id: number; kind: string; name: string; operator: string; company: string; ticker: string; status: string; source: string; attrs: Record<string, unknown> };
};
export type AssetCollection = { type: "FeatureCollection"; features: AssetFeature[] };
export type Imagery = { tiles: string; minzoom: number; maxzoom: number; from: string; to: string; attribution: string };

export const useEdgeState = (initial?: EdgeState, seededAt?: string) => useApi<EdgeState>("/api/edge", 0, initial, seededAt);

/* One clock for every relative time on the page: a single half-minute timer, and only the components that
   show a time re-render when it ticks (0 until the first tick, so server and first client render agree). */
let clock = 0;
let clockTimer: ReturnType<typeof setInterval> | null = null;
const clockListeners = new Set<() => void>();
function subscribeClock(l: () => void) {
  clockListeners.add(l);
  if (!clockTimer) { clock = Date.now(); clockTimer = setInterval(() => { clock = Date.now(); for (const f of clockListeners) f(); }, 30_000); }
  return () => { clockListeners.delete(l); if (!clockListeners.size && clockTimer) { clearInterval(clockTimer); clockTimer = null; } };
}
export const useClock = () => useSyncExternalStore(subscribeClock, () => clock, () => 0);

export const fmtNum = (v: number, dp = 0) => v.toLocaleString("en-US", { maximumFractionDigits: dp, minimumFractionDigits: dp });

export function confidenceLabel(c: number): { label: string; tone: "pos" | "accent" | "muted" } {
  if (c >= 0.7) return { label: "High confidence", tone: "pos" };
  if (c >= 0.4) return { label: "Medium confidence", tone: "accent" };
  return { label: "Low confidence", tone: "muted" };
}

export const MODULES = [
  { id: "earth", label: "Earth", tech: "GeoAI", icon: "Globe", live: true, blurb: "Satellite change at plants and pipelines, and deal maps" },
  { id: "documents", label: "Documents", tech: "RAG", icon: "FileSearch", live: true, blurb: "Cited answers across filings, calls and data rooms" },
  { id: "networks", label: "Networks", tech: "GNN", icon: "Network", live: true, blurb: "Ownership, boards, supply chains and deals as a graph" },
  { id: "scenarios", label: "Scenarios", tech: "Synthetic data", icon: "FlaskConical", live: true, blurb: "Simulated markets and company what-ifs, always labeled" },
] as const;

/** A party's colour for a map feature: by ticker, else by a company name inside its operator or parent. */
export function partyOf(f: Pick<AssetFeature["properties"], "ticker" | "company" | "operator">, parties: { key: string; color: string; tickers: string[]; companies: string[] }[]) {
  const name = `${f.company} ${f.operator}`.toLowerCase();
  return parties.find((p) => (f.ticker && p.tickers.includes(f.ticker)) || p.companies.some((c) => c && name.includes(c.toLowerCase())));
}
